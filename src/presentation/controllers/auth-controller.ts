import type { FastifyReply, FastifyRequest } from 'fastify';
import { RegisterUserUseCase } from '../../application/use-cases/register-user.js';
import { LoginUserUseCase } from '../../application/use-cases/login-user.js';
import { RefreshTokenUseCase } from '../../application/use-cases/refresh-token.js';
import { PrismaUserRepository } from '../../infra/database/prisma-user-repository.js';
import type { RegisterInput, LoginInput } from '../schemas/auth-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { UnauthorizedError } from '../../domain/errors/app-error.js';
import { env } from '../../infra/config/env.js';

const userRepository = new PrismaUserRepository();
const registerUseCase = new RegisterUserUseCase(userRepository);
const loginUseCase = new LoginUserUseCase(userRepository);
const refreshUseCase = new RefreshTokenUseCase();

const REFRESH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/v1/auth/refresh',
  maxAge: 7 * 24 * 60 * 60, // 7 days in seconds
};

export async function registerHandler(
  request: FastifyRequest<{ Body: RegisterInput }>,
  reply: FastifyReply,
): Promise<void> {
  const user = await registerUseCase.execute(request.body);
  void reply.status(201).send(successResponse(user));
}

export async function loginHandler(
  request: FastifyRequest<{ Body: LoginInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await loginUseCase.execute(request.body);

  void reply.setCookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

  void reply.status(200).send(
    successResponse({
      accessToken: result.accessToken,
      user: result.user,
    }),
  );
}

export async function refreshHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const refreshToken =
    (request.cookies as Record<string, string | undefined>)['refreshToken'];

  if (!refreshToken) {
    throw new UnauthorizedError('Refresh token not found');
  }

  const result = await refreshUseCase.execute(refreshToken);

  void reply.setCookie('refreshToken', result.refreshToken, REFRESH_COOKIE_OPTIONS);

  void reply.status(200).send(
    successResponse({ accessToken: result.accessToken }),
  );
}

export async function logoutHandler(
  _request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  void reply.clearCookie('refreshToken', { path: '/v1/auth/refresh' });
  void reply.status(200).send(successResponse({ message: 'Logged out successfully' }));
}

export async function meHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const user = await userRepository.findById(currentUser.sub);
  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  void reply.status(200).send(
    successResponse({
      id: user.id,
      email: user.email,
      username: user.username,
      name: user.name,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    }),
  );
}
