import type { Decimal } from '@prisma/client/runtime/library';

/**
 * Valor total efetivamente cobrado do cliente para um pedido, em centavos:
 * mercadorias + frete (`totalAmount`) + juros de parcelamento acima de 3x,
 * se houver (`installmentFee` é uma coluna separada — ver
 * `prisma-order-repository.ts`). O saldo reembolsável de um pedido é sempre
 * calculado sobre esse total, nunca só `totalAmount`, senão um pedido
 * parcelado com juros nunca poderia ser 100% reembolsado.
 *
 * Compartilhado entre `refund-controller.ts` (reembolso via API) e
 * `payment-controller.ts` (reconciliação de reembolso/disputa via webhook)
 * para que ambos os caminhos calculem o mesmo saldo reembolsável.
 */
export function chargedTotalCents(order: {
  totalAmount: Decimal;
  installmentFee: Decimal | null;
}): number {
  const total = order.totalAmount.toNumber() + (order.installmentFee?.toNumber() ?? 0);
  return Math.round(total * 100);
}
