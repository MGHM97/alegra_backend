-- Performance pass (EXPLAIN ANALYZE-driven). See schema.prisma comments on
-- Product and Order for the measurements behind each index.

-- pg_trgm: enables GIN trigram indexes for ILIKE '%term%' search on
-- products.name / products.description (GET /v1/products?search=).
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX IF NOT EXISTS "products_name_trgm_idx"
  ON "products" USING GIN ("name" gin_trgm_ops);

CREATE INDEX IF NOT EXISTS "products_description_trgm_idx"
  ON "products" USING GIN ("description" gin_trgm_ops);

-- Covering index for GET /v1/admin/metrics revenue aggregates: replaces the
-- plain (status, created_at) index with one that also stores total_amount,
-- turning the SUM(total_amount) aggregation into an Index Only Scan instead
-- of a Bitmap Heap Scan with random heap fetches. Same leading columns as
-- the original index (same query patterns still served), so this is a
-- drop-in replacement, not an additional index.
DROP INDEX IF EXISTS "orders_status_created_at_idx";
CREATE INDEX "orders_status_created_at_idx"
  ON "orders" ("status", "created_at") INCLUDE ("total_amount");
