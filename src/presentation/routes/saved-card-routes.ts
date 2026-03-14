import type { FastifyInstance } from 'fastify';
import {
  listSavedCardsHandler,
  createSavedCardHandler,
  updateSavedCardHandler,
  deleteSavedCardHandler,
} from '../controllers/saved-card-controller.js';
import { createSavedCardSchema, updateSavedCardSchema } from '../schemas/saved-card-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';

export async function savedCardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);

  fastify.get('/', { handler: listSavedCardsHandler });

  fastify.post('/', {
    preHandler: [validateBody(createSavedCardSchema)],
    handler: createSavedCardHandler,
  });

  fastify.put('/:id', {
    preHandler: [validateBody(updateSavedCardSchema)],
    handler: updateSavedCardHandler,
  });

  fastify.delete('/:id', { handler: deleteSavedCardHandler });
}
