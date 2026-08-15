import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';

const RUN_ID = `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const TEST_USER = {
  email: `idem_test_${RUN_ID}@alegrafestas.com.br`,
  username: `idem${RUN_ID}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Idempotency Test User',
};

let accessToken = '';

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
 * X-Forwarded-For per call keeps this file's login off that shared budget
 * (trustProxy: 1 makes the server honor it as the effective request.ip).
 */
function randomForwardedFor(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.78.${r()}.${r()}`;
}

interface TestProduct {
  id: string;
  price: number;
}

async function createTestProduct(price = 45.5, stock = 50): Promise<TestProduct> {
  const suffix = uniqueSuffix();
  const product = await prisma.product.create({
    data: {
      name: `Idempotency Test Product ${suffix}`,
      slug: `idempotency-test-product-${suffix}`,
      description: 'A product for idempotency testing',
      shortDescription: 'Test product',
      price,
      category: 'baloes',
      images: ['https://placehold.co/400'],
      thumbnailUrl: 'https://placehold.co/200',
      stock,
      sku: `IDEM-SKU-${suffix}`,
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

describe('Order Idempotency & Price Integrity', () => {
  beforeAll(async () => {
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys('ratelimit:login:*');
      if (keys.length > 0) await redis.del(keys);
    } catch {
      /* ignore */
    }

    const agent = await api();
    await agent.post('/v1/auth/register').send(TEST_USER);
    const loginRes = await agent
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomForwardedFor())
      .send({ identifier: TEST_USER.email, password: TEST_USER.password });
    accessToken = loginRes.body.data?.accessToken as string;
  });

  afterAll(async () => {
    await closeApp();
  });

  it('two sequential POSTs with the same idempotency key return the same order and create only one row', async () => {
    const product = await createTestProduct();
    try {
      const idempotencyKey = crypto.randomUUID();
      const body = {
        items: [{ productId: product.id, quantity: 1, unitPrice: product.price }],
        idempotencyKey,
      };

      const agent1 = await api();
      const first = await agent1
        .post('/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      const agent2 = await api();
      const second = await agent2
        .post('/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      expect(first.status).toBe(201);
      expect(second.status).toBe(200);
      expect(second.body.data.id).toBe(first.body.data.id);

      const count = await prisma.order.count({ where: { idempotencyKey } });
      expect(count).toBe(1);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('two parallel POSTs with the same idempotency key both succeed, return the same order, and create only one row (covers the P2002 race)', async () => {
    const product = await createTestProduct();
    try {
      const idempotencyKey = crypto.randomUUID();
      const body = {
        items: [{ productId: product.id, quantity: 1, unitPrice: product.price }],
        idempotencyKey,
      };

      const agent = await api();
      const [resA, resB] = await Promise.all([
        agent
          .post('/v1/orders')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body),
        agent
          .post('/v1/orders')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(body),
      ]);

      expect(resA.status).toBeGreaterThanOrEqual(200);
      expect(resA.status).toBeLessThan(300);
      expect(resB.status).toBeGreaterThanOrEqual(200);
      expect(resB.status).toBeLessThan(300);
      expect(resA.body.data.id).toBe(resB.body.data.id);

      const count = await prisma.order.count({ where: { idempotencyKey } });
      expect(count).toBe(1);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('POST /v1/orders without unitPrice is accepted and the persisted price comes from the database', async () => {
    const product = await createTestProduct(45.5);
    try {
      const agent = await api();
      const res = await agent
        .post('/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          items: [{ productId: product.id, quantity: 2 }],
          idempotencyKey: crypto.randomUUID(),
        });

      expect(res.status).toBe(201);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].unitPrice).toBe(45.5);
      expect(res.body.data.totalAmount).toBe(91);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('POST /v1/orders with a unitPrice diverging from the database is rejected with 409 PRICE_MISMATCH', async () => {
    const product = await createTestProduct(45.5);
    try {
      const agent = await api();
      const res = await agent
        .post('/v1/orders')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          items: [{ productId: product.id, quantity: 1, unitPrice: 999.99 }],
          idempotencyKey: crypto.randomUUID(),
        });

      expect(res.status).toBe(409);
      expect(res.body.code).toBe('PRICE_MISMATCH');

      const stock = await prisma.product.findUniqueOrThrow({
        where: { id: product.id },
        select: { reservedStock: true },
      });
      // Rejected order must not have reserved any stock.
      expect(stock.reservedStock).toBe(0);
    } finally {
      await cleanupProduct(product.id);
    }
  });
});
