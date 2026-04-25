import { z } from 'zod';
import { paymentMethodSchema } from './payment-schemas.js';

/**
 * Schemas for the Admin Checkout Preview endpoints.
 *
 * PREVIEW MODE — these endpoints are admin-only, perform NO persistence,
 * NEVER call Stripe and NEVER decrement stock or coupon usage. They exist
 * exclusively for QA-style visual walk-throughs of the entire checkout
 * flow (Endereço → Frete → Pagamento → Resumo → Sucesso) without producing
 * any real-world side effect.
 *
 * The body shapes mirror the real /payments/create-intent and /orders
 * endpoints so the frontend can swap services without changing flow logic.
 */

const previewItemSchema = z.object({
  productId: z.string().min(1, 'productId é obrigatório').max(64),
  quantity: z.number().int().positive().max(999),
});

export const createPreviewIntentSchema = z
  .object({
    items: z
      .array(previewItemSchema)
      .min(1, 'Pelo menos um item é obrigatório')
      .max(50),
    shippingCost: z.number().nonnegative('Custo de frete inválido'),
    currency: z.string().length(3).default('brl'),
    couponCode: z.string().trim().min(3).max(32).optional(),
    paymentMethod: paymentMethodSchema.optional().default('card'),
    savedCardId: z.string().min(1).max(64).optional(),
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

export type CreatePreviewIntentInput = z.infer<typeof createPreviewIntentSchema>;

/**
 * Sentinel format: `preview_admin_{uuid}_secret_{uuid}`
 * The confirm/order endpoints validate the prefix to refuse any non-preview
 * value coming from a tampered client.
 */
export const PREVIEW_CLIENT_SECRET_PREFIX = 'preview_admin_';

export const confirmPreviewIntentSchema = z.object({
  clientSecret: z
    .string()
    .min(PREVIEW_CLIENT_SECRET_PREFIX.length + 8)
    .startsWith(
      PREVIEW_CLIENT_SECRET_PREFIX,
      'clientSecret de preview inválido.',
    ),
});

export type ConfirmPreviewIntentInput = z.infer<typeof confirmPreviewIntentSchema>;

const previewOrderItemSchema = z.object({
  productId: z.string().min(1, 'productId é obrigatório').max(64),
  quantity: z.number().int().positive('Quantidade inválida').max(999),
  unitPrice: z.number().positive('Preço unitário inválido'),
});

export const createPreviewOrderSchema = z.object({
  items: z
    .array(previewOrderItemSchema)
    .min(1, 'Pedido precisa de ao menos um item')
    .max(50),
  paymentIntentId: z
    .string()
    .startsWith(
      PREVIEW_CLIENT_SECRET_PREFIX,
      'paymentIntentId de preview inválido.',
    ),
  notes: z.string().max(500).optional(),
  couponCode: z.string().trim().min(3).max(32).optional(),
  shippingCost: z.number().nonnegative().optional(),
  shippingMethodName: z.string().max(120).optional(),
  shippingAddressId: z.string().min(1).max(64).optional(),
  paymentMethod: paymentMethodSchema.optional().default('card'),
  savedCardId: z.string().min(1).max(64).optional(),
  installments: z.number().int().min(1).max(12).optional().default(1),
});

export type CreatePreviewOrderInput = z.infer<typeof createPreviewOrderSchema>;
