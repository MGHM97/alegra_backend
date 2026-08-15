import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaOrderRepository } from '../../infra/database/prisma-order-repository.js';
import type { CreateOrderInput } from '../schemas/order-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import {
  ForbiddenError,
  NotFoundError,
  OrderStateConflictError,
  UnauthorizedError,
  ValidationError,
} from '../../domain/errors/app-error.js';
import { prisma } from '../../infra/database/prisma-client.js';
import { releaseCouponUsage } from '../../application/services/coupon-service.js';
import { InventoryService } from '../../application/services/inventory-service.js';
import type { PaymentMethod, PaymentStatus } from '../../domain/entities/order.js';
import { cacheInvalidatePattern } from '../../infra/cache/cache-utils.js';

const orderRepository = new PrismaOrderRepository();
const inventoryService = new InventoryService();

/**
 * Maps the lowercase payment-method key used on the wire to the uppercase
 * Prisma enum value. Defensive: callers can pass either form, we normalize.
 */
function normalizePaymentMethod(
  value: CreateOrderInput['paymentMethod'],
): PaymentMethod | undefined {
  if (!value) return undefined;
  const upper = value.toUpperCase();
  if (upper === 'PIX') return 'PIX';
  if (upper === 'CARD') return 'CARD';
  if (upper === 'SAVED_CARD') return 'SAVED_CARD';
  if (upper === 'BOLETO') return 'BOLETO';
  return undefined;
}

export async function createOrderHandler(
  request: FastifyRequest<{ Body: CreateOrderInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  if (request.body.idempotencyKey) {
    const existing = await orderRepository.findByIdempotencyKey(request.body.idempotencyKey);
    if (existing) {
      void reply.status(200).send(successResponse(serializeOrder(existing)));
      return;
    }
  }

  // paymentMethod is a pure function of the body — computed up front so it
  // can gate the (conditional) saved-card lookup below without waiting on
  // anything else.
  const paymentMethod = normalizePaymentMethod(request.body.paymentMethod);

  // Address lookup (keyed off shippingAddressId) and saved-card ownership
  // lookup (keyed off savedCardId) are independent reads — run them
  // concurrently. Validation below still happens in the original order
  // (address NotFound/Forbidden before saved-card Forbidden), only the
  // fetches themselves moved earlier.
  const [addr, card] = await Promise.all([
    request.body.shippingAddressId
      ? prisma.address.findUnique({
          where: { id: request.body.shippingAddressId },
          select: {
            userId: true,
            recipientName: true,
            label: true,
            street: true,
            number: true,
            complement: true,
            neighborhood: true,
            city: true,
            state: true,
            zipCode: true,
          },
        })
      : Promise.resolve(null),
    paymentMethod === 'SAVED_CARD' && request.body.savedCardId
      ? prisma.savedCard.findFirst({
          where: { id: request.body.savedCardId },
          select: { id: true, userId: true },
        })
      : Promise.resolve(null),
  ]);

  // Resolve shipping address by id (Zero-Trust: must belong to the user).
  let shippingAddress: {
    recipientName: string | null;
    street: string;
    number: string;
    complement: string | null;
    neighborhood: string;
    city: string;
    state: string;
    zipCode: string;
  } | undefined;

  if (request.body.shippingAddressId) {
    if (!addr) {
      throw new NotFoundError('Endereço não encontrado.');
    }
    if (addr.userId !== currentUser.sub) {
      throw new ForbiddenError('Endereço não pertence a este usuário.');
    }
    shippingAddress = {
      recipientName: addr.recipientName ?? addr.label,
      street: addr.street,
      number: addr.number,
      complement: addr.complement,
      neighborhood: addr.neighborhood,
      city: addr.city,
      state: addr.state,
      zipCode: addr.zipCode,
    };
  }

  // For non-card flows, the payment status is meaningful at creation time:
  // PIX/Boleto are awaiting customer action, saved_card may have already
  // succeeded (off_session confirm). The frontend reports status; the webhook
  // is authoritative for transitions and overrides if necessary.
  const paymentStatus: PaymentStatus | undefined = request.body.paymentStatus
    ? (request.body.paymentStatus as PaymentStatus)
    : paymentMethod === 'PIX' || paymentMethod === 'BOLETO'
      ? 'REQUIRES_ACTION'
      : 'PROCESSING';

  // Validate savedCard ownership when reusing one — defensive duplicate of
  // the check in the payment controller, since the order can in theory be
  // created with a paymentIntent that was generated earlier.
  if (paymentMethod === 'SAVED_CARD' && request.body.savedCardId) {
    if (!card || card.userId !== currentUser.sub) {
      throw new ForbiddenError('Cartão não pertence a este usuário.');
    }
  }

  const order = await orderRepository.create({
    userId: currentUser.sub,
    items: request.body.items,
    idempotencyKey: request.body.idempotencyKey,
    notes: request.body.notes,
    couponCode: request.body.couponCode,
    shippingCost: request.body.shippingCost,
    shippingMethodName: request.body.shippingMethodName,
    shippingCarrier: request.body.shippingCarrier,
    shippingAddress,
    paymentIntentId: request.body.paymentIntentId,
    paymentMethod,
    paymentStatus,
    installments: request.body.installments,
    savedCardId: request.body.savedCardId,
    pixQrCode: request.body.pixQrCode,
    pixQrCodeText: request.body.pixQrCodeText,
    pixExpiresAt: request.body.pixExpiresAt
      ? new Date(request.body.pixExpiresAt)
      : undefined,
    boletoUrl: request.body.boletoUrl,
    boletoBarcode: request.body.boletoBarcode,
    boletoExpiresAt: request.body.boletoExpiresAt
      ? new Date(request.body.boletoExpiresAt)
      : undefined,
  });

  void reply.status(201).send(successResponse(serializeOrder(order)));
}

export async function listUserOrdersHandler(
  request: FastifyRequest<{ Querystring: { period?: string; search?: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const period = request.query.period ? parseInt(request.query.period, 10) : undefined;
  const search = request.query.search;

  const orders = await orderRepository.findByUserIdWithProducts(currentUser.sub, {
    period: period && !isNaN(period) ? period : undefined,
    search,
  });

  const serialized = orders.map(serializeOrderWithProducts);
  void reply.status(200).send(successResponse(serialized));
}

export async function getOrderDetailHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const order = await orderRepository.findByIdWithProducts(request.params.id);
  if (!order) {
    throw new NotFoundError('Order');
  }
  if (order.userId !== currentUser.sub && currentUser.role !== 'ADMIN') {
    throw new NotFoundError('Order');
  }

  void reply.status(200).send(successResponse(serializeOrderWithProducts(order)));
}

function toNumber(value: { toNumber?: () => number } | number): number {
  if (typeof value === 'number') return value;
  if (value.toNumber) return value.toNumber();
  return Number(value);
}

/**
 * Normaliza os dados de parcelamento para a resposta. `amountCharged` é o
 * valor REAL cobrado (mercadorias + frete + juros), garantindo que o pedido
 * exibido bata com a cobrança da Stripe.
 */
function serializeInstallmentInfo(order: SerializableOrderBase) {
  const installments = order.installments ?? 1;
  const installmentFee =
    order.installmentFee === null || order.installmentFee === undefined
      ? 0
      : toNumber(order.installmentFee);
  const total = toNumber(order.totalAmount);
  return {
    installments,
    installmentFee,
    amountCharged: Math.round((total + installmentFee) * 100) / 100,
  };
}

interface SerializableOrderBase {
  id: string;
  userId: string;
  status: string;
  totalAmount: { toNumber?: () => number } | number;
  idempotencyKey: string | null;
  reservedUntil: Date | null;
  notes: string | null;
  couponId?: string | null;
  couponCode?: string | null;
  discountAmount?: { toNumber?: () => number } | number | null;
  paymentMethod?: string | null;
  paymentStatus?: string | null;
  installments?: number | null;
  installmentFee?: { toNumber?: () => number } | number | null;
  pixQrCode?: string | null;
  pixQrCodeText?: string | null;
  pixExpiresAt?: Date | null;
  boletoUrl?: string | null;
  boletoBarcode?: string | null;
  boletoExpiresAt?: Date | null;
  shippingCost?: { toNumber?: () => number } | number | null;
  shippingMethodName?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function serializeOrder(order: SerializableOrderBase & {
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: { toNumber?: () => number } | number;
    total: { toNumber?: () => number } | number;
  }>;
}) {
  return {
    ...order,
    totalAmount: toNumber(order.totalAmount),
    discountAmount:
      order.discountAmount === null || order.discountAmount === undefined
        ? null
        : toNumber(order.discountAmount),
    couponId: order.couponId ?? null,
    couponCode: order.couponCode ?? null,
    paymentMethod: order.paymentMethod
      ? order.paymentMethod.toLowerCase()
      : null,
    paymentStatus: order.paymentStatus
      ? order.paymentStatus.toLowerCase()
      : null,
    ...serializeInstallmentInfo(order),
    pixQrCode: order.pixQrCode ?? null,
    pixQrCodeText: order.pixQrCodeText ?? null,
    pixExpiresAt: order.pixExpiresAt ? order.pixExpiresAt.toISOString() : null,
    boletoUrl: order.boletoUrl ?? null,
    boletoBarcode: order.boletoBarcode ?? null,
    boletoExpiresAt: order.boletoExpiresAt
      ? order.boletoExpiresAt.toISOString()
      : null,
    shippingCost:
      order.shippingCost === null || order.shippingCost === undefined
        ? null
        : toNumber(order.shippingCost),
    shippingMethodName: order.shippingMethodName ?? null,
    items: order.items.map((item) => ({
      ...item,
      unitPrice: toNumber(item.unitPrice),
      total: toNumber(item.total),
    })),
  };
}

const HELP_WINDOW_DAYS = 7;

const HELP_ELIGIBLE_STATUSES = new Set(['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED']);

function computeCanRequestHelp(status: string, deliveredAt: Date | null): boolean {
  if (!HELP_ELIGIBLE_STATUSES.has(status)) return false;
  if (status === 'DELIVERED') {
    if (!deliveredAt) return false;
    const now = new Date();
    const diffMs = now.getTime() - deliveredAt.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    return diffDays >= 0 && diffDays <= HELP_WINDOW_DAYS;
  }
  return true;
}

function serializeOrderWithProducts(order: SerializableOrderBase & {
  shippingName: string | null;
  shippingStreet: string | null;
  shippingNumber: string | null;
  shippingComplement: string | null;
  shippingNeighborhood: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZipCode: string | null;
  trackingCode: string | null;
  shippingCarrier: string | null;
  deliveredAt: Date | null;
  items: Array<{
    id: string;
    productId: string;
    quantity: number;
    unitPrice: { toNumber?: () => number } | number;
    total: { toNumber?: () => number } | number;
    product: {
      name: string;
      slug: string;
      thumbnailUrl: string;
      images: string[];
    };
  }>;
}) {
  return {
    id: order.id,
    userId: order.userId,
    status: order.status,
    totalAmount: toNumber(order.totalAmount),
    notes: order.notes,
    couponId: order.couponId ?? null,
    couponCode: order.couponCode ?? null,
    discountAmount:
      order.discountAmount === null || order.discountAmount === undefined
        ? null
        : toNumber(order.discountAmount),
    paymentMethod: order.paymentMethod
      ? order.paymentMethod.toLowerCase()
      : null,
    paymentStatus: order.paymentStatus
      ? order.paymentStatus.toLowerCase()
      : null,
    ...serializeInstallmentInfo(order),
    pixQrCode: order.pixQrCode ?? null,
    pixQrCodeText: order.pixQrCodeText ?? null,
    pixExpiresAt: order.pixExpiresAt ? order.pixExpiresAt.toISOString() : null,
    boletoUrl: order.boletoUrl ?? null,
    boletoBarcode: order.boletoBarcode ?? null,
    boletoExpiresAt: order.boletoExpiresAt
      ? order.boletoExpiresAt.toISOString()
      : null,
    shippingCost:
      order.shippingCost === null || order.shippingCost === undefined
        ? null
        : toNumber(order.shippingCost),
    shippingMethodName: order.shippingMethodName ?? null,
    shippingAddress: order.shippingStreet
      ? {
          name: order.shippingName,
          street: order.shippingStreet,
          number: order.shippingNumber,
          complement: order.shippingComplement,
          neighborhood: order.shippingNeighborhood,
          city: order.shippingCity,
          state: order.shippingState,
          zipCode: order.shippingZipCode,
        }
      : null,
    trackingCode: order.trackingCode,
    shippingCarrier: order.shippingCarrier,
    deliveredAt: order.deliveredAt,
    canRequestHelp: computeCanRequestHelp(order.status, order.deliveredAt),
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      total: toNumber(item.total),
      product: {
        name: item.product.name,
        slug: item.product.slug,
        thumbnailUrl: item.product.thumbnailUrl,
        images: item.product.images,
      },
    })),
  };
}

const CANCELLABLE_STATUSES = new Set(['PENDING', 'RESERVED']);

export async function cancelOrderHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const order = await orderRepository.findById(request.params.id);
  if (!order) {
    throw new NotFoundError('Order');
  }
  if (order.userId !== currentUser.sub) {
    throw new NotFoundError('Order');
  }

  if (!CANCELLABLE_STATUSES.has(order.status)) {
    throw new ValidationError(
      `Pedido não pode ser cancelado no status atual (${order.status}). Apenas pedidos pendentes ou reservados podem ser cancelados.`,
    );
  }

  await prisma.$transaction(async (tx) => {
    // Reivindica a transição atomicamente: se o pedido já saiu do status lido
    // acima (ex.: pagamento confirmado pelo webhook ou cancelamento
    // concorrente pelo admin), count === 0 e abortamos antes de tocar no
    // estoque — evitando decremento duplo de reservedStock.
    const claim = await tx.order.updateMany({
      where: { id: order.id, status: order.status },
      data: { status: 'CANCELLED' },
    });

    if (claim.count === 0) {
      throw new OrderStateConflictError(
        'Pedido não pode ser cancelado no momento — o status mudou em outra operação. Recarregue e tente novamente.',
      );
    }

    // CANCELLABLE_STATUSES só permite PENDING/RESERVED (sempre pré-venda),
    // então releaseOrderStock sempre libera a reserva aqui — mesmo caminho
    // usado pelo cancelamento via admin, para manter a regra num só lugar.
    await inventoryService.releaseOrderStock(
      tx,
      order.id,
      order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      order.status,
      `Customer cancelled order ${order.id}`,
    );

    // If the order used a coupon, release the reserved usage slot.
    if (order.couponId) {
      await releaseCouponUsage(tx, order.couponId);
    }
  });

  // Fora da transação e best-effort (Redis não é transacional com o
  // Postgres): a reserva já foi liberada no banco quando chegamos aqui.
  await cacheInvalidatePattern('products:*');

  void reply.status(200).send(successResponse({ message: 'Pedido cancelado com sucesso.' }));
}
