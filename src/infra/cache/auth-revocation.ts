import ms from 'ms';
import { env } from '../config/env.js';
import { cacheDelete, cacheExists, cacheSet } from './cache-utils.js';

const REVOKED_KEY_PREFIX = 'auth:revoked:';

/**
 * TTL da flag de revogação = tempo restante máximo de vida de um access
 * token (`JWT_EXPIRES_IN`). Não faz sentido manter a chave além disso: um
 * token emitido no instante exato da desativação já terá expirado sozinho
 * quando o TTL zerar, então o Redis pode esquecer a revogação sem reabrir
 * brecha nenhuma.
 */
function accessTokenTtlSeconds(): number {
  const ttlMs = ms(env.JWT_EXPIRES_IN as ms.StringValue);
  return Math.max(1, Math.ceil(ttlMs / 1000));
}

/**
 * Marca todos os access tokens já emitidos para `userId` como inválidos a
 * partir de agora. Chamado ao desativar (`isActive: false`) ou
 * excluir/anonimizar uma conta — sem isso, um token emitido antes da
 * desativação continuaria válido até expirar sozinho (até `JWT_EXPIRES_IN`).
 */
export async function revokeUserAccess(userId: string): Promise<void> {
  await cacheSet(`${REVOKED_KEY_PREFIX}${userId}`, true, accessTokenTtlSeconds());
}

/** Remove a revogação — chamado ao reativar um usuário. */
export async function clearUserAccessRevocation(userId: string): Promise<void> {
  await cacheDelete(`${REVOKED_KEY_PREFIX}${userId}`);
}

/**
 * Best-effort: se o Redis estiver fora do ar, `cacheExists` já loga o
 * incidente e retorna `false` (falha aberta) — não é o `authGuard` quem
 * decide isso.
 */
export async function isUserAccessRevoked(userId: string): Promise<boolean> {
  return cacheExists(`${REVOKED_KEY_PREFIX}${userId}`);
}
