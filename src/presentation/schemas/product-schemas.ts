import { z } from 'zod';

export const productSortSchema = z.enum([
  'relevance',
  'price_asc',
  'price_desc',
  'newest',
  'best_sellers',
  'top_rated',
  'discount',
]);

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
  sort: productSortSchema.default('relevance'),
  // Opaque cursor (base64url JSON, see product-list-cursor.ts) OR, for
  // backward compatibility, a plain product uuid from clients that predate
  // server-side sort — the repository tells the two formats apart and
  // resolves the legacy shape to createdAt-desc pagination. The regex only
  // enforces the shared charset (both formats use base64url-safe chars);
  // structural validation of the decoded payload happens in the repository.
  cursor: z
    .string()
    .max(500)
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid cursor format')
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type ProductFiltersInput = z.infer<typeof productFiltersSchema>;
