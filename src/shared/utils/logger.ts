import pino from 'pino';
import { env } from '../../infra/config/env.js';

export const logger = pino({
  level: env.NODE_ENV === 'production' ? 'warn' : 'info',
  transport:
    env.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});
