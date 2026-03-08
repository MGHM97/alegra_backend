import { z } from 'zod';

const orderItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID format'),
  quantity: z.number().int().positive('Quantity must be a positive integer').max(999),
  unitPrice: z.number().positive('Unit price must be positive'),
});

export const createOrderSchema = z.object({
  items: z
    .array(orderItemSchema)
    .min(1, 'Order must have at least one item')
    .max(50, 'Order cannot have more than 50 items'),
  idempotencyKey: z.string().uuid('Idempotency key must be a valid UUID').optional(),
  notes: z.string().max(500).optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;
