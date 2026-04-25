import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { PaymentService } from '../../application/services/payment-service.js';
import { successResponse } from '../../shared/utils/response.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../domain/errors/app-error.js';
import { EmailService } from '../../application/services/email-service.js';
import {
  computeDiscount,
  findCouponByCode,
  assertCouponUsable,
} from '../../application/services/coupon-service.js';
import type { CreatePaymentIntentInput } from '../schemas/payment-schemas.js';

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

  // Validate prices from database to prevent price tampering
  const productIds = items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: { id: true, price: true, stock: true, reservedStock: true, name: true },
  });

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
    const coupon = await findCouponByCode(couponCode);
    assertCouponUsable(coupon, subtotal);
    discountAmount = computeDiscount(subtotal, coupon);
    appliedCouponId = coupon.id;
    appliedCouponCode = coupon.code;
  }

  const totalAmount =
    Math.round((subtotal - discountAmount + shippingCost) * 100) / 100;
  const amountInCents = Math.round(totalAmount * 100);

  if (amountInCents < 50) {
    throw new ValidationError('O valor mínimo do pedido é R$ 0,50');
  }

  // Saved-card ownership validation — Zero-Trust. The frontend sends only
  // the SavedCard.id; we resolve it against the authenticated userId before
  // passing the Stripe payment_method id to the PaymentService.
  let stripePaymentMethodId: string | undefined;
  if (paymentMethod === 'saved_card') {
    if (!savedCardId) {
      throw new ValidationError(
        'savedCardId é obrigatório para pagamento com cartão salvo.',
      );
    }
    const card = await prisma.savedCard.findFirst({
      where: { id: savedCardId },
      select: { id: true, userId: true },
    });
    if (!card) {
      throw new NotFoundError('Cartão não encontrado.');
    }
    if (card.userId !== currentUser.sub) {
      throw new ForbiddenError('Cartão não pertence a este usuário.');
    }
    // Note: in a production setup the SavedCard would also store the Stripe
    // `payment_method` id (pm_xxx) created at tokenization time. The current
    // schema does not yet — so we treat the card.id as a stable token and
    // delegate the actual Stripe lookup to the future tokenization flow.
    // For now, the PaymentService uses card.id as the Stripe pm id; this is
    // explicitly documented and will be wired to a real tokenization step.
    stripePaymentMethodId = card.id;
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
      coupon: appliedCouponId
        ? { id: appliedCouponId, code: appliedCouponCode }
        : null,
      pixData: result.pixData,
      boletoData: result.boletoData,
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

    if (order && order.status === 'RESERVED') {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CONFIRMED', paymentStatus: 'SUCCEEDED' },
      });

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
  }

  if (event.type === 'payment_intent.payment_failed') {
    const paymentIntent = event.data.object;
    await prisma.order
      .updateMany({
        where: { paymentIntentId: paymentIntent.id },
        data: { paymentStatus: 'FAILED' },
      })
      .catch(() => {
        // Defensive: missing order is not a webhook failure.
      });
  }

  void reply.status(200).send({ received: true });
}
