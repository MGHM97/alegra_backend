import { prisma } from '../../infra/database/prisma-client.js';
import { logger } from '../../shared/utils/logger.js';
import { EmailService } from './email-service.js';

const REVIEW_REMINDER_DELAY_MS = 3 * 24 * 60 * 60 * 1000; // 3 dias após a entrega

export interface ReviewReminderCandidate {
  orderId: string;
  userId: string;
  userEmail: string;
  userName: string;
}

/**
 * Seleciona pedidos elegíveis para o lembrete de avaliação pós-entrega:
 * - status DELIVERED há pelo menos 3 dias (deliveredAt <= now - 3d);
 * - reviewReminderSentAt ainda não foi marcado (nunca lembrado antes);
 * - o usuário dono do pedido ainda não avaliou NENHUM produto do pedido
 *   (Review não tem orderId — a checagem é por userId + productId dos itens).
 *
 * Exportada separadamente de `ReviewReminderService.run()` para ser testável
 * sem depender de envio de e-mail (ver tests/review-reminder.test.ts).
 */
export async function selectOrdersForReviewReminder(
  now: Date = new Date(),
): Promise<ReviewReminderCandidate[]> {
  const cutoff = new Date(now.getTime() - REVIEW_REMINDER_DELAY_MS);

  const candidateOrders = await prisma.order.findMany({
    where: {
      status: 'DELIVERED',
      deliveredAt: { lte: cutoff },
      reviewReminderSentAt: null,
    },
    select: {
      id: true,
      userId: true,
      user: { select: { email: true, name: true } },
      items: { select: { productId: true } },
    },
  });

  const candidates: ReviewReminderCandidate[] = [];

  for (const order of candidateOrders) {
    const productIds = [...new Set(order.items.map((item) => item.productId))];
    if (productIds.length === 0) continue;

    const reviewedCount = await prisma.review.count({
      where: { userId: order.userId, productId: { in: productIds } },
    });

    if (reviewedCount === 0) {
      candidates.push({
        orderId: order.id,
        userId: order.userId,
        userEmail: order.user.email,
        userName: order.user.name,
      });
    }
  }

  return candidates;
}

export class ReviewReminderService {
  private readonly emailService = new EmailService();

  /**
   * Envia o lembrete para cada pedido elegível e só marca
   * `reviewReminderSentAt` após o e-mail sair com sucesso — best-effort:
   * falha de e-mail apenas loga warn e o pedido continua elegível no
   * próximo ciclo (nunca fica "perdido").
   */
  async run(now: Date = new Date()): Promise<{ sent: number; failed: number }> {
    const candidates = await selectOrdersForReviewReminder(now);

    let sent = 0;
    let failed = 0;

    for (const candidate of candidates) {
      try {
        await this.emailService.sendReviewReminder(
          candidate.userEmail,
          candidate.userName,
          candidate.orderId,
        );
        await prisma.order.update({
          where: { id: candidate.orderId },
          data: { reviewReminderSentAt: new Date() },
        });
        sent += 1;
      } catch (err) {
        failed += 1;
        logger.warn(
          { err, orderId: candidate.orderId },
          'Falha ao enviar lembrete de avaliação — tentando novamente no próximo ciclo',
        );
      }
    }

    return { sent, failed };
  }
}
