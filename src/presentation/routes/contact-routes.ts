import type { FastifyInstance } from 'fastify';
import { contactHandler } from '../controllers/contact-controller.js';
import { contactSchema } from '../schemas/contact-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';

export async function contactRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/', {
    preHandler: [validateBody(contactSchema)],
    handler: contactHandler,
  });
}
