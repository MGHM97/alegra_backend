import type { FastifyInstance } from 'fastify';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
} from '../controllers/auth-controller.js';
import { registerSchema, loginSchema } from '../schemas/auth-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/register', {
    preHandler: [validateBody(registerSchema)],
    handler: registerHandler,
  });

  fastify.post('/login', {
    preHandler: [validateBody(loginSchema)],
    handler: loginHandler,
  });

  fastify.post('/refresh', {
    handler: refreshHandler,
  });

  fastify.post('/logout', {
    handler: logoutHandler,
  });

  fastify.get('/me', {
    preHandler: [authGuard],
    handler: meHandler,
  });
}
