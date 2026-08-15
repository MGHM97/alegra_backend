/**
 * Backfill pontual: popula os agregados denormalizados adicionados em
 * `add_product_aggregates` (averageRating, reviewCount, soldCount) a partir
 * dos dados já existentes — necessário porque as colunas nasceram com o
 * default (null/0) e não refletem reviews/pedidos criados antes desta
 * feature. Execução idempotente: pode rodar quantas vezes for preciso, o
 * resultado final é sempre o mesmo dado o estado atual do banco.
 *
 * - averageRating/reviewCount: aggregate() de Review por productId (mesma
 *   fórmula de product-rating-service.ts — arredondado para 1 casa decimal).
 * - soldCount: soma de quantity em OrderItem cujo Order.status está em
 *   CONFIRMED/PROCESSING/SHIPPED/DELIVERED (pedidos com venda efetivada via
 *   commitSale e ainda não revertida por releaseOrderStock).
 *
 * Comando: yarn tsx prisma/backfill-product-aggregates.ts
 */

import { PrismaClient, type OrderStatus } from '@prisma/client';

const prisma = new PrismaClient();

const SOLD_STATUSES: OrderStatus[] = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'];

async function main(): Promise<void> {
  console.log('Backfill de agregados de produto — iniciando...');

  const [ratingAggregates, soldAggregates, totalProducts] = await Promise.all([
    prisma.review.groupBy({
      by: ['productId'],
      _avg: { rating: true },
      _count: { _all: true },
    }),
    prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { status: { in: SOLD_STATUSES } } },
      _sum: { quantity: true },
    }),
    prisma.product.count(),
  ]);

  // groupBy só retorna productId que têm ao menos 1 review, então
  // reviewCount aqui é sempre >= 1 — o caso "sem review" (averageRating
  // null) é tratado à parte, pelos produtos ausentes deste Map.
  const ratingByProduct = new Map<string, { averageRating: number; reviewCount: number }>();
  for (const row of ratingAggregates) {
    const reviewCount = row._count._all;
    const averageRating = row._avg.rating !== null ? Math.round(row._avg.rating * 10) / 10 : 0;
    ratingByProduct.set(row.productId, { averageRating, reviewCount });
  }

  const soldByProduct = new Map<string, number>();
  for (const row of soldAggregates) {
    soldByProduct.set(row.productId, row._sum.quantity ?? 0);
  }

  const affectedProductIds = new Set<string>([
    ...ratingByProduct.keys(),
    ...soldByProduct.keys(),
  ]);

  let updated = 0;
  for (const productId of affectedProductIds) {
    const rating = ratingByProduct.get(productId);
    const soldCount = soldByProduct.get(productId) ?? 0;

    await prisma.product.update({
      where: { id: productId },
      data: {
        averageRating: rating ? rating.averageRating : null,
        reviewCount: rating?.reviewCount ?? 0,
        soldCount,
      },
    });
    updated++;
  }

  console.log(`Produtos no banco: ${totalProducts}`);
  console.log(`Produtos com reviews (averageRating/reviewCount recalculados): ${ratingByProduct.size}`);
  console.log(`Produtos com vendas confirmadas (soldCount recalculado): ${soldByProduct.size}`);
  console.log(`Produtos efetivamente atualizados: ${updated}`);
  console.log(`Produtos sem review nem venda (permanecem no default 0/null): ${totalProducts - updated}`);
  console.log('Backfill concluído.');
}

main()
  .catch((err: unknown) => {
    console.error('Backfill falhou:', err);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
