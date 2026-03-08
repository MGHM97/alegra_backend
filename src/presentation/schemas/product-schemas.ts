import { z } from 'zod';

export const productFiltersSchema = z.object({
  category: z.string().max(50).optional(),
  search: z.string().max(200).optional(),
  minPrice: z.coerce.number().nonnegative().optional(),
  maxPrice: z.coerce.number().positive().optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  badges: z
    .string()
    .transform((v) => v.split(',').map((b) => b.trim()))
    .optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ProductFiltersInput = z.infer<typeof productFiltersSchema>;
