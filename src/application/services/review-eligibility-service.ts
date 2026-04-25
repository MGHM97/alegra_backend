import { prisma } from '../../infra/database/prisma-client.js';

/**
 * Verifies whether a user has at least one DELIVERED order containing
 * the given product. Used to enforce the "verified purchase" rule before
 * allowing review creation and to power the `can-review` UX endpoint.
 *
 * Efficient lookup: composite-friendly query using `findFirst` with
 * `select: { id: true }` so the planner can stop at the first match.
 */
export async function userHasDeliveredPurchase(
  userId: string,
  productId: string,
): Promise<boolean> {
  const match = await prisma.order.findFirst({
    where: {
      userId,
      status: 'DELIVERED',
      items: { some: { productId } },
    },
    select: { id: true },
  });
  return match !== null;
}
