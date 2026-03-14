import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth-routes.js';
import { productRoutes } from './product-routes.js';
import { orderRoutes } from './order-routes.js';
import { inventoryRoutes } from './inventory-routes.js';
import { addressRoutes } from './address-routes.js';
import { savedCardRoutes } from './saved-card-routes.js';
import { reviewRoutes } from './review-routes.js';

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(authRoutes, { prefix: '/v1/auth' });
  await fastify.register(productRoutes, { prefix: '/v1/products' });
  await fastify.register(orderRoutes, { prefix: '/v1/orders' });
  await fastify.register(inventoryRoutes, { prefix: '/v1/inventory' });
  await fastify.register(addressRoutes, { prefix: '/v1/addresses' });
  await fastify.register(savedCardRoutes, { prefix: '/v1/cards' });
  await fastify.register(reviewRoutes, { prefix: '/v1/reviews' });
}
