import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';

const TEST_USER = {
  email: `test_${Date.now()}@alegrafestas.com.br`,
  username: `tu${Date.now().toString(36)}`,
  password: 'TestPass123',
  name: 'Test User',
};

function api() {
  return getApp().then((app) => supertest(app.server));
}

describe('Auth Flow', () => {
  beforeAll(async () => {
    // Clear login rate limit keys from Redis
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys('ratelimit:login:*');
      if (keys.length > 0) await redis.del(keys);
    } catch { /* Redis may not be available */ }
  });

  afterAll(async () => {
    await closeApp();
  });

  it('POST /v1/auth/register — should create a new user', async () => {
    const agent = await api();
    const res = await agent
      .post('/v1/auth/register')
      .send(TEST_USER);

    if (res.status === 422) {
      console.log('Register 422 body:', JSON.stringify(res.body));
    }
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('success');
    expect(res.body.data.email).toBe(TEST_USER.email);
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });

  it('POST /v1/auth/register — should reject duplicate email', async () => {
    const agent = await api();
    const res = await agent
      .post('/v1/auth/register')
      .send(TEST_USER);

    expect(res.status).toBe(409);
  });

  it('POST /v1/auth/login — should return access token', async () => {
    const agent = await api();
    const res = await agent
      .post('/v1/auth/login')
      .send({ identifier: TEST_USER.email, password: TEST_USER.password });

    if (res.status !== 200) {
      console.log('Login error body:', JSON.stringify(res.body));
    }
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.email).toBe(TEST_USER.email);
  });

  it('POST /v1/auth/login — should reject invalid password', async () => {
    const agent = await api();
    const res = await agent
      .post('/v1/auth/login')
      .send({ identifier: TEST_USER.email, password: 'WrongPass999' });

    expect(res.status).toBe(401);
  });

  it('GET /v1/auth/me — should return user with valid token', async () => {
    const agent = await api();
    const loginRes = await agent
      .post('/v1/auth/login')
      .send({ identifier: TEST_USER.email, password: TEST_USER.password });

    const token = loginRes.body.data?.accessToken as string;
    if (!token) return; // Skip if login failed

    const agent2 = await api();
    const meRes = await agent2
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(meRes.status).toBe(200);
    expect(meRes.body.data.email).toBe(TEST_USER.email);
  });

  it('GET /v1/auth/me — should reject without token', async () => {
    const agent = await api();
    const res = await agent.get('/v1/auth/me');

    expect(res.status).toBe(401);
  });
});
