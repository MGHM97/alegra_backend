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

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  RESERVED: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: ['REFUNDED'],
};

export { VALID_TRANSITIONS };

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED',
  ]),
  trackingCode: z.string().max(100).optional(),
  shippingCarrier: z.string().max(100).optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
