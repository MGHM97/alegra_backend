import type { PrismaClient } from '@prisma/client';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Recalcula `averageRating`/`reviewCount` de um produto a partir das
 * reviews atualmente existentes (este domínio não tem moderação/soft-delete
 * de review — toda review criada já é visível publicamente). Deve ser
 * chamado dentro da MESMA transação que cria ou remove uma review (ver
 * review-controller.ts e admin-review-controller.ts), para que o agregado
 * denormalizado em Product nunca fique dessincronizado do conjunto real de
 * reviews — nem sob concorrência (duas reviews do mesmo produto criadas ao
 * mesmo tempo), nem em caso de falha no meio do caminho.
 *
 * `averageRating` fica `null` quando `reviewCount === 0` (nenhuma review
 * ainda) — o card "★ 4.9 · +100 vendidos" no frontend omite a estrela
 * nesse caso, em vez de mostrar "★ 0.0".
 */
export async function recalculateProductRatingAggregate(
  tx: TransactionClient,
  productId: string,
): Promise<void> {
  const aggregate = await tx.review.aggregate({
    where: { productId },
    _avg: { rating: true },
    _count: true,
  });

  const reviewCount = aggregate._count;
  const averageRating =
    reviewCount > 0 && aggregate._avg.rating !== null
      ? Math.round(aggregate._avg.rating * 10) / 10
      : null;

  await tx.product.update({
    where: { id: productId },
    data: { reviewCount, averageRating },
  });
}
