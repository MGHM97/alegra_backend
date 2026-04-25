import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaReviewRepository } from '../../infra/database/prisma-review-repository.js';
import { listResponse } from '../../shared/utils/response.js';
import { NotFoundError } from '../../domain/errors/app-error.js';
import type { AdminListReviewsQuery } from '../schemas/review-schemas.js';
import type { ReviewWithRelations } from '../../domain/entities/review.js';

const reviewRepository = new PrismaReviewRepository();

interface SerializedAdminReview {
  id: string;
  rating: number;
  comment: string;
  photos: string[];
  isVerifiedPurchase: boolean;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string;
    email: string;
  };
  product: {
    id: string;
    name: string;
    slug: string;
    thumbnailUrl: string;
  };
}

function serializeAdminReview(review: ReviewWithRelations): SerializedAdminReview {
  return {
    id: review.id,
    rating: review.rating,
    comment: review.comment,
    photos: review.photos,
    isVerifiedPurchase: review.isVerifiedPurchase,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
    user: review.user,
    product: review.product,
  };
}

export async function listAdminReviewsHandler(
  request: FastifyRequest<{ Querystring: AdminListReviewsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const { cursor, limit, productId, userId, rating, search } = request.query;
  const result = await reviewRepository.listAdmin({
    cursor,
    limit,
    productId,
    userId,
    rating,
    search,
  });

  void reply
    .status(200)
    .send(listResponse(result.data.map(serializeAdminReview), result.nextCursor, result.hasMore));
}

export async function deleteAdminReviewHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const existing = await reviewRepository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Review');
  }
  await reviewRepository.delete(request.params.id);
  void reply.status(204).send();
}
