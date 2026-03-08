import { createClient, type RedisClientType } from 'redis';
import { env } from '../config/env.js';

let redisClient: RedisClientType | null = null;

export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  redisClient = createClient({
    url: env.REDIS_URL,
    socket: {
      reconnectStrategy(retries: number) {
        if (retries > 10) {
          return new Error('Redis: max reconnection attempts exceeded');
        }
        return Math.min(retries * 100, 3000);
      },
    },
  });

  redisClient.on('error', (err: Error) => {
    console.error('[Redis] Connection error:', err.message);
  });

  await redisClient.connect();
  return redisClient;
}

export async function disconnectRedis(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.disconnect();
    redisClient = null;
  }
}
