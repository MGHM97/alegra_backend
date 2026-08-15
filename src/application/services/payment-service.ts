import { env } from '../../infra/config/env.js';
import { stripe } from '../../infra/config/stripe.js';
import type { PaymentMethodKey } from '../../presentation/schemas/payment-schemas.js';

export interface CreatePaymentIntentInput {
  amountInCents: number;
  currency: string;
  metadata: Record<string, string>;
  paymentMethod: PaymentMethodKey;
  /** Stripe payment_method id (NOT our internal SavedCard.id) — already resolved by the controller. */
  stripePaymentMethodId?: string;
  /** Customer id from Stripe — required when reusing a saved payment method. */
  stripeCustomerId?: string;
  installments?: number;
  /**
   * Chave de idempotência repassada à Stripe (2º argumento de
   * `paymentIntents.create`). Evita criar dois PaymentIntents/cobranças caso
   * a requisição seja reenviada (retry de rede, duplo clique) com o mesmo
   * conteúdo. Derivada pelo controller — ver `createPaymentIntentHandler`.
   */
  idempotencyKey?: string;
}

/** Nome do lojista exibido na fatura do cartão do cliente (≤ 22 caracteres, sem <>'"*). */
const STATEMENT_DESCRIPTOR_SUFFIX = 'ALEGRA FESTAS';

/**
 * Tempo de validade do QR Code Pix na Stripe. Precisa ser <= ao TTL da
 * reserva de estoque (ver STOCK_RESERVATION_MINUTES em
 * prisma-order-repository.ts) para que o estoque não seja liberado antes de
 * o cliente conseguir pagar o Pix.
 */
const PIX_EXPIRES_AFTER_SECONDS = 1800;

export interface PixData {
  qrCodeImage: string;
  qrCodeText: string;
  expiresAt: string;
}

export interface PaymentIntentResult {
  paymentIntentId: string;
  clientSecret: string;
  status: string;
  pixData: PixData | null;
}

export class PaymentService {
  /**
   * Creates a Stripe PaymentIntent for the given method.
   *
   * - `card`: lets Stripe Elements pick the method on the frontend
   *   (`automatic_payment_methods` + restricted to `card`).
   * - `pix`: confirms server-side; Stripe returns `next_action.pix_display_qr_code`.
   * - `saved_card`: passes `payment_method` + `confirm: true` + `off_session: true`.
   *   May still come back as `requires_action` (3DS) which the frontend handles.
   *
   * Installments: when method is card/saved_card and installments > 1, the
   * `payment_method_options.card.installments.plan` is sent. Brazil supports
   * `interest_free` plans up to 12x for cards on supported issuers.
   */
  async createPaymentIntent(input: CreatePaymentIntentInput): Promise<PaymentIntentResult> {
    const { paymentMethod, amountInCents, currency, metadata, idempotencyKey } = input;
    const lowerCurrency = currency.toLowerCase();
    const requestOptions: Parameters<typeof stripe.paymentIntents.create>[1] = {
      idempotencyKey,
    };

    if (paymentMethod === 'pix') {
      const intent = await stripe.paymentIntents.create(
        {
          amount: amountInCents,
          currency: lowerCurrency,
          payment_method_types: ['pix'],
          payment_method_data: { type: 'pix' },
          payment_method_options: {
            pix: { expires_after_seconds: PIX_EXPIRES_AFTER_SECONDS },
          },
          confirm: true,
          metadata,
        },
        requestOptions,
      );

      return this.toResult(intent, 'pix');
    }

    if (paymentMethod === 'saved_card') {
      if (!input.stripePaymentMethodId) {
        throw new Error('Saved card requires a Stripe payment_method id.');
      }

      const params: Parameters<typeof stripe.paymentIntents.create>[0] = {
        amount: amountInCents,
        currency: lowerCurrency,
        payment_method_types: ['card'],
        payment_method: input.stripePaymentMethodId,
        confirm: true,
        off_session: true,
        statement_descriptor_suffix: STATEMENT_DESCRIPTOR_SUFFIX,
        metadata,
      };

      if (input.stripeCustomerId) {
        params.customer = input.stripeCustomerId;
      }

      if (input.installments && input.installments > 1) {
        params.payment_method_options = {
          card: {
            installments: {
              enabled: true,
              plan: { count: input.installments, interval: 'month', type: 'fixed_count' },
            },
          },
        };
      }

      const intent = await stripe.paymentIntents.create(params, requestOptions);
      return this.toResult(intent, 'saved_card');
    }

    // Default: brand-new card via PaymentElement on the frontend.
    const cardParams: Parameters<typeof stripe.paymentIntents.create>[0] = {
      amount: amountInCents,
      currency: lowerCurrency,
      payment_method_types: ['card'],
      statement_descriptor_suffix: STATEMENT_DESCRIPTOR_SUFFIX,
      metadata,
    };

    if (input.installments && input.installments > 1) {
      cardParams.payment_method_options = {
        card: {
          installments: {
            enabled: true,
          },
        },
      };
    }

    const intent = await stripe.paymentIntents.create(cardParams, requestOptions);
    return this.toResult(intent, 'card');
  }

  private toResult(
    intent: Awaited<ReturnType<typeof stripe.paymentIntents.create>>,
    method: PaymentMethodKey,
  ): PaymentIntentResult {
    if (!intent.client_secret) {
      throw new Error('Stripe did not return a client_secret');
    }

    let pixData: PixData | null = null;

    const nextAction = intent.next_action;

    if (method === 'pix' && nextAction?.type === 'pix_display_qr_code') {
      const display = nextAction.pix_display_qr_code;
      if (display) {
        pixData = {
          qrCodeImage: display.image_url_png ?? display.image_url_svg ?? '',
          qrCodeText: display.data ?? '',
          expiresAt: display.expires_at
            ? new Date(display.expires_at * 1000).toISOString()
            : new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        };
      }
    }

    return {
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
      pixData,
    };
  }

  constructWebhookEvent(rawBody: Buffer, signature: string) {
    return stripe.webhooks.constructEvent(
      rawBody,
      signature,
      env.STRIPE_WEBHOOK_SECRET,
    );
  }

  async createRefund(paymentIntentId: string): Promise<string> {
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
    });
    return refund.id;
  }
}
