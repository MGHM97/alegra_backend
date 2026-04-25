import type { FastifyInstance } from 'fastify';
import { validateCouponHandler } from '../controllers/coupon-controller.js';
import { validateCouponSchema } from '../schemas/coupon-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';

export async function couponRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/validate', {
    preHandler: [validateBody(validateCouponSchema)],
    handler: validateCouponHandler,
  });
}
