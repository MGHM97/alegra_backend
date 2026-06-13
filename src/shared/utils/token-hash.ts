import crypto from 'node:crypto';

/**
 * Hash determinístico (SHA-256) para tokens de uso único/sessão guardados no DB.
 *
 * Usado para refresh tokens e tokens de reset de senha: armazenamos apenas o
 * hash, nunca o token em texto puro. Assim, um vazamento do banco de dados não
 * expõe credenciais utilizáveis — o atacante teria apenas o digest.
 *
 * SHA-256 (e não bcrypt) é adequado aqui porque o token de entrada já é de alta
 * entropia (JWT assinado / UUID + random), dispensando key-stretching, e a busca
 * por igualdade precisa ser indexável no banco.
 */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
