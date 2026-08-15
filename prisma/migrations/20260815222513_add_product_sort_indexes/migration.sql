-- Server-side sort for GET /v1/products (sort=relevance|price_asc|price_desc
-- |newest|best_sellers|top_rated|discount). See schema.prisma comments on
-- Product.discountPercent and the @@index block for the reasoning.
--
-- NOTE: `prisma migrate dev --create-only` also generated a DROP/CREATE of
-- "orders_status_created_at_idx" here, because schema.prisma's `@@index` for
-- Order cannot express the `INCLUDE ("total_amount")` clause that index
-- actually has in the database (added by hand in migration
-- 20260815010000_perf_indexes — see docs/migrations.md and MEMORY.md
-- "migrations-baseline"). Applying that DROP/CREATE as generated would
-- silently drop the INCLUDE and regress GET /v1/admin/metrics from an Index
-- Only Scan back to a Bitmap Heap Scan. Removed here; that index is
-- untouched by this migration.

-- AlterTable
-- discount_percent is a Postgres GENERATED ALWAYS ... STORED column, not a
-- normal writable one (Prisma's DSL cannot express GENERATED, so this was
-- hand-written — see schema.prisma comment on Product.discountPercent).
-- Fraction of discount in [0, 1); 0 when there's no originalPrice or it
-- isn't greater than price. Computed once per row at ALTER TABLE time for
-- existing rows (fast at current catalog size) and automatically kept in
-- sync by Postgres on every future INSERT/UPDATE of price/original_price —
-- no application-level backfill or write path needed.
ALTER TABLE "products" ADD COLUMN "discount_percent" DECIMAL(5,4)
  GENERATED ALWAYS AS (
    CASE
      WHEN "original_price" IS NOT NULL AND "original_price" > "price" AND "original_price" > 0
      THEN ROUND((("original_price" - "price") / "original_price")::numeric, 4)
      ELSE 0
    END
  ) STORED;

-- CreateIndex
CREATE INDEX "products_sold_count_id_idx" ON "products"("sold_count" DESC, "id");

-- CreateIndex
CREATE INDEX "products_average_rating_review_count_idx" ON "products"("average_rating" DESC, "review_count" DESC);

-- CreateIndex
CREATE INDEX "products_price_id_idx" ON "products"("price", "id");

-- CreateIndex
CREATE INDEX "products_discount_percent_id_idx" ON "products"("discount_percent" DESC, "id");
