import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { prisma } from '../../infra/database/prisma-client.js';
import { PaymentService } from '../../application/services/payment-service.js';
import { successResponse } from '../../shared/utils/response.js';
import { logger } from '../../shared/utils/logger.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../domain/errors/app-error.js';
import { EmailService } from '../../application/services/email-service.js';
import { confirmOrderPayment } from '../../application/services/order-confirmation-service.js';
import {
  computeDiscount,
  findCouponByCode,
  assertCouponUsable,
} from '../../application/services/coupon-service.js';
import type { CreatePaymentIntentInput } from '../schemas/payment-schemas.js';
import { computeChargeableTotal } from '../../shared/utils/installments.js';

const paymentService = new PaymentService();
const emailService = new EmailService();

export async function createPaymentIntentHandler(
  request: FastifyRequest<{ Body: CreatePaymentIntentInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const {
    items,
    shippingCost,
    currency,
    couponCode,
    paymentMethod,
    savedCardId,
    installments,
  } = request.body;

  // Validate prices from database to prevent price tampering. The coupon
  // lookup below only depends on `couponCode` (not on the product fetch),
  // so both round-trips run concurrently — validation order (products
  // missing -> stock -> coupon usability) is unchanged, only the fetch
  // itself moves earlier.
  const productIds = items.map((item) => item.productId);
  const [products, prefetchedCoupon] = await Promise.all([
    prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, price: true, stock: true, reservedStock: true, name: true },
    }),
    couponCode ? findCouponByCode(couponCode) : Promise.resolve(null),
  ]);

  if (products.length !== productIds.length) {
    const found = new Set(products.map((p) => p.id));
    const missing = productIds.filter((id) => !found.has(id));
    throw new NotFoundError(`Produtos não encontrados: ${missing.join(', ')}`);
  }

  let subtotal = 0;
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;

    const available = product.stock - product.reservedStock;
    if (available < item.quantity) {
      throw new ValidationError(
        `Estoque insuficiente para "${product.name}": disponível=${available}, solicitado=${item.quantity}`,
      );
    }

    subtotal += product.price.toNumber() * item.quantity;
  }

  // Apply coupon if provided. ALWAYS revalidate server-side and recalculate
  // the discount; never trust client-supplied amounts.
  let discountAmount = 0;
  let appliedCouponId: string | null = null;
  let appliedCouponCode: string | null = null;

  if (couponCode) {
    const coupon = prefetchedCoupon;
    assertCouponUsable(coupon, subtotal);
    discountAmount = computeDiscount(subtotal, coupon);
    appliedCouponId = coupon.id;
    appliedCouponCode = coupon.code;
  }

  const totalAmount =
    Math.round((subtotal - discountAmount + shippingCost) * 100) / 100;
  // Valor efetivamente cobrado: inclui juros de parcelamento acima de 3x.
  const chargeableAmount = computeChargeableTotal(
    totalAmount,
    paymentMethod,
    installments ?? 1,
  );
  const installmentFee = Math.round((chargeableAmount - totalAmount) * 100) / 100;
  const amountInCents = Math.round(chargeableAmount * 100);

  if (amountInCents < 50) {
    throw new ValidationError('O valor mínimo do pedido é R$ 0,50');
  }

  // Saved-card ownership validation — Zero-Trust. The frontend sends only
  // the SavedCard.id; we resolve it against the authenticated userId before
  // passing the Stripe payment_method id to the PaymentService.
  let stripePaymentMethodId: string | undefined;
  let stripeCustomerId: string | undefined;
  if (paymentMethod === 'saved_card') {
    if (!savedCardId) {
      throw new ValidationError(
        'savedCardId é obrigatório para pagamento com cartão salvo.',
      );
    }
    const card = await prisma.savedCard.findFirst({
      where: { id: savedCardId },
      select: {
        id: true,
        userId: true,
        stripePaymentMethodId: true,
        stripeCustomerId: true,
      },
    });
    if (!card) {
      throw new NotFoundError('Cartão não encontrado.');
    }
    if (card.userId !== currentUser.sub) {
      throw new ForbiddenError('Cartão não pertence a este usuário.');
    }
    // Cobrança off-session exige o payment_method id real da Stripe (pm_...),
    // gravado na tokenização (SetupIntent). Se ausente, NÃO enviamos um id
    // interno como se fosse da Stripe (causaria erro genérico/cobrança
    // indevida) — bloqueamos com mensagem clara e direcionamos o cliente a
    // pagar com um novo cartão.
    if (!card.stripePaymentMethodId) {
      throw new ValidationError(
        'Este cartão salvo ainda não está habilitado para cobrança. Pague com um novo cartão para concluir.',
      );
    }
    stripePaymentMethodId = card.stripePaymentMethodId;
    if (card.stripeCustomerId) {
      stripeCustomerId = card.stripeCustomerId;
    }
  }

  const metadata: Record<string, string> = {
    userId: currentUser.sub,
    itemCount: String(items.length),
    subtotal: String(subtotal),
    shippingCost: String(shippingCost),
    discountAmount: String(discountAmount),
    paymentMethod,
  };

  if (appliedCouponId) {
    metadata.couponId = appliedCouponId;
    metadata.couponCode = appliedCouponCode ?? '';
  }

  if (savedCardId) {
    metadata.savedCardId = savedCardId;
  }

  if (installments && installments > 1) {
    metadata.installments = String(installments);
  }

  const result = await paymentService.createPaymentIntent({
    amountInCents,
    currency,
    metadata,
    paymentMethod,
    ...(stripePaymentMethodId ? { stripePaymentMethodId } : {}),
    ...(stripeCustomerId ? { stripeCustomerId } : {}),
    ...(installments ? { installments } : {}),
  });

  void reply.status(200).send(
    successResponse({
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      paymentMethod,
      status: result.status,
      totalAmount,
      subtotal,
      discountAmount,
      shippingCost,
      installments: installments ?? 1,
      // Valor REAL cobrado (mercadorias + frete + juros de parcelamento).
      amountCharged: chargeableAmount,
      installmentFee,
      coupon: appliedCouponId
        ? { id: appliedCouponId, code: appliedCouponCode }
        : null,
      pixData: result.pixData,
    }),
  );
}

export async function webhookHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const signature = request.headers['stripe-signature'];
  if (!signature || typeof signature !== 'string') {
    throw new ValidationError('Missing stripe-signature header');
  }

  const rawBody = request.rawBody;
  if (!rawBody) {
    throw new ValidationError('Missing raw body for webhook verification');
  }

  let event;
  try {
    event = paymentService.constructWebhookEvent(
      Buffer.from(rawBody),
      signature,
    );
  } catch {
    throw new ValidationError('Invalid webhook signature');
  }

  // Idempotência: o Stripe pode reentregar o mesmo evento (retries, replays).
  // Reivindicamos o event.id de forma atômica reusando IdempotencyRecord. Se já
  // existe (P2002), é entrega duplicada → respondemos 200 sem reprocessar
  // (evita confirmar pedido / enviar e-mail duas vezes). O job de limpeza já
  // purga IdempotencyRecord expirados.
  const claimKey = `webhook:${event.id}`;
  try {
    await prisma.idempotencyRecord.create({
      data: {
        key: claimKey,
        response: { received: true } as Prisma.InputJsonValue,
        status: 200,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      void reply.status(200).send({ received: true, duplicate: true });
      return;
    }
    throw err;
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const paymentIntent = event.data.object;
      const paymentIntentId = paymentIntent.id;

      const order = await prisma.order.findUnique({
        where: { paymentIntentId },
        include: {
          user: { select: { email: true, name: true } },
          items: true,
        },
      });

      if (!order) {
        // PaymentIntent pago sem pedido correspondente (cliente abandonou após
        // pagar, ou webhook chegou antes da criação do pedido). Não dá para
        // reconstruir o pedido aqui (sem itens/endereço), então registramos
        // para conciliação manual em vez de engolir silenciosamente.
        logger.warn(
          { paymentIntentId, eventId: event.id },
          'Webhook payment_intent.succeeded sem pedido correspondente (órfão)',
        );
      } else if (order.status === 'RESERVED') {
        // Reivindica a transição RESERVED -> CONFIRMED e converte a reserva de
        // estoque em venda efetiva (SALE) na mesma transação. O claim atômico
        // garante que, mesmo com reentrega do webhook, o estoque nunca é
        // decrementado duas vezes para o mesmo pedido.
        const converted = await confirmOrderPayment({
          orderId: order.id,
          fromStatuses: ['RESERVED'],
          toStatus: 'CONFIRMED',
          paymentStatus: 'SUCCEEDED',
          items: order.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
          })),
        });

        if (converted) {
          try {
            await emailService.sendOrderConfirmed(
              order.user.email,
              order.user.name,
              order.id,
              order.totalAmount.toNumber(),
              order.items.length,
            );
          } catch {
            // Email failure should not break webhook response
          }
        }
      } else {
        // Pedido existe mas não está RESERVED (ex.: já CONFIRMED por reentrega
        // anterior, ou CANCELLED por reserva expirada). Marcamos o pagamento
        // como SUCCEEDED para conciliação e registramos se foi pago após
        // cancelamento (caso a janela de reserva precise de ajuste).
        if (order.status === 'CANCELLED') {
          logger.warn(
            { orderId: order.id, paymentIntentId },
            'Pagamento confirmado para pedido CANCELLED — verificar janela de reserva',
          );
        }
        await prisma.order.update({
          where: { id: order.id },
          data: { paymentStatus: 'SUCCEEDED' },
        });
      }
    }

    if (event.type === 'payment_intent.payment_failed') {
      const paymentIntent = event.data.object;
      await prisma.order.updateMany({
        where: { paymentIntentId: paymentIntent.id },
        data: { paymentStatus: 'FAILED' },
      });
    }
  } catch (err) {
    // O processamento falhou após reivindicar o evento. Liberamos a claim para
    // que o retry do Stripe consiga reprocessar, e propagamos o erro (→ 500),
    // sinalizando ao Stripe que deve reentregar.
    await prisma.idempotencyRecord
      .delete({ where: { key: claimKey } })
      .catch(() => {
        // Claim já removida/expirada — nada a fazer.
      });
    throw err;
  }

  void reply.status(200).send({ received: true });
}
