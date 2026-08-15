import type { FastifyRequest, FastifyReply } from 'fastify';
import { verifyAccessToken, type AccessTokenPayload } from '../utils/jwt.js';
import { ForbiddenError, UnauthorizedError } from '../../domain/errors/app-error.js';
import { isUserAccessRevoked } from '../../infra/cache/auth-revocation.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser?: AccessTokenPayload;
  }
}

export async function authGuard(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  const authHeader = request.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new UnauthorizedError('Missing or invalid Authorization header');
  }

  const token = authHeader.slice(7);
  const payload = verifyAccessToken(token);

  // Revogação imediata: usuário desativado/excluído não pode continuar
  // usando um access token já emitido até ele expirar sozinho. Falha aberta
  // se o Redis estiver fora do ar (ver `isUserAccessRevoked`) — disponibilidade
  // da API não pode depender do cache de revogação.
  if (await isUserAccessRevoked(payload.sub)) {
    throw new UnauthorizedError('Session revoked');
  }

  request.currentUser = payload;
}

export function requireRole(...roles: Array<'CUSTOMER' | 'ADMIN'>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    if (!request.currentUser) {
      throw new UnauthorizedError('Authentication required');
    }

    if (!roles.includes(request.currentUser.role)) {
      throw new ForbiddenError(`Required role: ${roles.join(' or ')}`);
    }
  };
}
