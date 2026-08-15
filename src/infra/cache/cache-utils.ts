import { getRedisClient } from './redis-client.js';
import { logger } from '../../shared/utils/logger.js';

export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const redis = await getRedisClient();
    const cached = await redis.get(key);
    if (cached) {
      return JSON.parse(cached) as T;
    }
  } catch {
    // Redis down — skip cache
  }
  return null;
}

export async function cacheSet(key: string, value: unknown, ttlSeconds: number): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
  } catch {
    // Redis down — skip cache
  }
}

export async function cacheDelete(key: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.del(key);
  } catch (err) {
    logger.warn({ err, key }, 'Falha ao remover chave do cache — Redis indisponível');
  }
}

/**
 * Checagem best-effort de existência de chave. Usada em caminhos de
 * segurança (ex.: revogação de sessão no authGuard) onde uma falha de Redis
 * NUNCA pode bloquear a requisição — por isso falha aberta (retorna `false`)
 * e apenas registra o incidente, na mesma filosofia do rate limiter de login.
 */
export async function cacheExists(key: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    const exists = await redis.exists(key);
    return exists === 1;
  } catch (err) {
    logger.warn({ err, key }, 'Falha ao checar chave no cache — Redis indisponível, liberando');
    return false;
  }
}

export async function cacheInvalidatePattern(pattern: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys(pattern);
    if (keys.length > 0) {
      await redis.del(keys);
    }
  } catch (err) {
    // Redis fora do ar não pode derrubar a operação que disparou a
    // invalidação (pedido, confirmação de pagamento, etc.) — mas o cache
    // pode ficar servindo estoque desatualizado até o TTL expirar, então o
    // incidente precisa ficar visível nos logs.
    logger.warn({ err, pattern }, 'Falha ao invalidar cache — Redis indisponível');
  }
}
