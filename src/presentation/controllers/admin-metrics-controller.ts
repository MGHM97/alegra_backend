import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { successResponse } from '../../shared/utils/response.js';
import { cacheGet, cacheSet } from '../../infra/cache/cache-utils.js';
import type { AdminMetrics, TopProduct } from '../schemas/admin-metrics-schemas.js';

const METRICS_CACHE_KEY = 'admin:metrics:v1';
const METRICS_CACHE_TTL_SECONDS = 60;

const REVENUE_STATUSES = ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED'] as const;
const PENDING_STATUSES = ['PENDING', 'RESERVED'] as const;
const EXCLUDED_FROM_TOP = ['CANCELLED', 'REFUNDED'] as const;

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (value && typeof value === 'object' && 'toNumber' in value) {
    const fn = (value as { toNumber: () => number }).toNumber;
    if (typeof fn === 'function') return fn.call(value);
  }
  return Number(value ?? 0);
}

function startOfCurrentMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
}

function startOfLastMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
}

async function computeMetrics(): Promise<AdminMetrics> {
  const now = new Date();
  const monthStart = startOfCurrentMonth(now);
  const lastMonthStart = startOfLastMonth(now);

  // Run independent queries in parallel.
  const [
    monthAgg,
    lastMonthAgg,
    pendingCount,
    topItems,
  ] = await Promise.all([
    prisma.order.aggregate({
      where: {
        status: { in: [...REVENUE_STATUSES] },
        createdAt: { gte: monthStart },
      },
      _sum: { totalAmount: true },
      _count: { _all: true },
    }),
    prisma.order.aggregate({
      where: {
        status: { in: [...REVENUE_STATUSES] },
        createdAt: { gte: lastMonthStart, lt: monthStart },
      },
      _sum: { totalAmount: true },
    }),
    prisma.order.count({
      where: { status: { in: [...PENDING_STATUSES] } },
    }),
    prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          status: { notIn: [...EXCLUDED_FROM_TOP] },
        },
      },
      _sum: { quantity: true, total: true },
      orderBy: { _sum: { quantity: 'desc' } },
      take: 5,
    }),
  ]);

  const monthlyRevenue = toNumber(monthAgg._sum.totalAmount);
  const revenueLastMonth = toNumber(lastMonthAgg._sum.totalAmount);
  const totalOrdersThisMonth = monthAgg._count._all;
  const averageTicket = totalOrdersThisMonth > 0
    ? monthlyRevenue / totalOrdersThisMonth
    : 0;
  const revenueGrowthPercent = revenueLastMonth > 0
    ? ((monthlyRevenue - revenueLastMonth) / revenueLastMonth) * 100
    : (monthlyRevenue > 0 ? 100 : 0);

  // Hydrate top products with name + thumbnail.
  const productIds = topItems.map((item) => item.productId);
  const products = productIds.length > 0
    ? await prisma.product.findMany({
        where: { id: { in: productIds } },
        select: { id: true, name: true, thumbnailUrl: true },
      })
    : [];

  const productMap = new Map(products.map((p) => [p.id, p]));

  const topProducts: TopProduct[] = topItems
    .map((item) => {
      const product = productMap.get(item.productId);
      if (!product) return null;
      return {
        productId: item.productId,
        name: product.name,
        thumbnailUrl: product.thumbnailUrl,
        totalSold: item._sum.quantity ?? 0,
        totalRevenue: toNumber(item._sum.total),
      };
    })
    .filter((entry): entry is TopProduct => entry !== null);

  return {
    monthlyRevenue,
    revenueLastMonth,
    revenueGrowthPercent: Number(revenueGrowthPercent.toFixed(2)),
    pendingOrdersCount: pendingCount,
    totalOrdersThisMonth,
    averageTicket: Number(averageTicket.toFixed(2)),
    topProducts,
    generatedAt: now.toISOString(),
  };
}

export async function getAdminMetricsHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const cached = await cacheGet<AdminMetrics>(METRICS_CACHE_KEY);
  if (cached) {
    void reply.status(200).send(successResponse(cached));
    return;
  }

  const metrics = await computeMetrics();
  await cacheSet(METRICS_CACHE_KEY, metrics, METRICS_CACHE_TTL_SECONDS);

  void reply.status(200).send(successResponse(metrics));
}
