import 'dotenv/config';
import { createClient } from 'redis';
(async () => {
  const r = createClient({ url: process.env.REDIS_URL });
  await r.connect();
  const keys = await r.keys('ratelimit:*');
  if (keys.length) await r.del(keys);
  console.log('rate-limit keys removidas:', keys.length, keys);
  await r.quit();
})();
