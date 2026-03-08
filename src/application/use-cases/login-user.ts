import { randomUUID } from 'node:crypto';
import type { UserRepository } from '../../domain/repositories/user-repository.js';
import { UnauthorizedError } from '../../domain/errors/app-error.js';
import { verifyPassword } from '../../shared/utils/password.js';
import { signAccessToken, signRefreshToken } from '../../shared/utils/jwt.js';
import { prisma } from '../../infra/database/prisma-client.js';
import type { LoginInput } from '../../presentation/schemas/auth-schemas.js';

interface LoginResult {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string;
    username: string;
    name: string;
    role: 'CUSTOMER' | 'ADMIN';
  };
}

export class LoginUserUseCase {
  constructor(private readonly userRepository: UserRepository) {}

  async execute(input: LoginInput): Promise<LoginResult> {
    const isEmail = input.identifier.includes('@');

    const user = isEmail
      ? await this.userRepository.findByEmail(input.identifier)
      : await this.userRepository.findByUsername(input.identifier);

    if (!user || !user.isActive) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const isValid = await verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedError('Invalid credentials');
    }

    const accessToken = signAccessToken({
      sub: user.id,
      email: user.email,
      role: user.role,
    });

    const tokenId = randomUUID();
    const refreshTokenStr = signRefreshToken({
      sub: user.id,
      tokenId,
    });

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await prisma.refreshToken.create({
      data: {
        id: tokenId,
        token: refreshTokenStr,
        userId: user.id,
        expiresAt,
      },
    });

    return {
      accessToken,
      refreshToken: refreshTokenStr,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
      },
    };
  }
}
