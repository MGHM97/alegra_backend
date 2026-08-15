import { randomUUID, randomBytes } from 'node:crypto';
import { prisma } from '../../infra/database/prisma-client.js';
import { hashPassword, verifyPassword } from '../../shared/utils/password.js';
import {
  AccountAlreadyDeletedError,
  InvalidPasswordError,
  UnauthorizedError,
} from '../../domain/errors/app-error.js';
import { logger } from '../../shared/utils/logger.js';
import { revokeUserAccess } from '../../infra/cache/auth-revocation.js';

/**
 * Use case: Soft Delete Anônimo de Conta (Direito ao Esquecimento — LGPD).
 *
 * REGRAS CRÍTICAS:
 *  - Orders NUNCA são apagados (histórico fiscal/financeiro obrigatório).
 *  - Reviews são MANTIDAS (denormalização preserva valor para outros
 *    compradores; o nome exibido continua sendo o `userName` salvo na
 *    review no momento da criação — não muda automaticamente).
 *  - Todos os outros dados pessoais são removidos:
 *      WishlistItem, Address, SavedCard, RefreshToken, PasswordResetToken.
 *  - User é anonimizado (nome/email/phone trocados, senha invalidada,
 *    `isActive=false`, `deletedAt=now()`).
 *
 * Por que anonimizar o e-mail (em vez de só desativar)?
 *  - Libera o e-mail original para um futuro recadastro do mesmo usuário,
 *    sem violar a unicidade da coluna `email` no Postgres. O e-mail
 *    anonimizado usa o domínio `@anonymized.local` e um UUID para
 *    garantir unicidade absoluta.
 *
 * Por que substituir a senha por um hash de bytes aleatórios?
 *  - Garante que `verifyPassword(input.password, user.passwordHash)`
 *    retorne `false` para qualquer entrada conhecida do usuário, mesmo
 *    que `isActive=false` seja contornado por bug futuro. Defesa em
 *    profundidade.
 *
 * Toda a operação é executada em uma transação Prisma para atomicidade —
 * ou tudo é deletado/anonimizado, ou nada muda.
 */
export class DeleteAccountUseCase {
  async execute(userId: string, plainPassword: string): Promise<void> {
    const user = await prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedError('Usuário não encontrado.');
    }

    if (!user.isActive || user.deletedAt !== null) {
      throw new AccountAlreadyDeletedError();
    }

    const isValid = await verifyPassword(plainPassword, user.passwordHash);
    if (!isValid) {
      throw new InvalidPasswordError();
    }

    const anonymizedEmail = `deleted-${randomUUID()}@anonymized.local`;
    const anonymizedUsername = `deleted_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
    const invalidatedPassword = await hashPassword(
      randomBytes(48).toString('hex'),
    );
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // 1) Revoga todos os refresh tokens (invalida sessões existentes
      // imediatamente). Usamos delete em vez de update porque o usuário
      // não tem mais necessidade desses registros — não há recuperação.
      await tx.refreshToken.deleteMany({ where: { userId } });

      // 2) Apaga password reset tokens pendentes
      await tx.passwordResetToken.deleteMany({ where: { userId } });

      // 3) Apaga lista de favoritos (dado pessoal sem valor histórico)
      await tx.wishlistItem.deleteMany({ where: { userId } });

      // 4) Apaga endereços salvos (dado pessoal — endereços de pedidos
      // antigos permanecem denormalizados na tabela `orders`)
      await tx.address.deleteMany({ where: { userId } });

      // 5) Apaga cartões salvos (dado pessoal sensível)
      await tx.savedCard.deleteMany({ where: { userId } });

      // 6) Reviews: NÃO deletar. Permanecem com a FK userId apontando
      // para o user agora anônimo. O campo `userName` da review já é
      // denormalizado e foi salvo no momento da criação — preserva a
      // informação histórica para outros compradores.

      // 7) Orders: NUNCA tocar. Histórico fiscal/financeiro intocável.

      // 8) Anonimiza o User (mantém o registro para preservar a FK dos
      // Orders e Reviews históricas, mas todos os dados pessoais são
      // substituídos por valores neutros)
      await tx.user.update({
        where: { id: userId },
        data: {
          email: anonymizedEmail,
          username: anonymizedUsername,
          name: 'Usuário Excluído',
          phone: null,
          passwordHash: invalidatedPassword,
          isActive: false,
          deletedAt: now,
        },
      });
    });

    // Revoga imediatamente qualquer access token já emitido para esta conta
    // (ver `auth-revocation.ts`) — best-effort, fora da transação Postgres,
    // pois o Redis não participa do ACID daquela transação.
    await revokeUserAccess(userId);

    // Log de auditoria LGPD — mantemos o userId original para rastreio
    // de conformidade (ex.: em caso de auditoria do encarregado de dados)
    logger.info(
      { event: 'user_deleted', userId, deletedAt: now.toISOString() },
      'User account anonymized via LGPD right-to-be-forgotten',
    );
  }
}
