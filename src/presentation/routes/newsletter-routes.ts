import type { FastifyInstance } from 'fastify';
import { subscribeNewsletterHandler } from '../controllers/newsletter-controller.js';
import { subscribeNewsletterSchema } from '../schemas/newsletter-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';

export async function newsletterRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/subscribe', {
    preHandler: [validateBody(subscribeNewsletterSchema)],
    handler: subscribeNewsletterHandler,
  });
}
