import { prisma } from '../../infra/database/prisma-client.js';

export type SubscribeNewsletterStatus =
  | 'subscribed'      // criado novo registro
  | 'reactivated'     // existia inativo, reativado
  | 'alreadySubscribed'; // existia ativo, noop

export interface SubscribeNewsletterResult {
  status: SubscribeNewsletterStatus;
  email: string;
}

/**
 * Use case: Inscrever e-mail na newsletter.
 *
 * Idempotente por design: se o e-mail já existe, não retorna erro 409 —
 * apenas indica via `status` se foi criado, reativado ou já existia ativo.
 * Decisão UX: o usuário não sabe diferenciar entre os estados, então a
 * mensagem retornada não vaza informação sobre quem já está inscrito
 * (defesa contra enumeration attacks de e-mails cadastrados).
 *
 * Double opt-in (envio de e-mail de confirmação) NÃO é implementado nesta
 * entrega — apenas persistência do e-mail. Será adicionado em missão
 * futura, junto da integração com provedor de envio em massa.
 */
export class SubscribeNewsletterUseCase {
  async execute(email: string): Promise<SubscribeNewsletterResult> {
    const existing = await prisma.newsletterSubscriber.findUnique({
      where: { email },
    });

    if (existing) {
      if (existing.isActive) {
        return { status: 'alreadySubscribed', email };
      }
      // existia mas estava inativo — reativa
      await prisma.newsletterSubscriber.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
      return { status: 'reactivated', email };
    }

    await prisma.newsletterSubscriber.create({
      data: { email, isActive: true },
    });
    return { status: 'subscribed', email };
  }
}
