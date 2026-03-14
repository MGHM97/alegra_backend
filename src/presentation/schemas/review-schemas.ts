import { z } from 'zod';

export const createReviewSchema = z.object({
  productId: z.string().uuid('Invalid product ID format'),
  rating: z.number().int().min(1, 'Rating must be at least 1').max(5, 'Rating must be at most 5'),
  comment: z.string().min(1, 'Comment is required').max(1000),
  photos: z.array(z.string().url()).max(5).optional(),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
