import type { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { successResponse, listResponse } from '../../shared/utils/response.js';
import { NotFoundError, ValidationError } from '../../domain/errors/app-error.js';
import { EmailService } from '../../application/services/email-service.js';
import { releaseCouponUsage } from '../../application/services/coupon-service.js';

const emailService = new EmailService();
import {
  VALID_TRANSITIONS,
  type AdminOrderFiltersInput,
  type UpdateOrderStatusInput,
} from '../schemas/admin-order-schemas.js';

function toNumber(value: { toNumber?: () => number } | number): number {
  if (typeof value === 'number') return value;
  if (value?.toNumber) return value.toNumber();
  return Number(value);
}

export async function listAdminOrdersHandler(
  request: FastifyRequest<{ Querystring: AdminOrderFiltersInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { status, period, search, cursor, limit } = request.query;

  const where: Prisma.OrderWhereInput = {};

  if (status) {
    where.status = status;
  }

  if (period) {
    const since = new Date();
    since.setMonth(since.getMonth() - period);
    where.createdAt = { gte: since };
  }

  if (search) {
    const term = search.trim();
    where.OR = [
      { id: { contains: term, mode: 'insensitive' } },
      { user: { name: { contains: term, mode: 'insensitive' } } },
      { user: { email: { contains: term, mode: 'insensitive' } } },
    ];
  }

  const take = limit + 1;

  const orders = await prisma.order.findMany({
    where,
    take,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
      items: {
        include: {
          product: {
            select: { name: true, slug: true, thumbnailUrl: true },
          },
        },
      },
    },
  });

  const hasMore = orders.length > limit;
  const items = hasMore ? orders.slice(0, limit) : orders;
  const lastItem = items[items.length - 1];
  const nextCursor = hasMore && lastItem ? lastItem.id : null;

  const serialized = items.map((order) => ({
    id: order.id,
    status: order.status,
    totalAmount: toNumber(order.totalAmount),
    trackingCode: order.trackingCode,
    shippingCarrier: order.shippingCarrier,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    customer: order.user,
    items: order.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      total: toNumber(item.total),
      product: item.product,
    })),
  }));

  void reply.status(200).send(listResponse(serialized, nextCursor, hasMore));
}

export async function updateOrderStatusHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateOrderStatusInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const { status: newStatus, trackingCode, shippingCarrier } = request.body;

  const order = await prisma.order.findUnique({
    where: { id },
    include: { items: true },
  });

  if (!order) {
    throw new NotFoundError('Order');
  }

  const allowed = VALID_TRANSITIONS[order.status];
  if (!allowed || !allowed.includes(newStatus)) {
    throw new ValidationError(
      `Transicao de status invalida: ${order.status} -> ${newStatus}. ` +
      `Transicoes permitidas: ${allowed?.join(', ') ?? 'nenhuma'}`,
    );
  }

  const updateData: Prisma.OrderUpdateInput = { status: newStatus };

  if (newStatus === 'SHIPPED') {
    if (trackingCode) updateData.trackingCode = trackingCode;
    if (shippingCarrier) updateData.shippingCarrier = shippingCarrier;
  }

  if (newStatus === 'DELIVERED') {
    updateData.deliveredAt = new Date();
  }

  if (newStatus === 'CANCELLED') {
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
            reason: `Admin cancelled order ${order.id}`,
          },
        });
      }

      // Release coupon usage if the order had one applied.
      if (order.couponId) {
        await releaseCouponUsage(tx, order.couponId);
      }

      await tx.order.update({ where: { id }, data: updateData });
    });
  } else {
    await prisma.order.update({ where: { id }, data: updateData });

    if (newStatus === 'SHIPPED' && trackingCode) {
      try {
        const orderUser = await prisma.user.findUnique({
          where: { id: order.userId },
          select: { email: true, name: true },
        });
        if (orderUser) {
          await emailService.sendOrderShipped(
            orderUser.email,
            orderUser.name,
            order.id,
            trackingCode,
            shippingCarrier ?? 'Transportadora',
          );
        }
      } catch {
        // Email failure should not break status update
      }
    }
  }

  const updated = await prisma.order.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, name: true, email: true } },
      items: {
        include: {
          product: { select: { name: true, slug: true, thumbnailUrl: true } },
        },
      },
    },
  });

  if (!updated) throw new NotFoundError('Order');

  void reply.status(200).send(successResponse({
    id: updated.id,
    status: updated.status,
    totalAmount: toNumber(updated.totalAmount),
    trackingCode: updated.trackingCode,
    shippingCarrier: updated.shippingCarrier,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
    customer: updated.user,
    items: updated.items.map((item) => ({
      id: item.id,
      productId: item.productId,
      quantity: item.quantity,
      unitPrice: toNumber(item.unitPrice),
      total: toNumber(item.total),
      product: item.product,
    })),
  }));
}
