import type {
  AdminReviewListFilters,
  AdminReviewListResult,
  ReviewEntity,
} from '../entities/review.js';

export interface CreateReviewInput {
  userId: string;
  productId: string;
  userName: string;
  rating: number;
  comment: string;
  photos?: string[];
  isVerifiedPurchase?: boolean;
}

export interface ReviewRepository {
  findByProductId(productId: string): Promise<ReviewEntity[]>;
  findByProductSlug(slug: string): Promise<ReviewEntity[]>;
  findByUserId(userId: string): Promise<ReviewEntity[]>;
  findById(id: string): Promise<ReviewEntity | null>;
  findByUserAndProduct(userId: string, productId: string): Promise<ReviewEntity | null>;
  create(data: CreateReviewInput): Promise<ReviewEntity>;
  delete(id: string): Promise<void>;
  listAdmin(filters: AdminReviewListFilters): Promise<AdminReviewListResult>;
}
