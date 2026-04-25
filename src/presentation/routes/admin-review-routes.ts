import type { FastifyInstance } from 'fastify';
import {
  deleteAdminReviewHandler,
  listAdminReviewsHandler,
} from '../controllers/admin-review-controller.js';
import { adminListReviewsQuerySchema } from '../schemas/review-schemas.js';
import { validateQuery } from '../../shared/middlewares/validate.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function adminReviewRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  fastify.get('/', {
    preHandler: [validateQuery(adminListReviewsQuerySchema)],
    handler: listAdminReviewsHandler,
  });

  fastify.delete('/:id', {
    handler: deleteAdminReviewHandler,
  });
}
