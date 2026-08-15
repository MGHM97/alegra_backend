-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentStatus" ADD VALUE 'DISPUTED';
ALTER TYPE "PaymentStatus" ADD VALUE 'PARTIALLY_REFUNDED';
ALTER TYPE "PaymentStatus" ADD VALUE 'REFUNDED';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "paid_at" TIMESTAMP(3),
ADD COLUMN     "refunded_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

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
