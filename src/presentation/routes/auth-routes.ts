import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  registerHandler,
  loginHandler,
  refreshHandler,
  logoutHandler,
  meHandler,
  updateProfileHandler,
  deleteAccountHandler,
} from '../controllers/auth-controller.js';
import {
  forgotPasswordHandler,
  resetPasswordHandler,
} from '../controllers/password-reset-controller.js';
import {
  registerSchema,
  loginSchema,
  updateProfileSchema,
  deleteAccountSchema,
} from '../schemas/auth-schemas.js';
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from '../schemas/password-reset-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';
import { getRedisClient } from '../../infra/cache/redis-client.js';
import { AppError } from '../../domain/errors/app-error.js';

const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_WINDOW_SECONDS = 900; // 15 minutes

async function loginRateLimiter(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  try {
    const redis = await getRedisClient();
    const key = `ratelimit:login:${request.ip}`;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, LOGIN_WINDOW_SECONDS);
    }
    if (current > LOGIN_MAX_ATTEMPTS) {
      const ttl = await redis.ttl(key);
      throw new AppError(
        `Muitas tentativas de login. Tente novamente em ${Math.ceil(ttl / 60)} minuto(s).`,
        429,
        'LOGIN_RATE_LIMITED',
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    // Redis down — allow request to proceed
  }
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/register', {
    preHandler: [validateBody(registerSchema)],
    handler: registerHandler,
  });

  fastify.post('/login', {
    preHandler: [loginRateLimiter, validateBody(loginSchema)],
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

  fastify.put('/profile', {
    preHandler: [authGuard, validateBody(updateProfileSchema)],
    handler: updateProfileHandler,
  });

  fastify.delete('/me', {
    preHandler: [authGuard, validateBody(deleteAccountSchema)],
    handler: deleteAccountHandler,
  });

  fastify.post('/forgot-password', {
    preHandler: [validateBody(forgotPasswordSchema)],
    handler: forgotPasswordHandler,
  });

  fastify.post('/reset-password', {
    preHandler: [validateBody(resetPasswordSchema)],
    handler: resetPasswordHandler,
  });
}
