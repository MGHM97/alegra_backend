import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { PrismaUserRepository } from '../../infra/database/prisma-user-repository.js';
import { hashPassword } from '../../shared/utils/password.js';
import { hashToken } from '../../shared/utils/token-hash.js';
import { successResponse } from '../../shared/utils/response.js';
import { NotFoundError, ValidationError } from '../../domain/errors/app-error.js';
import type { ForgotPasswordInput, ResetPasswordInput } from '../schemas/password-reset-schemas.js';
import { EmailService } from '../../application/services/email-service.js';
import { env } from '../../infra/config/env.js';
import { logger } from '../../shared/utils/logger.js';

const userRepository = new PrismaUserRepository();
const emailService = new EmailService();

export async function forgotPasswordHandler(
  request: FastifyRequest<{ Body: ForgotPasswordInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { email } = request.body;

  const user = await userRepository.findByEmail(email);

  // Always return success to prevent email enumeration
  if (!user) {
    void reply
      .status(200)
      .send(successResponse({ message: 'Se o e-mail estiver cadastrado, você receberá as instruções de recuperação.' }));
    return;
  }

  // Invalidate previous unused tokens
  await prisma.passwordResetToken.updateMany({
    where: { userId: user.id, usedAt: null },
    data: { usedAt: new Date() },
  });

  // Generate plain token (sent to user) and hash (stored in DB)
  const plainToken = crypto.randomUUID();
  const tokenHash = hashToken(plainToken);

  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour
    },
  });

  // CORS_ORIGIN pode conter múltiplas origens separadas por vírgula; a
  // primeira é a origem canônica do frontend usada para montar o link.
  const frontendOrigin = (env.CORS_ORIGIN.split(',')[0] ?? env.CORS_ORIGIN).trim();
  const resetUrl = `${frontendOrigin}/reset-password?token=${plainToken}`;

  // Best-effort: uma falha transitória de SMTP (credencial errada, timeout,
  // provedor fora do ar) não pode derrubar a request com 500 — o token já
  // está salvo no banco e continua válido por 1h, então o usuário pode
  // tentar "esqueci minha senha" de novo sem qualquer efeito colateral.
  // Também mantém a resposta idêntica ao caminho "e-mail não cadastrado"
  // acima, sem vazar se o envio falhou por causa de uma conta específica.
  try {
    await emailService.sendPasswordReset(email, user.name, resetUrl);
  } catch (err) {
    logger.warn({ err, userId: user.id }, 'Falha ao enviar e-mail de recuperação de senha (SMTP)');
  }

  void reply
    .status(200)
    .send(successResponse({ message: 'Se o e-mail estiver cadastrado, voce recebera as instrucoes de recuperacao.' }));
}

export async function resetPasswordHandler(
  request: FastifyRequest<{ Body: ResetPasswordInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { token, password } = request.body;

  const tokenHash = hashToken(token);

  const resetRecord = await prisma.passwordResetToken.findFirst({
    where: {
      tokenHash,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });

  if (!resetRecord) {
    throw new NotFoundError('Token de recuperação inválido ou expirado');
  }

  const user = await userRepository.findById(resetRecord.userId);
  if (!user) {
    throw new NotFoundError('Usuário não encontrado');
  }

  if (!user.isActive) {
    throw new ValidationError('Conta desativada. Entre em contato com o suporte.');
  }

  const newHash = await hashPassword(password);

  await prisma.$transaction(async (tx) => {
    // Update password
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash },
    });

    // Mark token as used
    await tx.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    });

    // Revoke all refresh tokens for this user
    await tx.refreshToken.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  });

  void reply
    .status(200)
    .send(successResponse({ message: 'Senha alterada com sucesso. Faça login com sua nova senha.' }));
}
