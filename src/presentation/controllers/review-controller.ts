import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaReviewRepository } from '../../infra/database/prisma-review-repository.js';
import type { CreateReviewInput } from '../schemas/review-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import {
  ReviewAlreadyExistsError,
  ReviewNotVerifiedPurchaseError,
  UnauthorizedError,
} from '../../domain/errors/app-error.js';
import { userHasDeliveredPurchase } from '../../application/services/review-eligibility-service.js';

const reviewRepository = new PrismaReviewRepository();

interface SerializedReview {
  id: string;
  userId: string;
  productId: string;
  userName: string;
  rating: number;
  comment: string;
  photos: string[];
  isVerifiedPurchase: boolean;
  createdAt: string;
  updatedAt: string;
}

function serializeReview(review: {
  id: string;
  userId: string;
  productId: string;
  userName: string;
  rating: number;
  comment: string;
  photos: string[];
  isVerifiedPurchase: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SerializedReview {
  return {
    id: review.id,
    userId: review.userId,
    productId: review.productId,
    userName: review.userName,
    rating: review.rating,
    comment: review.comment,
    photos: review.photos,
    isVerifiedPurchase: review.isVerifiedPurchase,
    createdAt: review.createdAt.toISOString(),
    updatedAt: review.updatedAt.toISOString(),
  };
}

export async function listReviewsBySlugHandler(
  request: FastifyRequest<{ Params: { slug: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const reviews = await reviewRepository.findByProductSlug(request.params.slug);
  void reply.status(200).send(successResponse(reviews.map(serializeReview)));
}

export async function listReviewsByProductIdHandler(
  request: FastifyRequest<{ Params: { productId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const reviews = await reviewRepository.findByProductId(request.params.productId);
  void reply.status(200).send(successResponse(reviews.map(serializeReview)));
}

export async function createReviewHandler(
  request: FastifyRequest<{ Body: CreateReviewInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const { productId, rating, comment, photos } = request.body;

  // Zero-Trust: enforce the verified-purchase rule on the server.
  // Order matters: check duplicate first to avoid leaking eligibility
  // information for products the user has not purchased.
  const existing = await reviewRepository.findByUserAndProduct(
    currentUser.sub,
    productId,
  );
  if (existing) {
    throw new ReviewAlreadyExistsError();
  }

  const eligible = await userHasDeliveredPurchase(currentUser.sub, productId);
  if (!eligible) {
    throw new ReviewNotVerifiedPurchaseError();
  }

  const review = await reviewRepository.create({
    userId: currentUser.sub,
    productId,
    userName: currentUser.email.split('@')[0] ?? 'Anonymous',
    rating,
    comment,
    photos,
    isVerifiedPurchase: true,
  });

  void reply.status(201).send(successResponse(serializeReview(review)));
}

export async function canReviewHandler(
  request: FastifyRequest<{ Params: { productId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const { productId } = request.params;
  const [hasReviewed, hasPurchase] = await Promise.all([
    reviewRepository.findByUserAndProduct(currentUser.sub, productId),
    userHasDeliveredPurchase(currentUser.sub, productId),
  ]);

  let reason: 'ALREADY_REVIEWED' | 'NOT_PURCHASED' | null = null;
  let canReview = true;

  if (hasReviewed) {
    canReview = false;
    reason = 'ALREADY_REVIEWED';
  } else if (!hasPurchase) {
    canReview = false;
    reason = 'NOT_PURCHASED';
  }

  void reply.status(200).send(
    successResponse({
      canReview,
      hasPurchase,
      hasReviewed: hasReviewed !== null,
      reason,
    }),
  );
}
