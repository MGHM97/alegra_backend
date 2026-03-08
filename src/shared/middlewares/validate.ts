import type { FastifyRequest, FastifyReply } from 'fastify';
import type { z } from 'zod';
import { sanitizeObject } from '../utils/sanitize.js';

export function validateBody<T>(schema: z.ZodType<T>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const sanitized = sanitizeObject(request.body);
    const parsed = schema.parse(sanitized) as T;
    (request.body as T) = parsed;
  };
}

export function validateQuery<T>(schema: z.ZodType<T>) {
  return async (request: FastifyRequest, _reply: FastifyReply): Promise<void> => {
    const sanitized = sanitizeObject(request.query);
    const parsed = schema.parse(sanitized) as T;
    (request.query as T) = parsed;
  };
}
