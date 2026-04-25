import type { FastifyInstance } from 'fastify';
import {
  listAdminUsersHandler,
  toggleUserStatusHandler,
} from '../controllers/admin-user-controller.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function adminUserRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  fastify.get('/', { handler: listAdminUsersHandler });

  fastify.patch('/:id/status', { handler: toggleUserStatusHandler });
}
