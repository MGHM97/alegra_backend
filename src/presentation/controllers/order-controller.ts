import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaOrderRepository } from '../../infra/database/prisma-order-repository.js';
import type { CreateOrderInput } from '../schemas/order-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { UnauthorizedError } from '../../domain/errors/app-error.js';

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
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const orders = await orderRepository.findByUserId(currentUser.sub);
  const serialized = orders.map(serializeOrder);

  void reply.status(200).send(successResponse(serialized));
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
    totalAmount:
      typeof order.totalAmount === 'number'
        ? order.totalAmount
        : order.totalAmount.toNumber
          ? order.totalAmount.toNumber()
          : Number(order.totalAmount),
    items: order.items.map((item) => ({
      ...item,
      unitPrice:
        typeof item.unitPrice === 'number'
          ? item.unitPrice
          : item.unitPrice.toNumber
            ? item.unitPrice.toNumber()
            : Number(item.unitPrice),
      total:
        typeof item.total === 'number'
          ? item.total
          : item.total.toNumber
            ? item.total.toNumber()
            : Number(item.total),
    })),
  };
}
