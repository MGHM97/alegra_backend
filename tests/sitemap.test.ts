import { describe, it, expect, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { cacheDelete } from '../src/infra/cache/cache-utils.js';
import { SITEMAP_CACHE_KEY } from '../src/shared/utils/sitemap.js';
import { env } from '../src/infra/config/env.js';

const SITE_BASE_URL = env.PUBLIC_SITE_URL.replace(/\/+$/, '');

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
      expect(xml).toContain(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      );
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

  it('includes <image:image> entries (Google Imagens), capped at 5, with absolute URLs and escaped title/loc', async () => {
    const suffix = uniqueSuffix();
    // 7 images to assert the 5-per-product cap; one relative (/uploads/...)
    // to assert PUBLIC_SITE_URL prefixing; name/image carry all 5 XML
    // special chars to assert escaping in both <image:title> and <image:loc>.
    const rawImages = [
      `/uploads/produtos/sitemap-${suffix}-1.jpg`,
      `https://cdn.example.com/sitemap-${suffix}-2.jpg?a=1&b=2`,
      `https://cdn.example.com/sitemap-${suffix}-3.jpg`,
      `https://cdn.example.com/sitemap-${suffix}-4.jpg`,
      `https://cdn.example.com/sitemap-${suffix}-5.jpg`,
      `https://cdn.example.com/sitemap-${suffix}-6.jpg`,
      `https://cdn.example.com/sitemap-${suffix}-7.jpg`,
    ];
    const product = await prisma.product.create({
      data: {
        name: `Balão & Festa "Top" <especial> ${suffix}`,
        slug: `sitemap-image-test-${suffix}`,
        description: 'Product used to assert sitemap image extension',
        shortDescription: 'Sitemap image test',
        price: 15,
        category: 'baloes',
        images: rawImages,
        thumbnailUrl: 'https://placehold.co/200',
        stock: 5,
        sku: `SITEMAP-IMG-SKU-${suffix}`,
        weight: 0.2,
        isActive: true,
      },
    });

    try {
      await cacheDelete(SITEMAP_CACHE_KEY);

      const agent = await api();
      const res = await agent.get('/sitemap.xml');

      expect(res.status).toBe(200);
      const xml = res.text as string;

      expect(xml).toContain(
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">',
      );

      // Relative upload path resolved to an absolute URL under PUBLIC_SITE_URL.
      expect(xml).toContain(`<image:loc>${SITE_BASE_URL}/uploads/produtos/`);

      // Escaped title: & < > " ' all converted to entities, raw chars absent
      // from the emitted <image:title> content.
      expect(xml).toContain('<image:title>Balão &amp; Festa &quot;Top&quot; &lt;especial&gt;');

      // Escaped loc: the query-string `&` in the second image URL is escaped.
      expect(xml).toContain(`sitemap-${suffix}-2.jpg?a=1&amp;b=2`);
      expect(xml).not.toContain(`sitemap-${suffix}-2.jpg?a=1&b=2`);

      // Capped at 5 images even though 7 were provided.
      const imageCount = xml.split(`sitemap-${suffix}-`).length - 1;
      // Each occurrence appears once inside <image:loc> per capped image, plus
      // once in <image:title> is NOT the case (title has no image URL) — so
      // this counts exactly the <image:loc> occurrences for this product.
      expect(imageCount).toBe(5);
      expect(xml).not.toContain(`sitemap-${suffix}-6.jpg`);
      expect(xml).not.toContain(`sitemap-${suffix}-7.jpg`);
    } finally {
      await prisma.product.delete({ where: { id: product.id } }).catch(() => undefined);
      await cacheDelete(SITEMAP_CACHE_KEY);
    }
  });
});
