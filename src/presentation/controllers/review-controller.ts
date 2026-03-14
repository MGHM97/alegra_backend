import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaReviewRepository } from '../../infra/database/prisma-review-repository.js';
import type { CreateReviewInput } from '../schemas/review-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { UnauthorizedError } from '../../domain/errors/app-error.js';

const reviewRepository = new PrismaReviewRepository();

export async function listReviewsBySlugHandler(
  request: FastifyRequest<{ Params: { slug: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const reviews = await reviewRepository.findByProductSlug(request.params.slug);
  void reply.status(200).send(successResponse(reviews));
}

export async function listReviewsByProductIdHandler(
  request: FastifyRequest<{ Params: { productId: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const reviews = await reviewRepository.findByProductId(request.params.productId);
  void reply.status(200).send(successResponse(reviews));
}

export async function createReviewHandler(
  request: FastifyRequest<{ Body: CreateReviewInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const review = await reviewRepository.create({
    userId: currentUser.sub,
    productId: request.body.productId,
    userName: currentUser.email.split('@')[0] ?? 'Anonymous',
    rating: request.body.rating,
    comment: request.body.comment,
    photos: request.body.photos,
  });

  void reply.status(201).send(successResponse(review));
}
