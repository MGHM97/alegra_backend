import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { PaymentService } from '../../application/services/payment-service.js';
import { successResponse } from '../../shared/utils/response.js';
import { NotFoundError, ValidationError } from '../../domain/errors/app-error.js';

const paymentService = new PaymentService();

const REFUNDABLE_STATUSES = new Set(['CONFIRMED', 'PROCESSING']);

export async function refundOrderHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!order) {
    throw new NotFoundError('Order');
  }

  if (!REFUNDABLE_STATUSES.has(order.status)) {
    throw new ValidationError(
      `Pedido nao pode ser estornado no status atual (${order.status}). Apenas pedidos confirmados ou em preparo podem ser estornados.`,
    );
  }

  if (!order.paymentIntentId) {
    throw new ValidationError('Pedido nao possui pagamento vinculado para estorno.');
  }

  const refundId = await paymentService.createRefund(order.paymentIntentId);

  await prisma.$transaction(async (tx) => {
    for (const item of order.items) {
      await tx.product.update({
        where: { id: item.productId },
        data: { reservedStock: { decrement: item.quantity } },
      });

      await tx.inventoryLog.create({
        data: {
          productId: item.productId,
          action: 'RESERVATION_RELEASE',
          quantity: item.quantity,
          reason: `Refund for order ${order.id} (refund: ${refundId})`,
        },
      });
    }

    await tx.order.update({
      where: { id },
      data: { status: 'REFUNDED' },
    });
  });

  void reply.status(200).send(
    successResponse({
      message: 'Pagamento estornado com sucesso.',
      refundId,
      orderId: order.id,
    }),
  );
}
