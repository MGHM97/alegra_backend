import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError } from '../../domain/errors/app-error.js';
import { errorResponse } from '../utils/response.js';
import { logger } from '../utils/logger.js';

export function globalErrorHandler(
  error: FastifyError,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  if (error instanceof ZodError) {
    const issues = error.issues as Array<{ path: Array<string | number>; message: string }>;
    const messages = issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
    void reply.status(422).send(errorResponse(messages, 'VALIDATION_ERROR'));
    return;
  }

  if (error instanceof AppError) {
    void reply.status(error.statusCode).send(errorResponse(error.message, error.code));
    return;
  }

  if (error.validation) {
    void reply.status(422).send(errorResponse(error.message, 'VALIDATION_ERROR'));
    return;
  }

  if (error.statusCode === 429) {
    void reply.status(429).send(errorResponse('Too many requests', 'RATE_LIMIT_EXCEEDED'));
    return;
  }

  logger.error({ err: error, code: error.code }, 'Unhandled error');

  void reply.status(500).send(
    errorResponse('Internal server error', 'INTERNAL_ERROR'),
  );
}
