import type { FastifyInstance } from 'fastify';
import { getAdminMetricsHandler } from '../controllers/admin-metrics-controller.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function adminMetricsRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  fastify.get('/', {
    handler: getAdminMetricsHandler,
  });
}
