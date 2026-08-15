-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "review_reminder_sent_at" TIMESTAMP(3);

-- NOTA: prisma migrate diff propôs um DROP INDEX/CREATE INDEX de
-- orders_status_created_at_idx aqui, por causa de um falso-positivo de
-- introspecção: o schema.prisma expressa apenas (status, created_at), mas o
-- índice real no banco é um índice de cobertura
-- `(status, created_at) INCLUDE (total_amount)` (ver migration
-- perf_indexes e o comentário no model Order em schema.prisma). Recriar sem
-- o INCLUDE destruiria a otimização medida em GET /v1/admin/metrics
-- (Index Only Scan ~1.4ms -> volta a Bitmap Heap Scan ~12-15ms em 300k
-- pedidos) sem nenhum ganho relacionado a esta migration. Removido
-- deliberadamente — não reintroduzir sem recriar o INCLUDE.
