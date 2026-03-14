import type { ReviewEntity } from '../entities/review.js';

export interface CreateReviewInput {
  userId: string;
  productId: string;
  userName: string;
  rating: number;
  comment: string;
  photos?: string[];
}

export interface ReviewRepository {
  findByProductId(productId: string): Promise<ReviewEntity[]>;
  findByProductSlug(slug: string): Promise<ReviewEntity[]>;
  findByUserId(userId: string): Promise<ReviewEntity[]>;
  create(data: CreateReviewInput): Promise<ReviewEntity>;
}
