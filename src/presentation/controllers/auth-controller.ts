import type { FastifyReply, FastifyRequest } from 'fastify';
import { RegisterUserUseCase } from '../../application/use-cases/register-user.js';
import { LoginUserUseCase } from '../../application/use-cases/login-user.js';
import { RefreshTokenUseCase } from '../../application/use-cases/refresh-token.js';
import { DeleteAccountUseCase } from '../../application/use-cases/delete-account.js';
import { PrismaUserRepository } from '../../infra/database/prisma-user-repository.js';
import type {
  RegisterInput,
  LoginInput,
  UpdateProfileInput,
  DeleteAccountInput,
} from '../schemas/auth-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { UnauthorizedError } from '../../domain/errors/app-error.js';
import { env } from '../../infra/config/env.js';
import { prisma } from '../../infra/database/prisma-client.js';
import { verifyRefreshToken } from '../../shared/utils/jwt.js';

const userRepository = new PrismaUserRepository();
const registerUseCase = new RegisterUserUseCase(userRepository);
const loginUseCase = new LoginUserUseCase(userRepository);
const refreshUseCase = new RefreshTokenUseCase();
const deleteAccountUseCase = new DeleteAccountUseCase();

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
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const refreshToken =
    (request.cookies as Record<string, string | undefined>)['refreshToken'];

  if (refreshToken) {
    try {
      const decoded = verifyRefreshToken(refreshToken);
      await prisma.refreshToken.updateMany({
        where: { userId: decoded.sub, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    } catch {
      // Token invalid or expired — still clear cookie
    }
  }

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
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt,
    }),
  );
}

export async function updateProfileHandler(
  request: FastifyRequest<{ Body: UpdateProfileInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const updated = await userRepository.updateProfile(currentUser.sub, request.body);

  void reply.status(200).send(
    successResponse({
      id: updated.id,
      email: updated.email,
      username: updated.username,
      name: updated.name,
      phone: updated.phone,
      role: updated.role,
      isActive: updated.isActive,
      createdAt: updated.createdAt,
    }),
  );
}

/**
 * DELETE /v1/auth/me — LGPD: Direito ao Esquecimento.
 *
 * Anonimiza a conta do usuário autenticado mediante confirmação de senha.
 * Toda a lógica está em DeleteAccountUseCase. Após o sucesso, este handler
 * limpa o cookie de refresh token (encerra a sessão imediatamente).
 *
 * Segurança em camadas:
 *   1) authGuard valida o JWT (autenticação)
 *   2) DeleteAccountUseCase re-verifica a senha (intenção)
 *   3) Refresh tokens são deletados na transação (sessão expira no momento)
 *   4) Cookie de refresh é limpo aqui (browser não envia mais)
 *
 * Resposta: 200 com `{ deleted: true }` — o frontend então faz logout local
 * (limpa Zustand) e redireciona.
 */
export async function deleteAccountHandler(
  request: FastifyRequest<{ Body: DeleteAccountInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  await deleteAccountUseCase.execute(currentUser.sub, request.body.password);

  void reply.clearCookie('refreshToken', { path: '/v1/auth/refresh' });

  void reply.status(200).send(
    successResponse({
      deleted: true,
      message: 'Conta excluída com sucesso.',
    }),
  );
}
