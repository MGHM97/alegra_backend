-- AlterTable: adiciona coluna video_url ao model Product
ALTER TABLE "products" ADD COLUMN IF NOT EXISTS "video_url" TEXT;
