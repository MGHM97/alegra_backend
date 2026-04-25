import { z } from 'zod';

/**
 * Admin Metrics Response Schema
 *
 * Decisões de cálculo:
 * - monthlyRevenue: soma de `totalAmount` de pedidos com status em
 *   { CONFIRMED, PROCESSING, SHIPPED, DELIVERED } (não-cancelados,
 *   não-pendentes), considerando `createdAt` no mês corrente. O schema
 *   atual não possui `paidAt`, então usamos `createdAt` como proxy de
 *   "pedido faturado". Documentado também no controller.
 * - pendingOrdersCount: pedidos com status em { PENDING, RESERVED }
 *   (aguardando pagamento ou ainda no fluxo de reserva).
 * - topProducts: TOP 5 por quantidade vendida, agrupando OrderItem por
 *   productId e excluindo pedidos com status CANCELLED ou REFUNDED.
 * - revenueLastMonth: mesmo critério do mês corrente, mas para o mês
 *   anterior, para permitir indicador de crescimento no FE.
 * - totalOrdersThisMonth/averageTicket: derivados, baixo custo.
 */
export const TopProductSchema = z.object({
  productId: z.string(),
  name: z.string(),
  thumbnailUrl: z.string(),
  totalSold: z.number().int().nonnegative(),
  totalRevenue: z.number().nonnegative(),
});

export type TopProduct = z.infer<typeof TopProductSchema>;

export const AdminMetricsSchema = z.object({
  monthlyRevenue: z.number().nonnegative(),
  revenueLastMonth: z.number().nonnegative(),
  revenueGrowthPercent: z.number(),
  pendingOrdersCount: z.number().int().nonnegative(),
  totalOrdersThisMonth: z.number().int().nonnegative(),
  averageTicket: z.number().nonnegative(),
  topProducts: z.array(TopProductSchema).max(5),
  generatedAt: z.string(),
});

export type AdminMetrics = z.infer<typeof AdminMetricsSchema>;
