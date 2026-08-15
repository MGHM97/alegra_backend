import { prisma } from '../../infra/database/prisma-client.js';
import { cacheDelete } from '../../infra/cache/cache-utils.js';

/**
 * Chaves de cache das listagens públicas de reviews (`GET
 * /v1/reviews/product/:id` e `GET /v1/reviews/slug/:slug`) — lidas a cada
 * carregamento de página de produto, por isso cacheadas com TTL de 300s
 * (ver review-controller.ts). Ambas as chaves precisam ser invalidadas
 * juntas sempre que o conjunto de reviews de um produto muda (criação ou
 * remoção pelo admin), já que representam a mesma lista sob duas chaves de
 * acesso diferentes (id vs. slug).
 */
export function productReviewsCacheKey(productId: string): string {
  return `reviews:product:${productId}`;
}

export function productReviewsBySlugCacheKey(slug: string): string {
  return `reviews:product:slug:${slug}`;
}

/**
 * Invalida o cache de reviews de um produto a partir do productId. Busca o
 * slug correspondente (lookup leve por PK, fora do caminho de leitura) para
 * também derrubar a chave indexada por slug — sem isso, a listagem por
 * slug continuaria servindo a lista antiga até o TTL expirar.
 */
export async function invalidateProductReviewsCache(productId: string): Promise<void> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { slug: true },
  });

  await Promise.all([
    cacheDelete(productReviewsCacheKey(productId)),
    product ? cacheDelete(productReviewsBySlugCacheKey(product.slug)) : Promise.resolve(),
  ]);
}
