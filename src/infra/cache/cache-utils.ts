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
