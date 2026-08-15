import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';
import { cacheInvalidatePattern } from '../src/infra/cache/cache-utils.js';
import { confirmOrderPayment } from '../src/application/services/order-confirmation-service.js';

const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const CUSTOMER_USER = {
  email: `agg_customer_${RUN_ID}@alegrafestas.com.br`,
  username: `aggc${RUN_ID}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Aggregates Customer',
};

const ADMIN_USER = {
  email: `agg_admin_${RUN_ID}@alegrafestas.com.br`,
  username: `agga${RUN_ID}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Aggregates Admin',
};

let customerId = '';
let customerToken = '';
let adminToken = '';

function api() {
  return getApp().then((app) => supertest(app.server));
}

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Same rationale as inventory-lifecycle.test.ts: the login rate limiter is
 * keyed per-IP, and all test files share the loopback address — forge a
 * distinct X-Forwarded-For per login so this file's attempts don't share a
 * budget with other suites running in the same session.
 */
function randomForwardedFor(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.78.${r()}.${r()}`;
}

interface TestProduct {
  id: string;
  price: number;
}

async function createTestProduct(stock: number): Promise<TestProduct> {
  const suffix = uniqueSuffix();
  const product = await prisma.product.create({
    data: {
      name: `Aggregates Test Product ${suffix}`,
      slug: `aggregates-test-product-${suffix}`,
      description: 'A product for aggregate fields testing',
      shortDescription: 'Test product',
      price: 19.9,
      category: 'baloes',
      images: ['https://placehold.co/400'],
      thumbnailUrl: 'https://placehold.co/200',
      stock,
      sku: `AGG-SKU-${suffix}`,
      weight: 0.5,
      isActive: true,
    },
  });
  return { id: product.id, price: product.price.toNumber() };
}

async function cleanupProduct(productId: string): Promise<void> {
  await prisma.review.deleteMany({ where: { productId } });
  await prisma.orderItem.deleteMany({ where: { productId } });
  await prisma.inventoryLog.deleteMany({ where: { productId } });
  await prisma.order.deleteMany({ where: { items: { some: { productId } } } });
  await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
}

async function createOrder(
  token: string,
  productId: string,
  quantity: number,
  unitPrice: number,
): Promise<{ id: string; status: string }> {
  const agent = await api();
  const res = await agent
    .post('/v1/orders')
    .set('Authorization', `Bearer ${token}`)
    .send({
      items: [{ productId, quantity, unitPrice }],
      idempotencyKey: crypto.randomUUID(),
    });
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, status: res.body.data.status as string };
}

async function getProductAggregates(
  productId: string,
): Promise<{ averageRating: number | null; reviewCount: number; soldCount: number }> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { averageRating: true, reviewCount: true, soldCount: true },
  });
  return {
    averageRating: product.averageRating ? product.averageRating.toNumber() : null,
    reviewCount: product.reviewCount,
    soldCount: product.soldCount,
  };
}

describe('Product aggregates (averageRating / reviewCount / soldCount)', () => {
  beforeAll(async () => {
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys('ratelimit:login:*');
      if (keys.length > 0) await redis.del(keys);
    } catch {
      /* ignore */
    }

    const agent = await api();
    await agent.post('/v1/auth/register').send(CUSTOMER_USER);
    const customer = await prisma.user.findUnique({ where: { email: CUSTOMER_USER.email } });
    customerId = customer?.id ?? '';
    const customerLogin = await agent
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomForwardedFor())
      .send({ identifier: CUSTOMER_USER.email, password: CUSTOMER_USER.password });
    customerToken = customerLogin.body.data?.accessToken as string;

    const agent2 = await api();
    await agent2.post('/v1/auth/register').send(ADMIN_USER);
    const adminUser = await prisma.user.findUnique({ where: { email: ADMIN_USER.email } });
    if (adminUser) {
      await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'ADMIN' } });
    }
    const adminLogin = await agent2
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomForwardedFor())
      .send({ identifier: ADMIN_USER.email, password: ADMIN_USER.password });
    adminToken = adminLogin.body.data?.accessToken as string;
  });

  afterAll(async () => {
    await closeApp();
  });

  it('creating a review recalculates the product averageRating/reviewCount', async () => {
    const product = await createTestProduct(10);
    try {
      // Verified-purchase rule: review creation requires a DELIVERED order
      // for this user+product (userHasDeliveredPurchase) — create it
      // directly, bypassing the full checkout flow which is out of scope here.
      await prisma.order.create({
        data: {
          userId: customerId,
          status: 'DELIVERED',
          totalAmount: product.price,
          deliveredAt: new Date(),
          items: {
            create: [{ productId: product.id, quantity: 1, unitPrice: product.price, total: product.price }],
          },
        },
      });

      const agent = await api();
      const firstReview = await agent
        .post('/v1/reviews')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ productId: product.id, rating: 5, comment: 'Excelente produto!' });
      expect(firstReview.status).toBe(201);

      const afterOne = await getProductAggregates(product.id);
      expect(afterOne.reviewCount).toBe(1);
      expect(afterOne.averageRating).toBe(5);

      // Second review from a different user brings the average to 4.5.
      const secondUser = {
        email: `agg_reviewer2_${uniqueSuffix()}@alegrafestas.com.br`,
        username: `aggr${uniqueSuffix()}`.slice(0, 20),
        password: 'TestPass123',
        name: 'Second Reviewer',
      };
      const agent2 = await api();
      await agent2.post('/v1/auth/register').send(secondUser);
      const secondDbUser = await prisma.user.findUnique({ where: { email: secondUser.email } });
      const secondLogin = await agent2
        .post('/v1/auth/login')
        .set('X-Forwarded-For', randomForwardedFor())
        .send({ identifier: secondUser.email, password: secondUser.password });
      const secondToken = secondLogin.body.data?.accessToken as string;

      await prisma.order.create({
        data: {
          userId: secondDbUser?.id ?? '',
          status: 'DELIVERED',
          totalAmount: product.price,
          deliveredAt: new Date(),
          items: {
            create: [{ productId: product.id, quantity: 1, unitPrice: product.price, total: product.price }],
          },
        },
      });

      const secondReview = await agent2
        .post('/v1/reviews')
        .set('Authorization', `Bearer ${secondToken}`)
        .send({ productId: product.id, rating: 4, comment: 'Muito bom, recomendo.' });
      expect(secondReview.status).toBe(201);

      const afterTwo = await getProductAggregates(product.id);
      expect(afterTwo.reviewCount).toBe(2);
      expect(afterTwo.averageRating).toBe(4.5);

      await prisma.user.delete({ where: { email: secondUser.email } }).catch(() => undefined);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('confirming payment increments soldCount by the ordered quantity', async () => {
    const product = await createTestProduct(50);
    try {
      const order = await createOrder(customerToken, product.id, 3, product.price);

      const before = await getProductAggregates(product.id);
      expect(before.soldCount).toBe(0);

      const converted = await confirmOrderPayment({
        orderId: order.id,
        fromStatuses: ['RESERVED'],
        toStatus: 'CONFIRMED',
        items: [{ productId: product.id, quantity: 3 }],
      });
      expect(converted).toBe(true);

      const after = await getProductAggregates(product.id);
      expect(after.soldCount).toBe(3);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('cancelling a post-sale (CONFIRMED) order decrements soldCount back', async () => {
    const product = await createTestProduct(50);
    try {
      const order = await createOrder(customerToken, product.id, 4, product.price);

      const converted = await confirmOrderPayment({
        orderId: order.id,
        fromStatuses: ['RESERVED'],
        toStatus: 'CONFIRMED',
        items: [{ productId: product.id, quantity: 4 }],
      });
      expect(converted).toBe(true);

      const afterSale = await getProductAggregates(product.id);
      expect(afterSale.soldCount).toBe(4);

      const agent = await api();
      const cancelRes = await agent
        .patch(`/v1/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'CANCELLED' });
      expect(cancelRes.status).toBe(200);

      const afterCancel = await getProductAggregates(product.id);
      expect(afterCancel.soldCount).toBe(0);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('GET /v1/products — list items include averageRating, reviewCount and soldCount', async () => {
    const product = await createTestProduct(20);
    try {
      // The list endpoint caches responses in Redis for 5 minutes keyed by
      // the exact filter set — invalidate first so this run's freshly
      // created product is guaranteed to appear (no stale hit from an
      // earlier test run within the same TTL window).
      await cacheInvalidatePattern('products:*');

      const agent = await api();
      const res = await agent.get('/v1/products').query({ limit: 100 });
      expect(res.status).toBe(200);

      const found = (res.body.data as Array<Record<string, unknown>>).find(
        (item) => item.id === product.id,
      );
      expect(found).toBeDefined();
      expect(found).toHaveProperty('averageRating');
      expect(found).toHaveProperty('reviewCount');
      expect(found).toHaveProperty('soldCount');
      expect(found?.averageRating).toBeNull();
      expect(found?.reviewCount).toBe(0);
      expect(found?.soldCount).toBe(0);
    } finally {
      await cleanupProduct(product.id);
    }
  });
});
