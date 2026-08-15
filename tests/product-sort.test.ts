import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

const RUN_ID = uniqueSuffix();
// Scopes every request in this file to only the 6 fixtures below, isolating
// assertions from seed data / other test files' products sharing the table.
const CATEGORY = `sort-test-${RUN_ID}`;

function api() {
  return getApp().then((app) => supertest(app.server));
}

interface Fixture {
  key: string;
  price: number;
  originalPrice: number | null;
  soldCount: number;
  averageRating: number | null;
  reviewCount: number;
}

// price: distinct, strictly increasing A..F — makes price_asc/price_desc
// fully deterministic.
// soldCount: distinct, unrelated to price ordering.
// averageRating: distinct where set; B and E are null (no reviews yet) to
// exercise NULLS LAST; non-null ratings are also distinct so top_rated's
// order is fully deterministic among them.
// originalPrice: set (with distinct resulting discount fraction) for A, C, E;
// left null (discount 0) for B, D, F.
const FIXTURES: Fixture[] = [
  { key: 'A', price: 10, originalPrice: 12, soldCount: 5, averageRating: 4.0, reviewCount: 2 }, // discount 0.1667
  { key: 'B', price: 20, originalPrice: null, soldCount: 50, averageRating: null, reviewCount: 0 },
  { key: 'C', price: 30, originalPrice: 45, soldCount: 20, averageRating: 5.0, reviewCount: 8 }, // discount 0.3333
  { key: 'D', price: 40, originalPrice: null, soldCount: 100, averageRating: 3.5, reviewCount: 1 },
  { key: 'E', price: 50, originalPrice: 70, soldCount: 1, averageRating: null, reviewCount: 0 }, // discount 0.2857
  { key: 'F', price: 60, originalPrice: null, soldCount: 10, averageRating: 4.5, reviewCount: 4 },
];

const ids: Record<string, string> = {};

describe('GET /v1/products — server-side sort', () => {
  beforeAll(async () => {
    // Spaced 1s apart, in fixture order, so createdAt desc ("newest") is the
    // exact reverse of FIXTURES: F, E, D, C, B, A.
    const base = Date.now() - FIXTURES.length * 1000;
    for (let i = 0; i < FIXTURES.length; i++) {
      const f = FIXTURES[i];
      const createdAt = new Date(base + i * 1000);
      const product = await prisma.product.create({
        data: {
          name: `Sort Test Product ${f.key} ${RUN_ID}`,
          slug: `sort-test-product-${f.key.toLowerCase()}-${RUN_ID}`,
          description: `Sort fixture description marker ${RUN_ID}`,
          shortDescription: 'Sort test fixture',
          price: f.price,
          originalPrice: f.originalPrice,
          category: CATEGORY,
          images: ['https://placehold.co/400'],
          thumbnailUrl: 'https://placehold.co/200',
          stock: 50,
          sku: `SORT-SKU-${f.key}-${RUN_ID}`,
          weight: 0.5,
          isActive: true,
          soldCount: f.soldCount,
          averageRating: f.averageRating,
          reviewCount: f.reviewCount,
          createdAt,
          updatedAt: createdAt,
        },
        select: { id: true },
      });
      ids[f.key] = product.id;
    }
  });

  afterAll(async () => {
    await prisma.product.deleteMany({ where: { category: CATEGORY } });
    await closeApp();
  });

  function keysOf(body: { data: Array<{ id: string }> }): string[] {
    const byId = new Map(Object.entries(ids).map(([k, v]) => [v, k]));
    return body.data.map((p) => byId.get(p.id) ?? `?${p.id}`);
  }

  it('price_asc — ascending, distinct prices fully ordered', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY, sort: 'price_asc' });
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('price_desc — descending, distinct prices fully ordered', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY, sort: 'price_desc' });
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
  });

  it('newest — createdAt desc (reverse creation order)', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY, sort: 'newest' });
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
  });

  it('relevance (default, no sort param) — same as newest', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY });
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
  });

  it('relevance with search — keeps createdAt desc (unchanged pre-existing search behavior)', async () => {
    const res = await (await api())
      .get('/v1/products')
      .query({ category: CATEGORY, search: RUN_ID, sort: 'relevance' });
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(['F', 'E', 'D', 'C', 'B', 'A']);
  });

  it('best_sellers — soldCount desc', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY, sort: 'best_sellers' });
    expect(res.status).toBe(200);
    // D=100, B=50, C=20, F=10, A=5, E=1
    expect(keysOf(res.body)).toEqual(['D', 'B', 'C', 'F', 'A', 'E']);
  });

  it('top_rated — averageRating desc, reviewCount desc tiebreak, NULLS LAST', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY, sort: 'top_rated' });
    expect(res.status).toBe(200);
    const order = keysOf(res.body);
    // Non-null ratings fully deterministic: C=5.0, F=4.5, A=4.0, D=3.5.
    expect(order.slice(0, 4)).toEqual(['C', 'F', 'A', 'D']);
    // Null-rating products (B, E) always come after every non-null rating,
    // in either relative order between themselves.
    expect(new Set(order.slice(4))).toEqual(new Set(['B', 'E']));
  });

  it('discount — highest discount fraction first, 0% (no originalPrice) last', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY, sort: 'discount' });
    expect(res.status).toBe(200);
    const order = keysOf(res.body);
    // Distinct discounts fully deterministic: C=0.3333, E=0.2857, A=0.1667.
    expect(order.slice(0, 3)).toEqual(['C', 'E', 'A']);
    // B, D, F all have discount 0 (no originalPrice) — tied group, comes last.
    expect(new Set(order.slice(3))).toEqual(new Set(['B', 'D', 'F']));
  });

  it('price_asc pagination — limit=2 across 3 pages, no repeats or skips', async () => {
    const agent = await api();

    const page1 = await agent.get('/v1/products').query({ category: CATEGORY, sort: 'price_asc', limit: 2 });
    expect(page1.status).toBe(200);
    expect(keysOf(page1.body)).toEqual(['A', 'B']);
    expect(page1.body.meta.hasMore).toBe(true);
    expect(typeof page1.body.meta.cursor).toBe('string');

    const page2 = await agent
      .get('/v1/products')
      .query({ category: CATEGORY, sort: 'price_asc', limit: 2, cursor: page1.body.meta.cursor as string });
    expect(page2.status).toBe(200);
    expect(keysOf(page2.body)).toEqual(['C', 'D']);
    expect(page2.body.meta.hasMore).toBe(true);

    const page3 = await agent
      .get('/v1/products')
      .query({ category: CATEGORY, sort: 'price_asc', limit: 2, cursor: page2.body.meta.cursor as string });
    expect(page3.status).toBe(200);
    expect(keysOf(page3.body)).toEqual(['E', 'F']);
    expect(page3.body.meta.hasMore).toBe(false);
    expect(page3.body.meta.cursor).toBeNull();

    const allKeys = [...keysOf(page1.body), ...keysOf(page2.body), ...keysOf(page3.body)];
    expect(allKeys).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('legacy cursor (bare product uuid) — still accepted, resolves to newest', async () => {
    // Pre-sort clients only ever sent a bare product id as `cursor`, always
    // paginating createdAt desc. In newest order (F,E,D,C,B,A), C sits at
    // index 3 — a legacy cursor pointing at C should yield [B, A].
    const res = await (await api())
      .get('/v1/products')
      .query({ category: CATEGORY, cursor: ids['C'] });
    expect(res.status).toBe(200);
    expect(keysOf(res.body)).toEqual(['B', 'A']);
    expect(res.body.meta.hasMore).toBe(false);
  });

  it('legacy cursor overrides an explicit sort — still resolves to newest, not price_asc', async () => {
    const res = await (await api())
      .get('/v1/products')
      .query({ category: CATEGORY, sort: 'price_asc', cursor: ids['C'] });
    expect(res.status).toBe(200);
    // If this were honoring price_asc from C's price (30), it would return
    // [D, E, F]. Legacy cursors always mean "continue createdAt desc".
    expect(keysOf(res.body)).toEqual(['B', 'A']);
  });

  it('malformed cursor — rejected with 422, not a 500', async () => {
    const res = await (await api())
      .get('/v1/products')
      .query({ category: CATEGORY, cursor: 'not-a-valid-cursor-or-uuid!!' });
    expect(res.status).toBe(422);
  });

  it('meta.total — matches the count of active products for the filter, independent of limit', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY, limit: 2 });
    expect(res.status).toBe(200);
    // Only 2 of the 6 fixtures come back in `data` (limit=2), but total
    // counts all 6 that match the filter, not just the returned page.
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta.total).toBe(6);
  });

  it('meta.total — narrows with an additional filter (minPrice excludes A and B)', async () => {
    const res = await (await api()).get('/v1/products').query({ category: CATEGORY, minPrice: 30 });
    expect(res.status).toBe(200);
    // A=10, B=20 excluded; C=30, D=40, E=50, F=60 match.
    expect(res.body.meta.total).toBe(4);
  });

  it('meta.total — stays constant across paginated pages of the same filter', async () => {
    const agent = await api();

    const page1 = await agent.get('/v1/products').query({ category: CATEGORY, sort: 'price_asc', limit: 2 });
    expect(page1.body.meta.total).toBe(6);

    const page2 = await agent
      .get('/v1/products')
      .query({ category: CATEGORY, sort: 'price_asc', limit: 2, cursor: page1.body.meta.cursor as string });
    expect(page2.body.meta.total).toBe(6);
  });
});
