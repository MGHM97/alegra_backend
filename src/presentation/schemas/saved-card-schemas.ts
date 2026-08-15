import { z } from 'zod';

const cardTypeSchema = z.enum(['CREDIT', 'DEBIT']);

/**
 * O front nunca envia PAN/CVV nem dados de bandeira/validade — tudo isso é
 * derivado no backend a partir do payment_method da Stripe (ver
 * SavedCardService.extractCardDetails). O único dado sensível trafegado é o
 * id do payment_method já tokenizado pela Stripe (pm_...).
 */
export const createSavedCardSchema = z.object({
  paymentMethodId: z
    .string()
    .regex(/^pm_[A-Za-z0-9]+$/, 'ID de método de pagamento da Stripe inválido.'),
  holderName: z
    .string()
    .min(1, 'O nome do titular é obrigatório.')
    .max(100, 'O nome do titular deve ter no máximo 100 caracteres.'),
  holderDocument: z
    .string()
    .regex(/^\d{11}$|^\d{14}$/, 'O documento deve ser CPF (11 dígitos) ou CNPJ (14 dígitos).')
    .optional(),
  cardType: cardTypeSchema.optional().default('CREDIT'),
  isDefault: z.boolean().optional(),
});

export type CreateSavedCardInput = z.infer<typeof createSavedCardSchema>;

export const updateSavedCardSchema = z.object({
  holderName: z
    .string()
    .min(1, 'O nome do titular é obrigatório.')
    .max(100, 'O nome do titular deve ter no máximo 100 caracteres.')
    .optional(),
  cardType: cardTypeSchema.optional(),
  isDefault: z.boolean().optional(),
});

export type UpdateSavedCardInput = z.infer<typeof updateSavedCardSchema>;
