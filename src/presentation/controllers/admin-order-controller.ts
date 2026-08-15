import type { Prisma } from '@prisma/client';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { successResponse, listResponse } from '../../shared/utils/response.js';
import {
  NotFoundError,
  ValidationError,
  OrderStateConflictError,
} from '../../domain/errors/app-error.js';
import { EmailService } from '../../application/services/email-service.js';
import { releaseCouponUsage } from '../../application/services/coupon-service.js';
import { confirmOrderPayment } from '../../application/services/order-confirmation-service.js';
import { InventoryService } from '../../application/services/inventory-service.js';
import { cacheInvalidatePattern } from '../../infra/cache/cache-utils.js';

const emailService = new EmailService();
const inventoryService = new InventoryService();
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

  if (newStatus === 'CONFIRMED') {
    // Marcação manual de pagamento confirmado (ex.: PIX/boleto pago fora do
    // fluxo Stripe). Reivindica a transição atomicamente e converte a
    // reserva de estoque em venda efetiva (SALE) na mesma transação —
    // mesmo caminho usado pelo webhook, para nunca decrementar o estoque
    // duas vezes para o mesmo pedido.
    const converted = await confirmOrderPayment({
      orderId: id,
      fromStatuses: [order.status],
      toStatus: 'CONFIRMED',
      items: order.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
    });

    if (!converted) {
      throw new OrderStateConflictError();
    }
  } else if (newStatus === 'CANCELLED') {
    await prisma.$transaction(async (tx) => {
      // Reivindica a transição atomicamente: se o pedido já saiu do status
      // lido acima (ex.: cliente cancelou ou webhook confirmou em paralelo),
      // count === 0 e abortamos antes de tocar no estoque — evitando
      // decremento duplo de reservedStock (double-release).
      const claim = await tx.order.updateMany({
        where: { id, status: order.status },
        data: updateData,
      });

      if (claim.count === 0) {
        throw new OrderStateConflictError();
      }

      // order.status é o status ANTES do claim. VALID_TRANSITIONS permite
      // cancelar a partir de PENDING/RESERVED (pré-venda) OU de
      // CONFIRMED/PROCESSING (pós-venda, quando commitSale já rodou). O
      // ramo correto — liberar reserva vs. devolver ao estoque físico — é
      // decidido dentro de releaseOrderStock a partir desse status.
      await inventoryService.releaseOrderStock(
        tx,
        order.id,
        order.items.map((item) => ({ productId: item.productId, quantity: item.quantity })),
        order.status,
        `Admin cancelled order ${order.id}`,
      );

      // Release coupon usage if the order had one applied.
      if (order.couponId) {
        await releaseCouponUsage(tx, order.couponId);
      }
    });

    // Fora da transação e best-effort (Redis não é transacional com o
    // Postgres): o estoque já foi liberado no banco quando chegamos aqui.
    await cacheInvalidatePattern('products:*');
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
