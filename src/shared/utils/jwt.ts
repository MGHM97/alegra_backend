import jwt from 'jsonwebtoken';
import { env } from '../../infra/config/env.js';
import { UnauthorizedError } from '../../domain/errors/app-error.js';

export interface AccessTokenPayload {
  sub: string;
  email: string;
  role: 'CUSTOMER' | 'ADMIN';
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
}

const ISSUER = 'alegra-festas';
const AUDIENCE = 'alegra-festas-api';

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as unknown as number,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, {
    expiresIn: env.REFRESH_EXPIRES_IN as unknown as number,
    issuer: ISSUER,
    audience: AUDIENCE,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof decoded === 'string') {
      throw new UnauthorizedError('Invalid token format');
    }

    return decoded as unknown as AccessTokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired access token');
  }
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  try {
    const decoded = jwt.verify(token, env.JWT_REFRESH_SECRET, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof decoded === 'string') {
      throw new UnauthorizedError('Invalid token format');
    }

    return decoded as unknown as RefreshTokenPayload;
  } catch {
    throw new UnauthorizedError('Invalid or expired refresh token');
  }
}
