import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';

const TEST_USER = {
  email: `order_test_${Date.now()}@alegrafestas.com.br`,
  username: `ou${Date.now().toString(36)}`,
  password: 'TestPass123',
  name: 'Order Test User',
};

let accessToken = '';
let testProductId = '';

function api() {
  return getApp().then((app) => supertest(app.server));
}

describe('Orders Flow', () => {
  beforeAll(async () => {
    // Clear rate limit
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys('ratelimit:login:*');
      if (keys.length > 0) await redis.del(keys);
    } catch { /* ignore */ }

    const agent = await api();

    await agent.post('/v1/auth/register').send(TEST_USER);

    const loginRes = await agent
      .post('/v1/auth/login')
      .send({ identifier: TEST_USER.email, password: TEST_USER.password });

    accessToken = loginRes.body.data?.accessToken as string;

    const product = await prisma.product.create({
      data: {
        name: `Test Product ${Date.now()}`,
        slug: `test-product-${Date.now()}`,
        description: 'A product for testing orders',
        shortDescription: 'Test product',
        price: 29.9,
        category: 'baloes',
        images: ['https://placehold.co/400'],
        thumbnailUrl: 'https://placehold.co/200',
        stock: 50,
        sku: `TEST-SKU-${Date.now()}`,
        weight: 0.5,
        isActive: true,
      },
    });
    testProductId = product.id;
  });

  afterAll(async () => {
    if (testProductId) {
      await prisma.orderItem.deleteMany({ where: { productId: testProductId } });
      await prisma.inventoryLog.deleteMany({ where: { productId: testProductId } });
      await prisma.product.delete({ where: { id: testProductId } }).catch(() => {});
    }
    await closeApp();
  });

  it('POST /v1/orders — should create an order', async () => {
    if (!accessToken) return;
    const agent = await api();
    const res = await agent
      .post('/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        items: [{ productId: testProductId, quantity: 2, unitPrice: 29.9 }],
        idempotencyKey: crypto.randomUUID(),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('RESERVED');
    expect(res.body.data.items).toHaveLength(1);

    const product = await prisma.product.findUnique({
      where: { id: testProductId },
      select: { reservedStock: true },
    });
    expect(product?.reservedStock).toBeGreaterThanOrEqual(2);
  });

  it('POST /v1/orders — idempotency prevents duplicate', async () => {
    if (!accessToken) return;
    const idempotencyKey = crypto.randomUUID();
    const body = {
      items: [{ productId: testProductId, quantity: 1, unitPrice: 29.9 }],
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

    expect(first.body.data.id).toBe(second.body.data.id);
  });

  it('POST /v1/orders — should reject without auth', async () => {
    const agent = await api();
    const res = await agent
      .post('/v1/orders')
      .send({
        items: [{ productId: testProductId, quantity: 1, unitPrice: 29.9 }],
      });

    expect(res.status).toBe(401);
  });

  it('GET /v1/orders — should list user orders', async () => {
    if (!accessToken) return;
    const agent = await api();
    const res = await agent
      .get('/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });
});
