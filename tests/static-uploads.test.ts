import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import fs from 'node:fs';
import path from 'node:path';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';

// Well-known minimal valid 1x1 transparent PNG (real magic bytes + IHDR/IDAT/IEND).
const VALID_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

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
  return `10.80.${r()}.${r()}`;
}

const ADMIN_USER = {
  email: `static_admin_${uniqueSuffix()}@alegrafestas.com.br`,
  username: `sta${uniqueSuffix()}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Static Uploads Admin',
};

let adminToken = '';
let uploadedUrl = '';
const uploadedFilePaths: string[] = [];

function uploadsDir(): string {
  return path.join(process.cwd(), 'public', 'uploads', 'products');
}

function urlToFilePath(url: string): string {
  const filename = url.split('/').pop() ?? '';
  return path.join(uploadsDir(), filename);
}

/**
 * Regression coverage for the @fastify/static ^9 -> ^10 bump (CVE-2026-7120 /
 * CVE-2026-15074 — allowedPath bypass and route-guard bypass via
 * non-canonical dot-segment paths). We don't use `allowedPath` as a security
 * boundary here (the whole `/uploads` root is intentionally public), so what
 * matters for us is the baseline guarantee @fastify/send has always
 * provided: a request can never resolve to a path outside the configured
 * `root`, and directory listing stays off by default.
 */
describe('Static uploads (/uploads) — path traversal & listing', () => {
  beforeAll(async () => {
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys('ratelimit:login:*');
      if (keys.length > 0) await redis.del(keys);
    } catch {
      /* ignore */
    }

    const agent = await api();
    const registerRes = await agent.post('/v1/auth/register').send(ADMIN_USER);
    expect(registerRes.status).toBe(201);
    const userId = registerRes.body.data.id as string;
    await prisma.user.update({ where: { id: userId }, data: { role: 'ADMIN' } });

    const loginRes = await (await api())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomForwardedFor())
      .send({ identifier: ADMIN_USER.email, password: ADMIN_USER.password });
    adminToken = loginRes.body.data?.accessToken as string;

    if (adminToken) {
      const pngBuffer = Buffer.from(VALID_PNG_BASE64, 'base64');
      const uploadRes = await (await api())
        .post('/v1/admin/uploads/images')
        .set('Authorization', `Bearer ${adminToken}`)
        .attach('files', pngBuffer, { filename: 'traversal-fixture.png', contentType: 'image/png' });

      expect(uploadRes.status).toBe(201);
      uploadedUrl = uploadRes.body.data.urls[0] as string;
      uploadedFilePaths.push(urlToFilePath(uploadedUrl));
    }
  });

  afterAll(async () => {
    for (const filePath of uploadedFilePaths) {
      await fs.promises.unlink(filePath).catch(() => undefined);
    }
    await closeApp();
  });

  it('(a) GET /uploads/<file> — returns 200 with the correct content-type for a valid upload', async () => {
    if (!uploadedUrl) return;
    const uploadPath = new URL(uploadedUrl).pathname;

    const agent = await api();
    const res = await agent.get(uploadPath);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^image\/png/);
  });

  it('(b) GET /uploads/../package.json — never returns the file, no 200 with package.json content', async () => {
    const agent = await api();
    const res = await agent.get('/uploads/../package.json');

    expect(res.status).not.toBe(200);
    expect(res.text ?? '').not.toContain('alegra-festas-backend');
  });

  it('(b) GET /uploads/../../package.json (two levels, real target exists) — 404/403, never leaks content', async () => {
    const agent = await api();
    const res = await agent.get('/uploads/../../package.json');

    expect([403, 404]).toContain(res.status);
    expect(res.text ?? '').not.toContain('alegra-festas-backend');
  });

  it('(b) GET /uploads/%2e%2e/%2e%2e/package.json (URL-encoded dot segments) — never leaks content', async () => {
    const agent = await api();
    const res = await agent.get('/uploads/%2e%2e/%2e%2e/package.json');

    expect([403, 404]).toContain(res.status);
    expect(res.text ?? '').not.toContain('alegra-festas-backend');
  });

  it('(b) GET /uploads/products/%2e%2e%2fpackage.json (encoded slash variant) — never leaks content', async () => {
    const agent = await api();
    const res = await agent.get('/uploads/products/%2e%2e%2f%2e%2e%2fpackage.json');

    expect([403, 404]).toContain(res.status);
    expect(res.text ?? '').not.toContain('alegra-festas-backend');
  });

  it('(c) GET /uploads/ — never returns a directory listing', async () => {
    const agent = await api();
    const res = await agent.get('/uploads/');

    // No `list` option is configured, so this must never expose the
    // { dirs, files } JSON directory listing @fastify/static supports.
    if (res.status === 200) {
      expect(res.body).not.toHaveProperty('files');
      expect(res.body).not.toHaveProperty('dirs');
    } else {
      expect([403, 404]).toContain(res.status);
    }
  });

  it('(c) GET /uploads/products/ — never returns a directory listing', async () => {
    const agent = await api();
    const res = await agent.get('/uploads/products/');

    if (res.status === 200) {
      expect(res.body).not.toHaveProperty('files');
      expect(res.body).not.toHaveProperty('dirs');
    } else {
      expect([403, 404]).toContain(res.status);
    }
  });
});
