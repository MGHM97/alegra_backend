import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';
import { confirmOrderPayment } from '../src/application/services/order-confirmation-service.js';

const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const CUSTOMER_USER = {
  email: `inv_customer_${RUN_ID}@alegrafestas.com.br`,
  username: `invc${RUN_ID}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Inventory Customer',
};

const ADMIN_USER = {
  email: `inv_admin_${RUN_ID}@alegrafestas.com.br`,
  username: `inva${RUN_ID}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Inventory Admin',
};

let customerToken = '';
let adminToken = '';

function api() {
  return getApp().then((app) => supertest(app.server));
}

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * The login rate limiter is keyed per-IP (see auth-routes.ts). All test files
 * in this suite hit the API from the same loopback address, so without this,
 * concurrently-running test files would share one 5-attempts/15min IP budget
 * and spuriously 429 each other's logins. A distinct forged
 * X-Forwarded-For per call keeps this file's logins off that shared budget
 * (trustProxy: 1 makes the server honor it as the effective request.ip).
 */
function randomForwardedFor(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.77.${r()}.${r()}`;
}

interface TestProduct {
  id: string;
  price: number;
}

async function createTestProduct(stock: number): Promise<TestProduct> {
  const suffix = uniqueSuffix();
  const product = await prisma.product.create({
    data: {
      name: `Inventory Test Product ${suffix}`,
      slug: `inventory-test-product-${suffix}`,
      description: 'A product for inventory lifecycle testing',
      shortDescription: 'Test product',
      price: 19.9,
      category: 'baloes',
      images: ['https://placehold.co/400'],
      thumbnailUrl: 'https://placehold.co/200',
      stock,
      sku: `INV-SKU-${suffix}`,
      weight: 0.5,
      isActive: true,
    },
  });
  return { id: product.id, price: product.price.toNumber() };
}

async function cleanupProduct(productId: string): Promise<void> {
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

async function getProductStock(
  productId: string,
): Promise<{ stock: number; reservedStock: number }> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true, reservedStock: true },
  });
  return product;
}

describe('Inventory Lifecycle', () => {
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

  it('creating an order reserves stock without touching physical stock', async () => {
    const product = await createTestProduct(50);
    try {
      const order = await createOrder(customerToken, product.id, 3, product.price);
      expect(order.status).toBe('RESERVED');

      const stock = await getProductStock(product.id);
      expect(stock.stock).toBe(50);
      expect(stock.reservedStock).toBe(3);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('confirmOrderPayment converts reservation into a sale (stock -=qty, reservedStock -=qty, InventoryLog SALE)', async () => {
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

      const stock = await getProductStock(product.id);
      expect(stock.stock).toBe(46);
      expect(stock.reservedStock).toBe(0);

      const saleLog = await prisma.inventoryLog.findFirst({
        where: { productId: product.id, action: 'SALE' },
      });
      expect(saleLog).not.toBeNull();
      expect(saleLog?.quantity).toBe(4);
      expect(saleLog?.reason).toBe(`Sale committed for order ${order.id}`);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('confirmOrderPayment is idempotent — second call for the same order returns false and stock decrements only once', async () => {
    const product = await createTestProduct(50);
    try {
      const order = await createOrder(customerToken, product.id, 2, product.price);

      const first = await confirmOrderPayment({
        orderId: order.id,
        fromStatuses: ['RESERVED'],
        toStatus: 'CONFIRMED',
        items: [{ productId: product.id, quantity: 2 }],
      });
      expect(first).toBe(true);

      const second = await confirmOrderPayment({
        orderId: order.id,
        fromStatuses: ['RESERVED'],
        toStatus: 'CONFIRMED',
        items: [{ productId: product.id, quantity: 2 }],
      });
      expect(second).toBe(false);

      const stock = await getProductStock(product.id);
      expect(stock.stock).toBe(48); // decremented only once
      expect(stock.reservedStock).toBe(0);

      const saleLogs = await prisma.inventoryLog.findMany({
        where: { productId: product.id, action: 'SALE' },
      });
      expect(saleLogs).toHaveLength(1);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('cancelling a pre-sale (RESERVED) order releases the reservation without touching physical stock', async () => {
    const product = await createTestProduct(50);
    try {
      const order = await createOrder(customerToken, product.id, 5, product.price);

      const agent = await api();
      const cancelRes = await agent
        .patch(`/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(cancelRes.status).toBe(200);

      const stock = await getProductStock(product.id);
      expect(stock.stock).toBe(50);
      expect(stock.reservedStock).toBe(0);

      const releaseLog = await prisma.inventoryLog.findFirst({
        where: { productId: product.id, action: 'RESERVATION_RELEASE' },
      });
      expect(releaseLog).not.toBeNull();
      expect(releaseLog?.quantity).toBe(5);
      expect(releaseLog?.reason).toBe(`Customer cancelled order ${order.id}`);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('cancelling a post-sale (CONFIRMED, after commitSale) order restocks physical stock without touching reservedStock (regression: previously left reservedStock negative)', async () => {
    const product = await createTestProduct(50);
    try {
      const order = await createOrder(customerToken, product.id, 6, product.price);

      const converted = await confirmOrderPayment({
        orderId: order.id,
        fromStatuses: ['RESERVED'],
        toStatus: 'CONFIRMED',
        items: [{ productId: product.id, quantity: 6 }],
      });
      expect(converted).toBe(true);

      const afterSale = await getProductStock(product.id);
      expect(afterSale.stock).toBe(44);
      expect(afterSale.reservedStock).toBe(0);

      // Admin cancels the already-CONFIRMED (post-sale) order.
      const agent = await api();
      const cancelRes = await agent
        .patch(`/v1/admin/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'CANCELLED' });
      expect(cancelRes.status).toBe(200);

      const afterCancel = await getProductStock(product.id);
      // Stock goes back to the original amount (physical restock)...
      expect(afterCancel.stock).toBe(50);
      // ...but reservedStock is untouched (it was already 0 after commitSale;
      // this was the bug — it used to be decremented again here, going negative).
      expect(afterCancel.reservedStock).toBe(0);

      const restockLog = await prisma.inventoryLog.findFirst({
        where: { productId: product.id, action: 'RESTOCK' },
      });
      expect(restockLog).not.toBeNull();
      expect(restockLog?.quantity).toBe(6);
      const metadata = restockLog?.metadata as { orderId?: string; restockedFromStatus?: string } | null;
      expect(metadata?.orderId).toBe(order.id);
      expect(metadata?.restockedFromStatus).toBe('CONFIRMED');
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('concurrent cancellation of the same RESERVED order: exactly one succeeds, one 409s, reservedStock decrements only once', async () => {
    const product = await createTestProduct(50);
    try {
      const order = await createOrder(customerToken, product.id, 7, product.price);

      const beforeCancel = await getProductStock(product.id);
      expect(beforeCancel.reservedStock).toBe(7);

      const agent = await api();
      const [resA, resB] = await Promise.all([
        agent
          .patch(`/v1/orders/${order.id}/cancel`)
          .set('Authorization', `Bearer ${customerToken}`),
        agent
          .patch(`/v1/orders/${order.id}/cancel`)
          .set('Authorization', `Bearer ${customerToken}`),
      ]);

      const statuses = [resA.status, resB.status].sort((a, b) => a - b);
      expect(statuses).toEqual([200, 409]);

      const conflictRes = resA.status === 409 ? resA : resB;
      expect(conflictRes.body.code).toBe('ORDER_STATE_CONFLICT');

      const afterCancel = await getProductStock(product.id);
      expect(afterCancel.reservedStock).toBe(0);
      expect(afterCancel.stock).toBe(50);

      const releaseLogs = await prisma.inventoryLog.findMany({
        where: { productId: product.id, action: 'RESERVATION_RELEASE' },
      });
      expect(releaseLogs).toHaveLength(1);
    } finally {
      await cleanupProduct(product.id);
    }
  });
});
