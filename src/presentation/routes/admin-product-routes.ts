import type { FastifyInstance } from 'fastify';
import {
  createProductHandler,
  updateProductHandler,
  toggleProductStatusHandler,
  deleteProductHandler,
} from '../controllers/admin-product-controller.js';
import {
  createProductSchema,
  updateProductSchema,
  toggleStatusSchema,
} from '../schemas/admin-product-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function adminProductRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  fastify.post('/', {
    preHandler: [validateBody(createProductSchema)],
    handler: createProductHandler,
  });

  fastify.put('/:id', {
    preHandler: [validateBody(updateProductSchema)],
    handler: updateProductHandler,
  });

  fastify.patch('/:id/status', {
    preHandler: [validateBody(toggleStatusSchema)],
    handler: toggleProductStatusHandler,
  });

  fastify.delete('/:id', {
    handler: deleteProductHandler,
  });
}
