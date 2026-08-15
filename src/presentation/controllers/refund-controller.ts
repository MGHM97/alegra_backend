import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { PaymentService } from '../../application/services/payment-service.js';
import { successResponse } from '../../shared/utils/response.js';
import {
  NotFoundError,
  OrderStateConflictError,
  ValidationError,
} from '../../domain/errors/app-error.js';
import { releaseCouponUsage } from '../../application/services/coupon-service.js';
import { InventoryService } from '../../application/services/inventory-service.js';
import { cacheInvalidatePattern } from '../../infra/cache/cache-utils.js';

const paymentService = new PaymentService();
const inventoryService = new InventoryService();

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

  // Reivindica a transição para REFUNDED atomicamente ANTES de chamar a
  // Stripe. Isso garante que, sob concorrência (ex.: dois cliques do admin,
  // ou retry de rede), no máximo uma chamada consiga passar do claim — a
  // segunda recebe count === 0 e nunca chega a chamar createRefund(), o que
  // evitaria um estorno duplicado no Stripe.
  const claim = await prisma.order.updateMany({
    where: { id, status: order.status },
    data: { status: 'REFUNDED' },
  });

  if (claim.count === 0) {
    throw new OrderStateConflictError(
      'Pedido não pode ser estornado no momento — o status mudou em outra operação. Recarregue e tente novamente.',
    );
  }

  let refundId: string;
  try {
    refundId = await paymentService.createRefund(order.paymentIntentId);
  } catch (err) {
    // A Stripe recusou/falhou o estorno: reverte o claim para não deixar o
    // pedido marcado como REFUNDED sem o dinheiro ter sido devolvido.
    await prisma.order.update({
      where: { id },
      data: { status: order.status },
    });
    throw err;
  }

  await prisma.$transaction(async (tx) => {
    // order.status aqui é o status ANTES do claim (REFUNDABLE_STATUSES só
    // permite CONFIRMED/PROCESSING, ambos pós-venda): commitSale já rodou na
    // confirmação do pagamento, então devolvemos ao estoque físico (stock),
    // nunca a reservedStock — senão reservedStock ficaria negativo e o
    // estoque físico devolvido nunca voltaria.
    await inventoryService.releaseOrderStock(
      tx,
      order.id,
      order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      order.status,
      `Refund for order ${order.id} (refund: ${refundId})`,
    );

    // Devolve o "slot" do cupom (consistente com o cancelamento via admin).
    // Sem isto, um cupom com maxUses fica permanentemente consumido após o
    // estorno e ninguém mais consegue utilizá-lo.
    if (order.couponId) {
      await releaseCouponUsage(tx, order.couponId);
    }
  });

  // Fora da transação e best-effort (Redis não é transacional com o
  // Postgres): o estoque já foi devolvido no banco quando chegamos aqui.
  await cacheInvalidatePattern('products:*');

  void reply.status(200).send(
    successResponse({
      message: 'Pagamento estornado com sucesso.',
      refundId,
      orderId: order.id,
    }),
  );
}
