import type { FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { PrismaReviewRepository } from '../../infra/database/prisma-review-repository.js';
import type { CreateReviewInput } from '../schemas/review-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import {
  ReviewAlreadyExistsError,
  ReviewNotVerifiedPurchaseError,
  UnauthorizedError,
} from '../../domain/errors/app-error.js';
import { userHasDeliveredPurchase } from '../../application/services/review-eligibility-service.js';
import { cacheGet, cacheSet } from '../../infra/cache/cache-utils.js';
import {
  invalidateProductReviewsCache,
  productReviewsBySlugCacheKey,
  productReviewsCacheKey,
} from '../../application/services/review-cache-service.js';

const reviewRepository = new PrismaReviewRepository();

// Páginas de produto batem em /product/:id e /slug/:slug a cada carregamento
// — TTL curto o bastante para refletir novas avaliações em minutos, longo o
// bastante para tirar a maior parte da carga do Postgres. Mesmo padrão de
// product-controller.ts.
const REVIEWS_LIST_TTL = 300; // 5 minutes

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
  const { slug } = request.params;
  const cacheKey = productReviewsBySlugCacheKey(slug);
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached) {
    void reply.status(200).send(cached);
    return;
  }

  const reviews = await reviewRepository.findByProductSlug(slug);
  const response = successResponse(reviews.map(serializeReview));
  await cacheSet(cacheKey, response, REVIEWS_LIST_TTL);

  void reply.status(200).send(response);
}

export async function listReviewsByProductIdHandler(
  request: FastifyRequest<{ Params: { productId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { productId } = request.params;
  const cacheKey = productReviewsCacheKey(productId);
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached) {
    void reply.status(200).send(cached);
    return;
  }

  const reviews = await reviewRepository.findByProductId(productId);
  const response = successResponse(reviews.map(serializeReview));
  await cacheSet(cacheKey, response, REVIEWS_LIST_TTL);

  void reply.status(200).send(response);
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

  let review;
  try {
    review = await reviewRepository.create({
      userId: currentUser.sub,
      productId,
      userName: currentUser.email.split('@')[0] ?? 'Anonymous',
      rating,
      comment,
      photos,
      isVerifiedPurchase: true,
    });
  } catch (err) {
    // Corrida: dois POST simultâneos do mesmo usuário para o mesmo produto
    // passam ambos no findByUserAndProduct acima; a constraint @@unique
    // ([userId, productId]) barra o segundo com P2002. Traduzimos para 409
    // em vez de vazar um 500 (INTERNAL_ERROR).
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ReviewAlreadyExistsError();
    }
    throw err;
  }

  // Best-effort, fora do caminho crítico: se o Redis estiver indisponível,
  // a review já foi persistida — o pior caso é a listagem cacheada ficar
  // desatualizada até o TTL expirar, nunca uma falha na criação.
  await invalidateProductReviewsCache(productId);

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
