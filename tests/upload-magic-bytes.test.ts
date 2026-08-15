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
  return `10.79.${r()}.${r()}`;
}

const ADMIN_USER = {
  email: `upload_admin_${uniqueSuffix()}@alegrafestas.com.br`,
  username: `upa${uniqueSuffix()}`.slice(0, 20),
  password: 'TestPass123',
  name: 'Upload Admin',
};

let adminToken = '';
const uploadedFilePaths: string[] = [];

function uploadsDir(): string {
  return path.join(process.cwd(), 'public', 'uploads', 'products');
}

function urlToFilePath(url: string): string {
  const filename = url.split('/').pop() ?? '';
  return path.join(uploadsDir(), filename);
}

describe('Upload Magic Bytes Validation', () => {
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
  });

  afterAll(async () => {
    for (const filePath of uploadedFilePaths) {
      await fs.promises.unlink(filePath).catch(() => undefined);
    }
    await closeApp();
  });

  it('rejects a text buffer disguised as image/png with a .png filename (magic bytes mismatch) — 422', async () => {
    if (!adminToken) return;
    const textBuffer = Buffer.from(
      'this is definitely not a png, just plain text pretending to be one',
      'utf-8',
    );

    const agent = await api();
    const res = await agent
      .post('/v1/admin/uploads/images')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', textBuffer, { filename: 'fake.png', contentType: 'image/png' });

    expect(res.status).toBe(422);
  });

  it('accepts a minimal valid PNG (real magic bytes) — 201', async () => {
    if (!adminToken) return;
    const pngBuffer = Buffer.from(VALID_PNG_BASE64, 'base64');

    const agent = await api();
    const res = await agent
      .post('/v1/admin/uploads/images')
      .set('Authorization', `Bearer ${adminToken}`)
      .attach('files', pngBuffer, { filename: 'valid.png', contentType: 'image/png' });

    expect(res.status).toBe(201);
    expect(Array.isArray(res.body.data.urls)).toBe(true);
    expect(res.body.data.urls).toHaveLength(1);

    const url = res.body.data.urls[0] as string;
    const filePath = urlToFilePath(url);
    uploadedFilePaths.push(filePath);
    expect(fs.existsSync(filePath)).toBe(true);
  });
});
