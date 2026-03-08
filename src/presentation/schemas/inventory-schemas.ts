import { z } from 'zod';

const syncItemSchema = z.object({
  productId: z.string().uuid('Invalid product ID'),
  stock: z.number().int().nonnegative('Stock cannot be negative'),
  reason: z.string().max(200).optional(),
});

export const inventorySyncSchema = z.object({
  items: z
    .array(syncItemSchema)
    .min(1, 'At least one item required')
    .max(100, 'Max 100 items per sync'),
});

export type InventorySyncInput = z.infer<typeof inventorySyncSchema>;
