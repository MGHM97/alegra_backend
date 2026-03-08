import type { FastifyInstance } from 'fastify';
import {
  listProductsHandler,
  getProductHandler,
  getProductByIdHandler,
} from '../controllers/product-controller.js';
import { productFiltersSchema } from '../schemas/product-schemas.js';
import { validateQuery } from '../../shared/middlewares/validate.js';

export async function productRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/', {
    preHandler: [validateQuery(productFiltersSchema)],
    handler: listProductsHandler,
  });

  fastify.get('/slug/:slug', {
    handler: getProductHandler,
  });

  fastify.get('/:id', {
    handler: getProductByIdHandler,
  });
}
