import { stripe } from '../../infra/config/stripe.js';
import { prisma } from '../../infra/database/prisma-client.js';
import { ForbiddenError, ValidationError } from '../../domain/errors/app-error.js';
import { logger } from '../../shared/utils/logger.js';
import type { CardBrand } from '../../domain/entities/saved-card.js';

// Tipos derivados diretamente dos métodos do SDK (mesmo padrão usado em
// payment-service.ts) em vez de `Stripe.SetupIntent`/`Stripe.PaymentMethod`:
// sob `module: Node16` sem `"type": "module"` no package.json, os .d.ts da
// stripe resolvidos para CJS não expõem esses tipos aninhados via import
// default, só a classe `Stripe` em si.
type StripeSetupIntent = Awaited<ReturnType<typeof stripe.setupIntents.create>>;
type StripePaymentMethod = Awaited<ReturnType<typeof stripe.paymentMethods.retrieve>>;

/**
 * Bandeiras aceitas pelo checkout. Qualquer bandeira fora deste mapa é
 * rejeitada (422) — nunca persistimos uma bandeira que o restante do sistema
 * (serialização, filtros de admin, etc.) não reconhece.
 */
const STRIPE_BRAND_MAP: Record<string, CardBrand> = {
  visa: 'VISA',
  mastercard: 'MASTERCARD',
  amex: 'AMEX',
  elo: 'ELO',
  hipercard: 'HIPERCARD',
};

export interface StripeCardDetails {
  stripePaymentMethodId: string;
  lastFourDigits: string;
  brand: CardBrand;
  expiryMonth: number;
  expiryYear: number;
  issuer?: string;
}

export interface StripeCustomerUser {
  id: string;
  email: string;
  name: string;
  stripeCustomerId: string | null;
}

export class SavedCardService {
  /**
   * Get-or-create do Customer da Stripe para o usuário. Idempotente por
   * design: se `user.stripeCustomerId` já existir, apenas o devolve — nunca
   * criamos um segundo Customer para o mesmo usuário.
   */
  async getOrCreateCustomer(user: StripeCustomerUser): Promise<string> {
    if (user.stripeCustomerId) {
      return user.stripeCustomerId;
    }

    const customer = await stripe.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeCustomerId: customer.id },
    });

    return customer.id;
  }

  /**
   * Cria um SetupIntent para tokenização de cartão (Stripe.js no frontend).
   * `usage: off_session` sinaliza à Stripe que este método de pagamento
   * poderá ser cobrado futuramente sem a presença do titular (checkout com
   * cartão salvo).
   */
  async createSetupIntent(customerId: string, userId: string): Promise<StripeSetupIntent> {
    return stripe.setupIntents.create({
      customer: customerId,
      usage: 'off_session',
      payment_method_types: ['card'],
      metadata: { userId },
    });
  }

  /**
   * Resolve e valida um payment_method da Stripe antes de persistir como
   * SavedCard. Zero-Trust: nunca confiamos que o `paymentMethodId` enviado
   * pelo frontend pertence ao usuário autenticado sem checar contra a Stripe.
   *
   * - Se o PM já está anexado a OUTRO customer, rejeita com 403 (impede que
   *   um usuário salve o cartão de outro usuário reutilizando um pm_ vazado).
   * - Se o PM ainda não está anexado a nenhum customer (caso o frontend tenha
   *   confirmado o SetupIntent sem `customer`), anexa ao customer do usuário
   *   atual antes de devolver.
   */
  async resolvePaymentMethod(
    paymentMethodId: string,
    customerId: string,
  ): Promise<StripePaymentMethod> {
    const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);

    if (paymentMethod.type !== 'card' || !paymentMethod.card) {
      throw new ValidationError('O método de pagamento informado não é um cartão.');
    }

    const attachedCustomerId =
      typeof paymentMethod.customer === 'string'
        ? paymentMethod.customer
        : (paymentMethod.customer?.id ?? null);

    if (attachedCustomerId && attachedCustomerId !== customerId) {
      throw new ForbiddenError('Este método de pagamento pertence a outro cliente.');
    }

    if (!attachedCustomerId) {
      await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId });
    }

    return paymentMethod;
  }

  /**
   * Deriva os dados exibíveis/persistíveis do cartão a partir do que a
   * própria Stripe retornou — nunca a partir de dados enviados pelo cliente
   * (PAN, CVV e afins nunca chegam/ficam no backend).
   */
  extractCardDetails(paymentMethod: StripePaymentMethod): StripeCardDetails {
    const card = paymentMethod.card;
    if (!card) {
      throw new ValidationError('O método de pagamento informado não é um cartão.');
    }

    const brand = STRIPE_BRAND_MAP[card.brand.toLowerCase()];
    if (!brand) {
      throw new ValidationError('Bandeira não suportada.');
    }

    const details: StripeCardDetails = {
      stripePaymentMethodId: paymentMethod.id,
      lastFourDigits: card.last4,
      brand,
      expiryMonth: card.exp_month,
      expiryYear: card.exp_year,
    };

    if (card.issuer) {
      details.issuer = card.issuer;
    }

    return details;
  }

  /**
   * Desanexa o payment_method na Stripe. Best-effort: a exclusão do cartão
   * salvo no nosso banco NUNCA deve ficar bloqueada por uma falha na Stripe
   * (rede fora do ar, PM já desanexado, etc.) — nesses casos apenas
   * registramos um warning e seguimos.
   */
  async detachPaymentMethod(stripePaymentMethodId: string): Promise<void> {
    try {
      await stripe.paymentMethods.detach(stripePaymentMethodId);
    } catch (err) {
      const stripeError = err as { code?: string; statusCode?: number };
      if (stripeError.code === 'resource_missing' || stripeError.statusCode === 404) {
        return;
      }
      logger.warn(
        { err, stripePaymentMethodId },
        'Falha ao desvincular método de pagamento na Stripe — exclusão local prossegue mesmo assim',
      );
    }
  }
}
