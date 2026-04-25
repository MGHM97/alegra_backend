import crypto from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { PrismaUserRepository } from '../../infra/database/prisma-user-repository.js';
import { hashPassword } from '../../shared/utils/password.js';
import { successResponse } from '../../shared/utils/response.js';
import { NotFoundError, ValidationError } from '../../domain/errors/app-error.js';
import type { ForgotPasswordInput, ResetPasswordInput } from '../schemas/password-reset-schemas.js';
import { EmailService } from '../../application/services/email-service.js';

const userRepository = new PrismaUserRepository();
const emailService = new EmailService();

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

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
      .send(successResponse({ message: 'Se o e-mail estiver cadastrado, voce recebera as instrucoes de recuperacao.' }));
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

  const resetUrl = `${process.env.CORS_ORIGIN ?? 'http://localhost:5173'}/reset-password?token=${plainToken}`;

  await emailService.sendPasswordReset(email, user.name, resetUrl);

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
    throw new NotFoundError('Token de recuperacao invalido ou expirado');
  }

  const user = await userRepository.findById(resetRecord.userId);
  if (!user) {
    throw new NotFoundError('Usuario nao encontrado');
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
    .send(successResponse({ message: 'Senha alterada com sucesso. Faca login com sua nova senha.' }));
}
