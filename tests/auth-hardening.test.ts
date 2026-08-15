import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';
import { verifyRefreshToken } from '../src/shared/utils/jwt.js';

function api() {
  return getApp().then((app) => supertest(app.server));
}

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * usernameSchema caps usernames at 20 chars. Prefixing with the descriptive
 * `prefix` and THEN appending `uniqueSuffix()` (timestamp digits first,
 * random chars last) truncates away most or all of the random entropy once
 * `.slice(0, 20)` is applied for longer prefixes — collapsing collision
 * resistance down to just the millisecond timestamp's leading digits, which
 * only change every ~2.8 hours. Reusing test users left in the DB from an
 * earlier run within that window then trips a spurious 409 on register.
 * Keeping the prefix to 2 chars and putting high-entropy random chars first
 * guarantees uniqueness regardless of prefix length or run timing.
 */
function randomUsername(prefix: string): string {
  const tag = prefix.slice(0, 2).toLowerCase();
  const random = Math.random().toString(36).slice(2, 2 + (18 - tag.length));
  return `${tag}${random}`;
}

async function clearLoginRateLimit(): Promise<void> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys('ratelimit:login:*');
    if (keys.length > 0) await redis.del(keys);
  } catch {
    /* ignore — Redis may not be available */
  }
}

interface RegisteredUser {
  id: string;
  email: string;
  username: string;
  password: string;
}

async function registerUser(prefix: string, role: 'CUSTOMER' | 'ADMIN' = 'CUSTOMER'): Promise<RegisteredUser> {
  const suffix = uniqueSuffix();
  const user = {
    email: `${prefix}_${suffix}@alegrafestas.com.br`,
    username: randomUsername(prefix),
    password: 'TestPass123',
    name: `${prefix} test user`,
  };
  const agent = await api();
  const res = await agent.post('/v1/auth/register').send(user);
  expect(res.status).toBe(201);
  const id = res.body.data.id as string;

  if (role === 'ADMIN') {
    await prisma.user.update({ where: { id }, data: { role: 'ADMIN' } });
  }

  return { id, email: user.email, username: user.username, password: user.password };
}

/**
 * The login rate limiter is keyed per-IP (see auth-routes.ts). All test
 * files in this suite hit the API from the same loopback address, so
 * without this, concurrently-running test files would share one
 * 5-attempts/15min IP budget and spuriously 429 each other's logins. A
 * distinct forged X-Forwarded-For per call keeps this helper's logins off
 * that shared budget (trustProxy: 1 makes the server honor it as the
 * effective request.ip) — except in the identifier-rate-limit test itself,
 * which deliberately manages its own forged IPs to prove the per-identifier
 * key still catches repeated attempts against the SAME account.
 */
function randomForwardedFor(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.80.${r()}.${r()}`;
}

async function login(identifier: string, password: string): Promise<{ accessToken: string; setCookies: string[] }> {
  const agent = await api();
  const res = await agent
    .post('/v1/auth/login')
    .set('X-Forwarded-For', randomForwardedFor())
    .send({ identifier, password });
  expect(res.status).toBe(200);
  const raw = res.headers['set-cookie'];
  const setCookies: string[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  return { accessToken: res.body.data.accessToken as string, setCookies };
}

function extractCookiePair(setCookies: string[], name: string): string {
  const found = setCookies.find((c) => c.startsWith(`${name}=`));
  if (!found) {
    throw new Error(`Cookie ${name} not found in Set-Cookie headers`);
  }
  const pair = found.split(';')[0];
  if (!pair) {
    throw new Error(`Malformed cookie header for ${name}`);
  }
  return pair;
}

describe('Auth Hardening', () => {
  beforeAll(async () => {
    await clearLoginRateLimit();
  });

  afterAll(async () => {
    await closeApp();
  });

  it('reusing a revoked refresh token is rejected AND revokes the entire token family', async () => {
    const user = await registerUser('refresh');
    const loginResult = await login(user.email, user.password);
    const cookieA = extractCookiePair(loginResult.setCookies, 'refreshToken');

    // Use token A to rotate -> receive token B (A is now revoked).
    const agent1 = await api();
    const refreshRes1 = await agent1.post('/v1/auth/refresh').set('Cookie', cookieA);
    expect(refreshRes1.status).toBe(200);
    const rawB = refreshRes1.headers['set-cookie'];
    const setCookiesB: string[] = Array.isArray(rawB) ? rawB : typeof rawB === 'string' ? [rawB] : [];
    const cookieB = extractCookiePair(setCookiesB, 'refreshToken');

    // Re-present the already-revoked token A.
    const agent2 = await api();
    const reuseRes = await agent2.post('/v1/auth/refresh').set('Cookie', cookieA);
    expect(reuseRes.status).toBe(401);

    // Token B (issued from the same family) must now be revoked too.
    const agent3 = await api();
    const bRes = await agent3.post('/v1/auth/refresh').set('Cookie', cookieB);
    expect(bRes.status).toBe(401);

    // Verify directly in the DB: every refresh token for this user is revoked.
    const tokenBValue = cookieB.split('=')[1] ?? '';
    const decodedB = verifyRefreshToken(tokenBValue);
    const rows = await prisma.refreshToken.findMany({ where: { userId: decodedB.sub } });
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((row) => row.revokedAt !== null)).toBe(true);
  });

  it('login rate limit is keyed by identifier — forging X-Forwarded-For per attempt does not bypass it', async () => {
    await clearLoginRateLimit();
    const user = await registerUser('ratelimit');

    let lastStatus = 0;
    for (let i = 0; i < 6; i++) {
      const agent = await api();
      const res = await agent
        .post('/v1/auth/login')
        .set('X-Forwarded-For', `10.13.${i}.${i}`)
        .send({ identifier: user.email, password: 'WrongPassword999' });
      lastStatus = res.status;
      if (i < 5) {
        expect(res.status).toBe(401);
      }
    }

    expect(lastStatus).toBe(429);
  });

  it('deactivating a user immediately revokes their existing access token; reactivating restores access', async () => {
    const admin = await registerUser('toggleadmin', 'ADMIN');
    const adminLogin = await login(admin.email, admin.password);

    const target = await registerUser('toggletarget');
    const targetLogin = await login(target.email, target.password);

    const meBefore = await (await api())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${targetLogin.accessToken}`);
    expect(meBefore.status).toBe(200);

    const deactivateRes = await (await api())
      .patch(`/v1/admin/users/${target.id}/status`)
      .set('Authorization', `Bearer ${adminLogin.accessToken}`)
      .send({ isActive: false });
    expect(deactivateRes.status).toBe(200);

    const meAfterDeactivate = await (await api())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${targetLogin.accessToken}`);
    expect(meAfterDeactivate.status).toBe(401);

    const reactivateRes = await (await api())
      .patch(`/v1/admin/users/${target.id}/status`)
      .set('Authorization', `Bearer ${adminLogin.accessToken}`)
      .send({ isActive: true });
    expect(reactivateRes.status).toBe(200);

    const meAfterReactivate = await (await api())
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${targetLogin.accessToken}`);
    expect(meAfterReactivate.status).toBe(200);
  });

  it('PATCH /v1/admin/orders/:id/status with status REFUNDED is rejected — REFUNDED is not a valid manual transition', async () => {
    const admin = await registerUser('refundadmin', 'ADMIN');
    const adminLogin = await login(admin.email, admin.password);

    const customer = await registerUser('refundcustomer');
    const customerLogin = await login(customer.email, customer.password);

    const suffix = uniqueSuffix();
    const product = await prisma.product.create({
      data: {
        name: `Refund Transition Test Product ${suffix}`,
        slug: `refund-transition-test-product-${suffix}`,
        description: 'A product for the refund-transition test',
        shortDescription: 'Test product',
        price: 10,
        category: 'baloes',
        images: ['https://placehold.co/400'],
        thumbnailUrl: 'https://placehold.co/200',
        stock: 10,
        sku: `REFTR-SKU-${suffix}`,
        weight: 0.5,
        isActive: true,
      },
    });

    try {
      const orderRes = await (await api())
        .post('/v1/orders')
        .set('Authorization', `Bearer ${customerLogin.accessToken}`)
        .send({
          items: [{ productId: product.id, quantity: 1, unitPrice: 10 }],
          idempotencyKey: crypto.randomUUID(),
        });
      expect(orderRes.status).toBe(201);
      const orderId = orderRes.body.data.id as string;

      const statusRes = await (await api())
        .patch(`/v1/admin/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminLogin.accessToken}`)
        .send({ status: 'REFUNDED' });

      expect([400, 422]).toContain(statusRes.status);
    } finally {
      await prisma.orderItem.deleteMany({ where: { productId: product.id } });
      await prisma.inventoryLog.deleteMany({ where: { productId: product.id } });
      await prisma.order.deleteMany({ where: { items: { some: { productId: product.id } } } });
      await prisma.product.delete({ where: { id: product.id } }).catch(() => undefined);
    }
  });
});
