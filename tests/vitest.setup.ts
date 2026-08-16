import { beforeAll } from 'vitest';
import { getRedisClient } from '../src/infra/cache/redis-client.js';

/**
 * Antes de CADA arquivo de teste, zera as chaves de rate limit de auth
 * (`ratelimit:*`). Os testes de integração compartilham o mesmo Redis e o
 * mesmo IP (127.0.0.1); sem isto, o limiter de /register (20/h por IP) e os
 * demais barram os `beforeAll` que criam usuários — o limiter estaria certo,
 * mas o teste erraria pelo motivo errado. Testes que verificam o próprio rate
 * limit continuam válidos: eles esgotam a cota dentro do próprio arquivo.
 */
beforeAll(async () => {
  try {
    const redis = await getRedisClient();
    let cursor = '0';
    do {
      const res = await redis.scan(cursor, { MATCH: 'ratelimit:*', COUNT: 200 });
      cursor = String(res.cursor);
      if (res.keys.length > 0) await redis.del(res.keys);
    } while (cursor !== '0');
  } catch {
    // Redis indisponível: os limiters já são fail-open, nada a fazer.
  }
});
