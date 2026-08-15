-- AlterTable
-- Agregados denormalizados de Product para o card estilo Mercado Livre
-- (averageRating/reviewCount recalculados a partir de Review; soldCount
-- mantido em sincronia com o ciclo de estoque). Ver comentário no schema.
ALTER TABLE "products" ADD COLUMN     "average_rating" DECIMAL(2,1),
ADD COLUMN     "review_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "sold_count" INTEGER NOT NULL DEFAULT 0;

-- NOTA: o Prisma gerou aqui um DROP INDEX + CREATE INDEX para
-- "orders_status_created_at_idx" porque o DSL do schema não expressa a
-- cláusula INCLUDE (total_amount) aplicada manualmente na migration
-- perf_indexes (20260815010000). Removido deliberadamente — recriar o
-- índice sem o INCLUDE perderia o Index Only Scan usado por
-- GET /v1/admin/metrics, silenciosamente. O índice real no banco
-- permanece intocado por esta migration.
