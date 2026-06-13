import { z } from 'zod';

// Note: productId is validated as a non-empty string here. The controller
// performs an authoritative existence check via prisma.product.findMany and
// throws NotFoundError for any unknown id, which is the correct security
// boundary. Avoid coupling this schema to a specific id format (uuid, cuid,
// nanoid) so id strategy can evolve without breaking the payment contract.
const paymentItemSchema = z.object({
  productId: z.string().min(1, 'productId é obrigatório').max(64),
  quantity: z.number().int().positive().max(999),
});

/**
 * Payment method keys used across the FE/BE contract.
 *
 * - `pix`: instantaneous Brazilian payment system. Backend confirms the
 *   intent and returns a QR code; user scans it with their bank app.
 * - `card`: brand new card via Stripe Elements (PaymentElement). Frontend
 *   confirms via stripe.confirmPayment().
 * - `saved_card`: previously stored card (PCI-compliant via Stripe payment
 *   method id). Backend confirms with `confirm: true` + `off_session: true`,
 *   may require 3DS challenge handled by the frontend.
 *
 * Boleto foi descontinuado: removido do contrato de entrada. Colunas de
 * boleto no banco e o enum Prisma BOLETO permanecem apenas para preservar
 * pedidos históricos.
 */
export const paymentMethodSchema = z.enum(['pix', 'card', 'saved_card']);
export type PaymentMethodKey = z.infer<typeof paymentMethodSchema>;

export const createPaymentIntentSchema = z
  .object({
    items: z
      .array(paymentItemSchema)
      .min(1, 'Pelo menos um item é obrigatório')
      .max(50),
    shippingCost: z.number().nonnegative('Custo de frete inválido'),
    currency: z.string().length(3).default('brl'),
    // Cupom é opcional. Quando presente, o backend revalida server-side
    // e recalcula o `amount` cobrado pela Stripe — nunca confiamos no
    // valor do cliente.
    couponCode: z.string().trim().min(3).max(32).optional(),
    paymentMethod: paymentMethodSchema.optional().default('card'),
    /**
     * Required when `paymentMethod === 'saved_card'`. The backend revalidates
     * ownership of the card before passing it to Stripe (Zero-Trust).
     */
    savedCardId: z.string().min(1).max(64).optional(),
    /**
     * Number of installments for card payments. Only meaningful for `card`
     * and `saved_card`; rejected by superRefine for other methods.
     */
    installments: z.number().int().min(1).max(12).optional().default(1),
  })
  .superRefine((value, ctx) => {
    if (value.paymentMethod === 'saved_card' && !value.savedCardId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'savedCardId é obrigatório para pagamento com cartão salvo.',
        path: ['savedCardId'],
      });
    }
    if (
      value.paymentMethod !== 'card' &&
      value.paymentMethod !== 'saved_card' &&
      value.installments &&
      value.installments > 1
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Parcelamento só é aplicável a pagamentos com cartão.',
        path: ['installments'],
      });
    }
  });

export type CreatePaymentIntentInput = z.infer<typeof createPaymentIntentSchema>;
