---
name: product-sort-cursor
description: Server-side sort on GET /v1/products (15/08/2026) — GENERATED STORED column for discount, composite cursor shape, legacy-cursor semantics
metadata:
  type: feedback
---

Added `sort` (relevance|price_asc|price_desc|newest|best_sellers|top_rated|
discount) to `GET /v1/products`, replacing the old fixed `createdAt desc`.
Key decisions, in case a future sort/filter addition needs the same pattern:

**Computed sort columns get a real Postgres GENERATED ALWAYS ... STORED
column, not `$queryRaw`.** `discount` needed `(originalPrice - price) /
originalPrice` — the task spec assumed this might require raw SQL, but a
generated column (`Product.discountPercent`, migration
`add_product_sort_indexes`) keeps it in the exact same typed Prisma
`orderBy`/`where`/index code path as every other sort. Prisma's DSL can't
express `GENERATED ALWAYS AS (...) STORED`, so the migration SQL is hand
-written after `--create-only` (same precedent as the `INCLUDE` clause on
`orders_status_created_at_idx`, see [[migrations-baseline]]). Never write to
a GENERATED column via `create`/`update` — Postgres rejects it; the domain
`CreateProductInput`/`UpdateProductInput` types deliberately don't include
it.

**Cursor shape is `{v, id}` normally, but top_rated needs a 3rd field.**
`top_rated` orders by `(averageRating desc NULLS LAST, reviewCount desc,
id)` — a genuine two-column primary sort. A cursor with only `{v: rating,
id}` can't correctly keyset-paginate across a page boundary where two
products tie on `averageRating` but differ in `reviewCount` (the `id`
tie-break in the WHERE wouldn't match the `reviewCount` tie-break in the
`orderBy`). Extended the opaque cursor to `{v, v2?, id}` — `v2` carries
`reviewCount`, unused by every other sort. Documented in
`src/infra/database/product-list-cursor.ts`. If a future sort needs a
3-column primary order, follow the same pattern rather than dropping the
secondary tiebreak for cursor-shape purity.

**Legacy plain-uuid cursors are still accepted and force `newest`,
regardless of the `sort` query param.** Before this feature `cursor` was
just a raw product id (zod `.uuid()`); old clients or cached links may still
send that shape. The repository detects it via a UUID regex before
attempting base64url+JSON decode, looks up that product's `createdAt`, and
paginates as `newest` — overriding whatever `sort` was requested, since a
legacy cursor carries no sort information and the pre-existing behavior was
always `createdAt desc`. Covered by a test that explicitly passes
`sort=price_asc` with a legacy cursor and asserts it still returns the
`newest` continuation, not the price-sorted one.

**Internal-only columns needed to build the outgoing cursor (createdAt,
discountPercent) must never flow into the public response.** They're
selected in the Prisma query (`PRODUCT_LIST_SELECT`) so the cursor can be
built from the same row, but the repository maps each row through an
explicit `toListItem()` that only copies `ProductListItem`'s public fields
— never spread the raw Prisma row into the response, or extra columns leak
as-is (Decimal's default `toJSON` stringifies, so it wouldn't crash, just
silently leak an undocumented field).

Full detail: `src/infra/database/prisma-product-repository.ts` and
`src/infra/database/product-list-cursor.ts`.
