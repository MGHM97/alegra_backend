import { z } from 'zod';

/**
 * Corpo opcional de `POST /v1/admin/orders/:id/refund`.
 *
 * - `amount` ausente: reembolsa o saldo integral ainda reembolsável do
 *   pedido (comportamento histórico — reembolso total).
 * - `amount` presente: reembolso parcial nesse valor em reais. A validação
 *   de que o valor não excede o saldo reembolsável (totalAmount +
 *   installmentFee - refundedAmount) só pode acontecer no controller, pois
 *   depende de uma leitura do pedido no banco.
 */
export const refundOrderSchema = z
  .object({
    amount: z
      .number()
      .positive('O valor do reembolso deve ser maior que zero.')
      .finite()
      .optional(),
  })
  .default({});

export type RefundOrderInput = z.infer<typeof refundOrderSchema>;
