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

/**
 * Extrai e normaliza o campo `identifier` do corpo bruto da requisição de
 * login. Roda ANTES do `validateBody(loginSchema)` (que só normaliza depois),
 * então o corpo ainda não tem tipo garantido — daí o type guard manual em vez
 * de confiar no shape do Zod.
 */
function extractBodyIdentifier(body: unknown, field: string): string | null {
  if (typeof body !== 'object' || body === null || !(field in body)) {
    return null;
  }
  const value = (body as Record<string, unknown>)[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }
  return value.trim().toLowerCase();
}

interface AuthRateLimitOptions {
  /** Prefixo da chave no Redis e nome legível para logs/mensagens. */
  scope: string;
  /** Limite por identificador (e-mail/usuário) — a chave "apertada". */
  maxAttempts: number;
  /**
   * Limite por IP. Deve ser mais folgado que `maxAttempts`: redes NAT (o Wi-Fi
   * da loja, uma empresa) compartilham um IP entre muitos usuários legítimos.
   * Se omitido, usa `maxAttempts`.
   */
  maxAttemptsPerIp?: number;
  windowSeconds: number;
  /** Campo do body usado como segunda chave (e-mail/identifier); opcional. */
  identifierField?: string;
  message: string;
  code: string;
}

/**
 * Fábrica de rate limiter para rotas sensíveis de autenticação. Duas chaves
 * independentes: por IP (`trustProxy` já limita forja de X-Forwarded-For) e,
 * quando houver, por identificador vindo do BODY (e-mail/usuário) — um IP
 * fabricado sozinho não basta para burlar o limite. Fail-open com warn se o
 * Redis cair (disponibilidade > limite), como já era no login.
 */
function createAuthRateLimiter(opts: AuthRateLimitOptions) {
  return async function authRateLimiter(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    try {
      const redis = await getRedisClient();
      const keys: Array<{ key: string; max: number }> = [
        { key: `ratelimit:${opts.scope}:${request.ip}`, max: opts.maxAttemptsPerIp ?? opts.maxAttempts },
      ];
      if (opts.identifierField) {
        const identifier = extractBodyIdentifier(request.body, opts.identifierField);
        if (identifier) keys.push({ key: `ratelimit:${opts.scope}:identifier:${identifier}`, max: opts.maxAttempts });
      }
      for (const { key, max } of keys) {
        const current = await redis.incr(key);
        if (current === 1) await redis.expire(key, opts.windowSeconds);
        if (current > max) {
          const ttl = await redis.ttl(key);
          throw new AppError(
            `${opts.message} Tente novamente em ${Math.max(1, Math.ceil(ttl / 60))} minuto(s).`,
            429,
            opts.code,
          );
        }
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      request.log.warn({ err, scope: opts.scope }, 'Rate limiter de autenticação indisponível — requisição liberada sem limite');
    }
  };
}

const loginRateLimiter = createAuthRateLimiter({
  scope: 'login',
  maxAttempts: LOGIN_MAX_ATTEMPTS,
  // Por IP mais folgado: 5 erros derrubariam o Wi-Fi inteiro da loja.
  maxAttemptsPerIp: LOGIN_MAX_ATTEMPTS * 4,
  windowSeconds: LOGIN_WINDOW_SECONDS,
  identifierField: 'identifier',
  message: 'Muitas tentativas de login.',
  code: 'LOGIN_RATE_LIMITED',
});

// Recuperação de senha: 5 pedidos por e-mail/IP a cada 15 min —
// evita spam de e-mail e enumeração por tempo de resposta.
const forgotPasswordRateLimiter = createAuthRateLimiter({
  scope: 'forgot-password',
  maxAttempts: 5,
  maxAttemptsPerIp: 20,
  windowSeconds: 15 * 60,
  identifierField: 'email',
  message: 'Muitos pedidos de recuperação de senha.',
  code: 'FORGOT_PASSWORD_RATE_LIMITED',
});

// Reset: o token é UUID hasheado (força bruta impraticável), mas limitar
// tentativas por IP fecha qualquer varredura.
const resetPasswordRateLimiter = createAuthRateLimiter({
  scope: 'reset-password',
  maxAttempts: 20,
  windowSeconds: 15 * 60,
  message: 'Muitas tentativas de redefinição de senha.',
  code: 'RESET_PASSWORD_RATE_LIMITED',
});

// Cadastro: contra criação em massa de contas (bots). 20 por IP / hora.
const registerRateLimiter = createAuthRateLimiter({
  scope: 'register',
  maxAttempts: 20,
  windowSeconds: 60 * 60,
  message: 'Muitas tentativas de cadastro.',
  code: 'REGISTER_RATE_LIMITED',
});

// Refresh: um cliente legítimo renova ~1x a cada 15 min; 300/15min por IP
// comporta um NAT com dezenas de usuários e ainda barra abuso.
const refreshRateLimiter = createAuthRateLimiter({
  scope: 'refresh',
  maxAttempts: 300,
  windowSeconds: 15 * 60,
  message: 'Muitas renovações de sessão.',
  code: 'REFRESH_RATE_LIMITED',
});

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post('/register', {
    preHandler: [registerRateLimiter, validateBody(registerSchema)],
    handler: registerHandler,
  });

  fastify.post('/login', {
    preHandler: [loginRateLimiter, validateBody(loginSchema)],
    handler: loginHandler,
  });

  fastify.post('/refresh', {
    preHandler: [refreshRateLimiter],
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
    preHandler: [forgotPasswordRateLimiter, validateBody(forgotPasswordSchema)],
    handler: forgotPasswordHandler,
  });

  fastify.post('/reset-password', {
    preHandler: [resetPasswordRateLimiter, validateBody(resetPasswordSchema)],
    handler: resetPasswordHandler,
  });
}
