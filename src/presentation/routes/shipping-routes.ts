import type { FastifyInstance } from 'fastify';
import { calculateShippingHandler } from '../controllers/shipping-controller.js';
import { calculateShippingSchema } from '../schemas/shipping-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';

export async function shippingRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/calculate', {
    preHandler: [validateBody(calculateShippingSchema)],
    handler: calculateShippingHandler,
  });
}
