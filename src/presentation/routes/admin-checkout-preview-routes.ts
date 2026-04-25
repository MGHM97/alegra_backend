import type { FastifyInstance } from 'fastify';
import {
  confirmPreviewIntentHandler,
  createPreviewIntentHandler,
  createPreviewOrderHandler,
} from '../controllers/admin-checkout-preview-controller.js';
import {
  confirmPreviewIntentSchema,
  createPreviewIntentSchema,
  createPreviewOrderSchema,
} from '../schemas/admin-checkout-preview-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

/**
 * Admin Checkout Preview Routes
 *
 * Mounted at /v1/admin/checkout-preview. All endpoints require ADMIN role
 * — the frontend toggle is purely UX, the role check here is the security
 * boundary. NEVER persists, NEVER calls Stripe, NEVER touches stock.
 */
export async function adminCheckoutPreviewRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  fastify.post('/create-intent', {
    preHandler: [validateBody(createPreviewIntentSchema)],
    handler: createPreviewIntentHandler,
  });

  fastify.post('/confirm', {
    preHandler: [validateBody(confirmPreviewIntentSchema)],
    handler: confirmPreviewIntentHandler,
  });

  fastify.post('/order', {
    preHandler: [validateBody(createPreviewOrderSchema)],
    handler: createPreviewOrderHandler,
  });
}
