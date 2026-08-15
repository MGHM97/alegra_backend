import { randomUUID } from 'node:crypto';
import { UnauthorizedError } from '../../domain/errors/app-error.js';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '../../shared/utils/jwt.js';
import { hashToken } from '../../shared/utils/token-hash.js';
import { prisma } from '../../infra/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';

interface RefreshResult {
  accessToken: string;
  refreshToken: string;
}

export class RefreshTokenUseCase {
  async execute(currentRefreshToken: string): Promise<RefreshResult> {
    const payload = verifyRefreshToken(currentRefreshToken);

    const storedToken = await prisma.refreshToken.findUnique({
      where: { id: payload.tokenId },
      include: { user: true },
    });

    if (!storedToken) {
      throw new UnauthorizedError('Refresh token has been revoked');
    }

    // Reuso de refresh token já revogado: ou o token vazou e o atacante
    // rotacionou primeiro, ou o dono legítimo está reusando um token velho
    // após a rotação. Em ambos os casos, a família inteira de refresh
    // tokens do usuário deixa de ser confiável — revoga tudo que ainda
    // estiver ativo para derrubar a sessão de quem quer que tenha o token
    // roubado, e loga o incidente (nunca o valor do token).
    if (storedToken.revokedAt) {
      await this.revokeAllForUser(storedToken.userId);
      logger.warn(
        { userId: storedToken.userId },
        'Reuso de refresh token revogado detectado — todas as sessões do usuário foram revogadas',
      );
      throw new UnauthorizedError('Refresh token has been revoked');
    }

    // Liga a linha do DB ao token efetivamente apresentado. O lookup acima é
    // por tokenId (claim do JWT); sem esta checagem, um token com tokenId
    // válido mas corpo divergente passaria. Comparamos hashes (constante por
    // SHA-256, valores de tamanho fixo) — o texto puro nunca toca o banco.
    if (storedToken.tokenHash !== hashToken(currentRefreshToken)) {
      throw new UnauthorizedError('Refresh token mismatch');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedError('Refresh token has expired');
    }

    if (!storedToken.user.isActive) {
      throw new UnauthorizedError('User account is inactive');
    }

    await prisma.refreshToken.update({
      where: { id: payload.tokenId },
      data: { revokedAt: new Date() },
    });

    const newTokenId = randomUUID();
    const accessToken = signAccessToken({
      sub: storedToken.user.id,
      email: storedToken.user.email,
      role: storedToken.user.role,
    });

    const refreshToken = signRefreshToken({
      sub: storedToken.user.id,
      tokenId: newTokenId,
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        id: newTokenId,
        tokenHash: hashToken(refreshToken),
        userId: storedToken.user.id,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * Revoga todos os refresh tokens ainda ativos de um usuário. Usado na
   * detecção de reuso de token (ver `execute`) para invalidar a família
   * inteira de tokens assim que um token já revogado é reapresentado.
   */
  private async revokeAllForUser(userId: string): Promise<void> {
    await prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
