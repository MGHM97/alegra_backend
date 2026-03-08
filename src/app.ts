import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { env } from './infra/config/env.js';
import { registerRoutes } from './presentation/routes/index.js';
import { globalErrorHandler } from './shared/middlewares/error-handler.js';

export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: env.NODE_ENV === 'production' ? 'warn' : 'info',
      transport:
        env.NODE_ENV === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    trustProxy: true,
  });

  await fastify.register(helmet, {
    contentSecurityPolicy: env.NODE_ENV === 'production',
  });

  await fastify.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key'],
  });

  await fastify.register(cookie, {
    secret: env.JWT_SECRET,
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => {
      return request.currentUser?.sub ?? request.ip;
    },
  });

  fastify.setErrorHandler(globalErrorHandler);

  fastify.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  await registerRoutes(fastify);

  return fastify;
}
