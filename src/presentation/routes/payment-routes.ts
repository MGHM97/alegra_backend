import type { FastifyInstance } from 'fastify';
import {
  createPaymentIntentHandler,
  webhookHandler,
} from '../controllers/payment-controller.js';
import { createPaymentIntentSchema } from '../schemas/payment-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';

export async function paymentRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/create-intent', {
    preHandler: [authGuard, validateBody(createPaymentIntentSchema)],
    handler: createPaymentIntentHandler,
  });

  // Webhook: no auth guard — Stripe sends it directly.
  // Raw body stored by custom content-type parser in app.ts.
  fastify.post('/webhook', { handler: webhookHandler });
}
