import type { FastifyInstance } from 'fastify';
import {
  createCouponHandler,
  deleteCouponHandler,
  getCouponHandler,
  listCouponsHandler,
  updateCouponHandler,
} from '../controllers/admin-coupon-controller.js';
import {
  createCouponSchema,
  listCouponsQuerySchema,
  updateCouponSchema,
} from '../schemas/coupon-schemas.js';
import { validateBody, validateQuery } from '../../shared/middlewares/validate.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function adminCouponRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  fastify.get('/', {
    preHandler: [validateQuery(listCouponsQuerySchema)],
    handler: listCouponsHandler,
  });

  fastify.get('/:id', {
    handler: getCouponHandler,
  });

  fastify.post('/', {
    preHandler: [validateBody(createCouponSchema)],
    handler: createCouponHandler,
  });

  fastify.patch('/:id', {
    preHandler: [validateBody(updateCouponSchema)],
    handler: updateCouponHandler,
  });

  fastify.delete('/:id', {
    handler: deleteCouponHandler,
  });
}
