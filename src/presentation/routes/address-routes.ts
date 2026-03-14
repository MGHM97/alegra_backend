import type { FastifyInstance } from 'fastify';
import {
  listAddressesHandler,
  createAddressHandler,
  updateAddressHandler,
  deleteAddressHandler,
} from '../controllers/address-controller.js';
import { createAddressSchema, updateAddressSchema } from '../schemas/address-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';

export async function addressRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);

  fastify.get('/', { handler: listAddressesHandler });

  fastify.post('/', {
    preHandler: [validateBody(createAddressSchema)],
    handler: createAddressHandler,
  });

  fastify.put('/:id', {
    preHandler: [validateBody(updateAddressSchema)],
    handler: updateAddressHandler,
  });

  fastify.delete('/:id', { handler: deleteAddressHandler });
}
