import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
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
import { chargedTotalCents } from '../../shared/utils/refund-amount.js';
import type { RefundOrderInput } from '../schemas/refund-schemas.js';

const paymentService = new PaymentService();
const inventoryService = new InventoryService();

const REFUNDABLE_STATUSES = new Set(['CONFIRMED', 'PROCESSING']);

// Pagamento ainda estornável: SUCCEEDED (nunca reembolsado) ou
// PARTIALLY_REFUNDED (permite reembolsos parciais sucessivos até esgotar o
// saldo). Qualquer outro paymentStatus (DISPUTED, REFUNDED, FAILED, ...)
// bloqueia — nada a estornar ou já em disputa/estornado.
const REFUNDABLE_PAYMENT_STATUSES = new Set(['SUCCEEDED', 'PARTIALLY_REFUNDED']);

// Janela em que o Pix ainda pode ser estornado após o pagamento. Passado
// esse prazo, o dinheiro do Pix já não está mais retido pelo Stripe da forma
// necessária para um estorno automático — exige processo manual/bancário.
const PIX_REFUND_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

export async function refundOrderHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: RefundOrderInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const { amount } = request.body;

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
  if (!order.paymentStatus || !REFUNDABLE_PAYMENT_STATUSES.has(order.paymentStatus)) {
    throw new ValidationError(
      'Apenas pedidos com pagamento confirmado (SUCCEEDED) ou parcialmente reembolsado podem ser estornados.',
    );
  }

  // Guarda dos 90 dias do Pix: passado esse prazo após o pagamento, o
  // estorno automático via API não é mais possível. `paidAt` é a fonte de
  // verdade (marcado quando paymentStatus vira SUCCEEDED); pedidos antigos,
  // de antes desse campo existir, caem no fallback `updatedAt`.
  if (order.paymentMethod === 'PIX') {
    const paidReference = order.paidAt ?? order.updatedAt;
    if (Date.now() - paidReference.getTime() > PIX_REFUND_WINDOW_MS) {
      throw new ValidationError(
        'Reembolso de PIX só é possível em até 90 dias após o pagamento.',
      );
    }
  }

  const totalCents = chargedTotalCents(order);
  const alreadyRefundedCents = Math.round(order.refundedAmount.toNumber() * 100);
  const remainingCents = totalCents - alreadyRefundedCents;

  if (remainingCents <= 0) {
    throw new ValidationError('Este pedido já foi totalmente reembolsado.');
  }

  let requestedCents = remainingCents;
  if (amount !== undefined) {
    requestedCents = Math.round(amount * 100);
    if (requestedCents > remainingCents) {
      throw new ValidationError(
        `Valor do reembolso (R$ ${(requestedCents / 100).toFixed(2)}) excede o saldo ` +
        `reembolsável do pedido (R$ ${(remainingCents / 100).toFixed(2)}).`,
      );
    }
  }

  const isFullRefund = requestedCents === remainingCents;
  const newRefundedAmount = new Prisma.Decimal((alreadyRefundedCents + requestedCents) / 100);

  // Reivindica a transição atomicamente ANTES de chamar a Stripe, condicionada
  // tanto ao status quanto ao refundedAmount lidos acima. Isso garante que,
  // sob concorrência (dois cliques do admin, retry de rede, OU um reembolso
  // parcial e um total disparados ao mesmo tempo), no máximo uma chamada
  // consiga passar do claim — as demais recebem count === 0 e nunca chegam a
  // chamar createRefund(), evitando um estorno duplicado/excedente na Stripe.
  const claimData: Prisma.OrderUpdateManyMutationInput = isFullRefund
    ? { status: 'REFUNDED', paymentStatus: 'REFUNDED', refundedAmount: newRefundedAmount }
    : { paymentStatus: 'PARTIALLY_REFUNDED', refundedAmount: newRefundedAmount };

  const claim = await prisma.order.updateMany({
    where: { id, status: order.status, refundedAmount: order.refundedAmount },
    data: claimData,
  });

  if (claim.count === 0) {
    throw new OrderStateConflictError(
      'Pedido não pode ser estornado no momento — o status mudou em outra operação. Recarregue e tente novamente.',
    );
  }

  let refundId: string;
  try {
    // Reembolso total: omite `amount` para a Stripe devolver o saldo
    // integral do charge (idêntico ao comportamento histórico, correto
    // mesmo quando o charge inclui juros de parcelamento não refletidos em
    // totalAmount). Reembolso parcial: valor explícito.
    refundId = isFullRefund
      ? await paymentService.createRefund(order.paymentIntentId)
      : await paymentService.createRefund(order.paymentIntentId, requestedCents);
  } catch (err) {
    // A Stripe recusou/falhou o estorno: reverte o claim para não deixar o
    // pedido marcado como (parcialmente) reembolsado sem o dinheiro ter sido
    // devolvido.
    await prisma.order.update({
      where: { id },
      data: {
        status: order.status,
        paymentStatus: order.paymentStatus,
        refundedAmount: order.refundedAmount,
      },
    });
    throw err;
  }

  if (isFullRefund) {
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
  }
  // Reembolso parcial: NUNCA libera estoque nem cupom — o pedido continua
  // ativo (status inalterado), só uma parte do valor foi devolvida.

  void reply.status(200).send(
    successResponse({
      message: isFullRefund
        ? 'Pagamento estornado com sucesso.'
        : 'Reembolso parcial realizado com sucesso.',
      refundId,
      orderId: order.id,
      amountRefunded: requestedCents / 100,
      totalRefunded: (alreadyRefundedCents + requestedCents) / 100,
      isFullRefund,
    }),
  );
}
