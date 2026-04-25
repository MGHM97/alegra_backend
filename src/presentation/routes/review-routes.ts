import type { FastifyInstance } from 'fastify';
import {
  canReviewHandler,
  createReviewHandler,
  listReviewsByProductIdHandler,
  listReviewsBySlugHandler,
} from '../controllers/review-controller.js';
import { createReviewSchema } from '../schemas/review-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';

export async function reviewRoutes(fastify: FastifyInstance): Promise<void> {
  // Public: list reviews
  fastify.get('/product/:productId', { handler: listReviewsByProductIdHandler });
  fastify.get('/slug/:slug', { handler: listReviewsBySlugHandler });

  // Authenticated: check eligibility (drives FE preventive UI)
  fastify.get('/can-review/:productId', {
    preHandler: [authGuard],
    handler: canReviewHandler,
  });

  // Authenticated: create review (verified-purchase enforced server-side)
  fastify.post('/', {
    preHandler: [authGuard, validateBody(createReviewSchema)],
    handler: createReviewHandler,
  });
}
