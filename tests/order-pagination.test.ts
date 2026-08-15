import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

const TEST_USER = {
  email: `order_page_${uniqueSuffix()}@alegrafestas.com.br`,
  username: `op${uniqueSuffix()}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Order Pagination Test User',
};

const OTHER_USER = {
  email: `order_page_other_${uniqueSuffix()}@alegrafestas.com.br`,
  username: `opo${uniqueSuffix()}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Order Pagination Other User',
};

const TOTAL_ORDERS = 25;
const DEFAULT_LIMIT = 20;

let accessToken = '';
let testUserId = '';
let otherUserOrderId = '';
let testProductId = '';
/** ids in createdAt desc, id desc order — the order the API must return them in. */
let orderIdsNewestFirst: string[] = [];

function api() {
  return getApp().then((app) => supertest(app.server));
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
  return `10.81.${r()}.${r()}`;
}

async function createOrderDirect(userId: string, createdAt: Date, productId: string): Promise<string> {
  const order = await prisma.order.create({
    data: {
      userId,
      status: 'CONFIRMED',
      totalAmount: 29.9,
      createdAt,
      updatedAt: createdAt,
      items: {
        create: [{ productId, quantity: 1, unitPrice: 29.9, total: 29.9 }],
      },
    },
    select: { id: true },
  });
  return order.id;
}

describe('GET /v1/orders — cursor pagination', () => {
  beforeAll(async () => {
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys('ratelimit:login:*');
      if (keys.length > 0) await redis.del(keys);
    } catch {
      /* ignore */
    }

    const registerRes = await (await api()).post('/v1/auth/register').send(TEST_USER);
    testUserId = registerRes.body.data.id as string;

    const loginRes = await (await api())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomForwardedFor())
      .send({ identifier: TEST_USER.email, password: TEST_USER.password });
    accessToken = loginRes.body.data?.accessToken as string;

    const otherRegisterRes = await (await api()).post('/v1/auth/register').send(OTHER_USER);
    const otherUserId = otherRegisterRes.body.data.id as string;

    const product = await prisma.product.create({
      data: {
        name: `Pagination Test Product ${uniqueSuffix()}`,
        slug: `pagination-test-product-${uniqueSuffix()}`,
        description: 'A product for order pagination testing',
        shortDescription: 'Test product',
        price: 29.9,
        category: 'baloes',
        images: ['https://placehold.co/400'],
        thumbnailUrl: 'https://placehold.co/200',
        stock: 50,
        sku: `PAGE-SKU-${uniqueSuffix()}`,
        weight: 0.5,
        isActive: true,
      },
    });
    testProductId = product.id;

    // 25 orders spaced 1s apart so createdAt ordering is unambiguous, then
    // reversed so index 0 is the newest (the order the API must return).
    const base = Date.now() - TOTAL_ORDERS * 1000;
    const created: string[] = [];
    for (let i = 0; i < TOTAL_ORDERS; i++) {
      created.push(await createOrderDirect(testUserId, new Date(base + i * 1000), testProductId));
    }
    orderIdsNewestFirst = created.reverse();

    otherUserOrderId = await createOrderDirect(otherUserId, new Date(), testProductId);
  });

  afterAll(async () => {
    if (testProductId) {
      await prisma.orderItem.deleteMany({ where: { productId: testProductId } });
      await prisma.order.deleteMany({ where: { userId: testUserId } }).catch(() => {});
      if (otherUserOrderId) {
        await prisma.order.deleteMany({ where: { id: otherUserOrderId } }).catch(() => {});
      }
      await prisma.inventoryLog.deleteMany({ where: { productId: testProductId } });
      await prisma.product.delete({ where: { id: testProductId } }).catch(() => {});
    }
    await closeApp();
  });

  it('(a) first page — 20 items, hasMore true, cursor set to the 20th order', async () => {
    if (!accessToken) return;
    const agent = await api();
    const res = await agent.get('/v1/orders').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(DEFAULT_LIMIT);
    expect(res.body.meta.hasMore).toBe(true);
    expect(res.body.meta.cursor).toBe(orderIdsNewestFirst[DEFAULT_LIMIT - 1]);
    expect(res.body.data.map((o: { id: string }) => o.id)).toEqual(
      orderIdsNewestFirst.slice(0, DEFAULT_LIMIT),
    );
  });

  it('(a) second page via cursor — remaining 5 items, hasMore false, cursor null', async () => {
    if (!accessToken) return;
    const firstPage = await (await api())
      .get('/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`);
    const cursor = firstPage.body.meta.cursor as string;

    const agent = await api();
    const res = await agent
      .get('/v1/orders')
      .query({ cursor })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(TOTAL_ORDERS - DEFAULT_LIMIT);
    expect(res.body.meta.hasMore).toBe(false);
    expect(res.body.meta.cursor).toBeNull();
    expect(res.body.data.map((o: { id: string }) => o.id)).toEqual(
      orderIdsNewestFirst.slice(DEFAULT_LIMIT),
    );
  });

  it('(b) no params — defaults to 20', async () => {
    if (!accessToken) return;
    const agent = await api();
    const res = await agent.get('/v1/orders').set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(DEFAULT_LIMIT);
  });

  it('(c) limit=100 — rejected with 422 (capped at 50, not silently clamped)', async () => {
    if (!accessToken) return;
    const agent = await api();
    const res = await agent
      .get('/v1/orders')
      .query({ limit: 100 })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(422);
  });

  it('(c) limit=50 — accepted (upper bound)', async () => {
    if (!accessToken) return;
    const agent = await api();
    const res = await agent
      .get('/v1/orders')
      .query({ limit: 50 })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(TOTAL_ORDERS);
    expect(res.body.meta.hasMore).toBe(false);
  });

  it("(d) another user's cursor never leaks this user's — nor the other user's — orders", async () => {
    if (!accessToken) return;
    const agent = await api();
    const res = await agent
      .get('/v1/orders')
      .query({ cursor: otherUserOrderId })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.hasMore).toBe(false);
    expect(res.body.meta.cursor).toBeNull();
  });

  it('cursor pointing at a non-existent order id — empty page, not an error', async () => {
    if (!accessToken) return;
    const agent = await api();
    const res = await agent
      .get('/v1/orders')
      .query({ cursor: '00000000-0000-0000-0000-000000000000' })
      .set('Authorization', `Bearer ${accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});
