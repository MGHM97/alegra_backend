import type { FastifyInstance } from 'fastify';
import { fetchStockHandler, syncInventoryHandler } from '../controllers/inventory-controller.js';
import { inventorySyncSchema } from '../schemas/inventory-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function inventoryRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get('/:productId', {
    preHandler: [authGuard, requireRole('ADMIN')],
    handler: fetchStockHandler,
  });

  fastify.patch('/sync', {
    preHandler: [authGuard, requireRole('ADMIN'), validateBody(inventorySyncSchema)],
    handler: syncInventoryHandler,
  });
}
