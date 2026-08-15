import { describe, it, expect, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { cacheDelete } from '../src/infra/cache/cache-utils.js';
import { SITEMAP_CACHE_KEY } from '../src/shared/utils/sitemap.js';

function api() {
  return getApp().then((app) => supertest(app.server));
}

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

describe('GET /sitemap.xml', () => {
  afterAll(async () => {
    await closeApp();
  });

  it('returns valid XML with at least one /produto/<slug> entry for an active product', async () => {
    const suffix = uniqueSuffix();
    const product = await prisma.product.create({
      data: {
        name: `Sitemap Test Product ${suffix}`,
        slug: `sitemap-test-product-${suffix}`,
        description: 'Product used to assert sitemap generation',
        shortDescription: 'Sitemap test',
        price: 9.9,
        category: 'baloes',
        images: ['https://placehold.co/400'],
        thumbnailUrl: 'https://placehold.co/200',
        stock: 5,
        sku: `SITEMAP-SKU-${suffix}`,
        weight: 0.2,
        isActive: true,
      },
    });

    try {
      // Force a fresh render — a previous test/dev-server hit may have
      // cached the sitemap in Redis before this product existed.
      await cacheDelete(SITEMAP_CACHE_KEY);

      const agent = await api();
      const res = await agent.get('/sitemap.xml');

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('application/xml');

      const xml = res.text as string;
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
      expect(xml).toContain(`/produto/${product.slug}`);
      expect(xml).toContain('/produtos?category=baloes');
      expect(xml).toContain('/categorias');

      // Second call should be served from cache but still valid/identical.
      const cachedRes = await agent.get('/sitemap.xml');
      expect(cachedRes.status).toBe(200);
      expect(cachedRes.text).toBe(xml);
    } finally {
      await prisma.product.delete({ where: { id: product.id } }).catch(() => undefined);
      await cacheDelete(SITEMAP_CACHE_KEY);
    }
  });
});
