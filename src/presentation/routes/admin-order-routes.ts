import type { FastifyInstance } from 'fastify';
import {
  listAdminOrdersHandler,
  updateOrderStatusHandler,
} from '../controllers/admin-order-controller.js';
import { refundOrderHandler } from '../controllers/refund-controller.js';
import {
  adminOrderFiltersSchema,
  updateOrderStatusSchema,
} from '../schemas/admin-order-schemas.js';
import { refundOrderSchema } from '../schemas/refund-schemas.js';
import { validateQuery, validateBody } from '../../shared/middlewares/validate.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function adminOrderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  fastify.get('/', {
    preHandler: [validateQuery(adminOrderFiltersSchema)],
    handler: listAdminOrdersHandler,
  });

  fastify.patch('/:id/status', {
    preHandler: [validateBody(updateOrderStatusSchema)],
    handler: updateOrderStatusHandler,
  });

  fastify.post('/:id/refund', {
    preHandler: [validateBody(refundOrderSchema)],
    handler: refundOrderHandler,
  });
}
