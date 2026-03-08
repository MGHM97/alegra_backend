import 'dotenv/config';
import { buildApp } from './app.js';
import { env } from './infra/config/env.js';
import { prisma } from './infra/database/prisma-client.js';
import { disconnectRedis } from './infra/cache/redis-client.js';

async function start(): Promise<void> {
  const app = await buildApp();

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}. Shutting down gracefully...`);
    await app.close();
    await prisma.$disconnect();
    await disconnectRedis();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: env.PORT, host: '0.0.0.0' });
    app.log.info(`Server running on http://0.0.0.0:${env.PORT}`);
    app.log.info(`Environment: ${env.NODE_ENV}`);
  } catch (err) {
    app.log.error(err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

void start();
