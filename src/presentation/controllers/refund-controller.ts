import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { PaymentService } from '../../application/services/payment-service.js';
import { successResponse } from '../../shared/utils/response.js';
import { NotFoundError, ValidationError } from '../../domain/errors/app-error.js';
import { releaseCouponUsage } from '../../application/services/coupon-service.js';

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
    throw new ValidationError('Pedido não possui pagamento vinculado para estorno.');
  }

  // O Stripe só estorna PaymentIntents efetivamente pagos. Um pedido pode estar
  // CONFIRMED/PROCESSING com paymentStatus != SUCCEEDED (ex.: falha tardia ou
  // confirmação manual). Sem este guard, createRefund() lançaria erro do Stripe
  // após já termos passado das validações de negócio.
  if (order.paymentStatus !== 'SUCCEEDED') {
    throw new ValidationError(
      'Apenas pedidos com pagamento confirmado (SUCCEEDED) podem ser estornados.',
    );
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

    // Devolve o "slot" do cupom (consistente com o cancelamento via admin).
    // Sem isto, um cupom com maxUses fica permanentemente consumido após o
    // estorno e ninguém mais consegue utilizá-lo.
    if (order.couponId) {
      await releaseCouponUsage(tx, order.couponId);
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
