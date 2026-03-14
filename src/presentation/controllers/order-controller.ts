import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaOrderRepository } from '../../infra/database/prisma-order-repository.js';
import type { CreateOrderInput } from '../schemas/order-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { UnauthorizedError, NotFoundError } from '../../domain/errors/app-error.js';

const orderRepository = new PrismaOrderRepository();

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

  const order = await orderRepository.create({
    userId: currentUser.sub,
    items: request.body.items,
    idempotencyKey: request.body.idempotencyKey,
    notes: request.body.notes,
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

function serializeOrder(order: {
  id: string;
  userId: string;
  status: string;
  totalAmount: { toNumber?: () => number } | number;
  idempotencyKey: string | null;
  reservedUntil: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
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

function serializeOrderWithProducts(order: {
  id: string;
  userId: string;
  status: string;
  totalAmount: { toNumber?: () => number } | number;
  idempotencyKey: string | null;
  reservedUntil: Date | null;
  notes: string | null;
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
  createdAt: Date;
  updatedAt: Date;
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
