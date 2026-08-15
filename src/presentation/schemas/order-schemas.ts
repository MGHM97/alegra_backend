import { z } from 'zod';
import { paymentMethodSchema } from './payment-schemas.js';

// productId is validated as a non-empty string. Authoritative product
// existence is enforced by the use-case layer via the product repository,
// which throws NotFoundError for unknown ids — that is the correct security
// boundary. Decoupling this schema from a specific id format (uuid, cuid,
// nanoid) lets the id strategy evolve without breaking checkout.
// unitPrice é OPCIONAL: o backend sempre revalida (e usa) o preço vindo do
// banco no momento do checkout (ver prisma-order-repository.ts), nunca
// confiando no valor enviado pelo cliente. Quando o cliente ainda envia
// unitPrice (compatibilidade com clientes antigos), ele é comparado ao
// preço do banco e diverência lança PriceMismatchError — mesma checagem de
// antes, agora só sem exigir o campo.
const orderItemSchema = z.object({
  productId: z.string().min(1, 'productId is required').max(64),
  quantity: z.number().int().positive('Quantity must be a positive integer').max(999),
  unitPrice: z.number().positive('Unit price must be positive').optional(),
});

export const createOrderSchema = z.object({
  items: z
    .array(orderItemSchema)
    .min(1, 'Order must have at least one item')
    .max(50, 'Order cannot have more than 50 items'),
  idempotencyKey: z.string().uuid('Idempotency key must be a valid UUID').optional(),
  notes: z.string().max(500).optional(),
  couponCode: z.string().trim().min(3).max(32).optional(),
  shippingCost: z.number().nonnegative().optional(),
  shippingAddressId: z.string().min(1).max(64).optional(),
  shippingMethodName: z.string().max(120).optional(),
  shippingCarrier: z.string().max(120).optional(),
  /**
   * Payment context — needed so the order persists which method the user
   * selected and any non-card payment flow data (PIX QR / boleto barcode).
   * The client is the source of truth for paymentIntentId; the backend
   * validates it as a string here and trusts the webhook to update status.
   */
  paymentIntentId: z.string().min(1).max(120).optional(),
  paymentMethod: paymentMethodSchema.optional().default('card'),
  paymentStatus: z
    .enum([
      'PENDING',
      'REQUIRES_ACTION',
      'REQUIRES_CONFIRMATION',
      'PROCESSING',
      'SUCCEEDED',
      'FAILED',
      'CANCELED',
    ])
    .optional(),
  savedCardId: z.string().min(1).max(64).optional(),
  installments: z.number().int().min(1).max(12).optional().default(1),
  pixQrCode: z.string().max(200000).optional(),
  pixQrCodeText: z.string().max(2000).optional(),
  pixExpiresAt: z.string().datetime().optional(),
  boletoUrl: z.string().url().max(2048).optional(),
  boletoBarcode: z.string().max(120).optional(),
  boletoExpiresAt: z.string().datetime().optional(),
});

export type CreateOrderInput = z.infer<typeof createOrderSchema>;

/**
 * GET /v1/orders — cursor-based pagination, same pattern as the admin
 * orders listing. `limit` is capped at 50 (rather than silently clamped)
 * so a client asking for too much gets an explicit 422 instead of silently
 * receiving fewer rows than it thinks it asked for.
 */
export const listUserOrdersQuerySchema = z.object({
  period: z.coerce.number().int().positive().optional(),
  search: z.string().max(200).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type ListUserOrdersQuery = z.infer<typeof listUserOrdersQuerySchema>;
