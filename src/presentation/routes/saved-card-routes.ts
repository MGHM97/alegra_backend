import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import {
  listSavedCardsHandler,
  createSetupIntentHandler,
  createSavedCardHandler,
  updateSavedCardHandler,
  deleteSavedCardHandler,
} from '../controllers/saved-card-controller.js';
import { createSavedCardSchema, updateSavedCardSchema } from '../schemas/saved-card-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';
import { getRedisClient } from '../../infra/cache/redis-client.js';
import { AppError } from '../../domain/errors/app-error.js';

const SETUP_INTENT_MAX_ATTEMPTS = 10;
const SETUP_INTENT_WINDOW_SECONDS = 60;

/**
 * Rate limit por usuário autenticado (roda depois do `authGuard`, que já
 * populou `request.currentUser`) para o endpoint de criação de SetupIntent.
 * Segue o mesmo padrão fail-open do `loginRateLimiter` em auth-routes.ts:
 * Redis fora do ar não pode derrubar a disponibilidade do cadastro de
 * cartão, só o rate limit em si.
 */
async function setupIntentRateLimiter(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const userId = request.currentUser?.sub;
  if (!userId) {
    return;
  }

  try {
    const redis = await getRedisClient();
    const key = `ratelimit:cards:setup-intent:${userId}`;
    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, SETUP_INTENT_WINDOW_SECONDS);
    }
    if (current > SETUP_INTENT_MAX_ATTEMPTS) {
      const ttl = await redis.ttl(key);
      throw new AppError(
        `Muitas tentativas de cadastro de cartão. Tente novamente em ${Math.max(1, Math.ceil(ttl / 60))} minuto(s).`,
        429,
        'CARD_SETUP_RATE_LIMITED',
      );
    }
  } catch (err) {
    if (err instanceof AppError) throw err;
    request.log.warn(
      { err },
      'Rate limiter de setup-intent indisponível — requisição liberada sem limite',
    );
  }
}

export async function savedCardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);

  fastify.get('/', { handler: listSavedCardsHandler });

  fastify.post('/setup-intent', {
    preHandler: [setupIntentRateLimiter],
    handler: createSetupIntentHandler,
  });

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
