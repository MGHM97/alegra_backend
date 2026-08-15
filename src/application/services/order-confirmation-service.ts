import { Prisma } from '@prisma/client';
import { prisma } from '../../infra/database/prisma-client.js';
import { InventoryService, type SaleOrderItem } from './inventory-service.js';
import type { OrderStatus, PaymentStatus } from '../../domain/entities/order.js';
import { cacheInvalidatePattern } from '../../infra/cache/cache-utils.js';

const inventoryService = new InventoryService();

export interface ConfirmOrderPaymentInput {
  orderId: string;
  /** Status a partir dos quais a confirmação é aceita (claim atômico). */
  fromStatuses: OrderStatus[];
  toStatus: OrderStatus;
  paymentStatus?: PaymentStatus;
  items: SaleOrderItem[];
}

/**
 * Converte a reserva de estoque de um pedido (reservedStock) em venda
 * efetiva (stock -= qty, InventoryAction.SALE) e transiciona o pedido para o
 * status de "pagamento confirmado" — tudo em uma única transação Serializable.
 *
 * Idempotente: a transição é reivindicada atomicamente com um `updateMany`
 * filtrado pelo status atual esperado. Se outra chamada concorrente já
 * converteu o pedido (ex.: webhook duplicado chegando ao mesmo tempo que uma
 * marcação manual no admin), `count === 0` e retornamos `false` sem tocar o
 * estoque novamente — protegendo contra decremento duplo de stock.
 *
 * Deve ser o ÚNICO caminho usado para confirmar pagamento em qualquer
 * controller (webhook, saved_card, marcação manual no admin).
 */
export async function confirmOrderPayment(
  input: ConfirmOrderPaymentInput,
): Promise<boolean> {
  const run = () =>
    prisma.$transaction(
      async (tx) => {
        const claim = await tx.order.updateMany({
          where: { id: input.orderId, status: { in: input.fromStatuses } },
          data: {
            status: input.toStatus,
            ...(input.paymentStatus ? { paymentStatus: input.paymentStatus } : {}),
          },
        });

        if (claim.count === 0) {
          return false;
        }

        await inventoryService.commitSale(tx, input.orderId, input.items);
        return true;
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: 10000,
      },
    );

  // Retry em falhas de serialização (P2034), mesmo padrão usado na criação
  // de pedidos (prisma-order-repository.ts).
  for (let attempt = 1; ; attempt++) {
    try {
      const committed = await run();
      if (committed) {
        // Fora da transação (Redis não participa do commit do Postgres) e
        // best-effort: a venda já foi efetivada no banco; se o Redis estiver
        // fora, o cache expira sozinho pelo TTL — não pode falhar a
        // confirmação de pagamento por causa disso.
        await cacheInvalidatePattern('products:*');
      }
      return committed;
    } catch (err) {
      const isSerializationFailure =
        err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034';
      if (isSerializationFailure && attempt < 3) {
        continue;
      }
      throw err;
    }
  }
}
