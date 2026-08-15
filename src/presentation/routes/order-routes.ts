import type { FastifyInstance } from 'fastify';
import {
  createOrderHandler,
  listUserOrdersHandler,
  getOrderDetailHandler,
  cancelOrderHandler,
} from '../controllers/order-controller.js';
import { createOrderSchema, listUserOrdersQuerySchema } from '../schemas/order-schemas.js';
import { validateBody, validateQuery } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';

export async function orderRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);

  fastify.post('/', {
    preHandler: [validateBody(createOrderSchema)],
    handler: createOrderHandler,
  });

  fastify.get('/', {
    preHandler: [validateQuery(listUserOrdersQuerySchema)],
    handler: listUserOrdersHandler,
  });

  fastify.get('/:id', {
    handler: getOrderDetailHandler,
  });

  fastify.patch('/:id/cancel', {
    handler: cancelOrderHandler,
  });
}
