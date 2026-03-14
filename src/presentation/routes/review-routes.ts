import type { FastifyInstance } from 'fastify';
import {
  listReviewsBySlugHandler,
  listReviewsByProductIdHandler,
  createReviewHandler,
} from '../controllers/review-controller.js';
import { createReviewSchema } from '../schemas/review-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';

export async function reviewRoutes(fastify: FastifyInstance): Promise<void> {
  // Public: list reviews
  fastify.get('/product/:productId', { handler: listReviewsByProductIdHandler });
  fastify.get('/slug/:slug', { handler: listReviewsBySlugHandler });

  // Authenticated: create review
  fastify.post('/', {
    preHandler: [authGuard, validateBody(createReviewSchema)],
    handler: createReviewHandler,
  });
}
