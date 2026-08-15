import { z } from 'zod';

export const adminOrderFiltersSchema = z.object({
  status: z.enum([
    'PENDING', 'RESERVED', 'CONFIRMED', 'PROCESSING',
    'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
  ]).optional(),
  period: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type AdminOrderFiltersInput = z.infer<typeof adminOrderFiltersSchema>;

// REFUNDED nunca é um destino manual aqui: apenas o endpoint dedicado
// POST /v1/admin/orders/:id/refund pode levar um pedido a REFUNDED, pois
// esse fluxo aciona o estorno real na Stripe. Marcar REFUNDED por aqui
// mudaria o status sem devolver o dinheiro ao cliente.
const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  RESERVED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
};

export { VALID_TRANSITIONS };

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED',
  ]),
  trackingCode: z.string().max(100).optional(),
  shippingCarrier: z.string().max(100).optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
