import { randomUUID } from 'node:crypto';
import { UnauthorizedError } from '../../domain/errors/app-error.js';
import { verifyRefreshToken, signAccessToken, signRefreshToken } from '../../shared/utils/jwt.js';
import { prisma } from '../../infra/database/prisma-client.js';

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

    if (!storedToken || storedToken.revokedAt) {
      throw new UnauthorizedError('Refresh token has been revoked');
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
        token: refreshToken,
        userId: storedToken.user.id,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }
}
