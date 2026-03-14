import { z } from 'zod';

const cardBrandSchema = z.enum(['VISA', 'MASTERCARD', 'ELO', 'AMEX', 'HIPERCARD']);
const cardTypeSchema = z.enum(['CREDIT', 'DEBIT']);

export const createSavedCardSchema = z.object({
  cardNumber: z.string()
    .regex(/^\d{13,19}$/, 'Card number must be 13-19 digits')
    .optional(),
  lastFourDigits: z.string().length(4, 'Must be exactly 4 digits').regex(/^\d{4}$/, 'Must be numeric'),
  brand: cardBrandSchema,
  holderName: z.string().min(1, 'Holder name is required').max(100),
  expiryMonth: z.number().int().min(1).max(12),
  expiryYear: z.number().int().min(2024),
  cardType: cardTypeSchema.optional().default('CREDIT'),
  holderDocument: z.string()
    .regex(/^\d{11}$|^\d{14}$/, 'Document must be CPF (11 digits) or CNPJ (14 digits)')
    .optional(),
  issuer: z.string().max(100).optional(),
  isDefault: z.boolean().optional(),
});

export type CreateSavedCardInput = z.infer<typeof createSavedCardSchema>;

export const updateSavedCardSchema = z.object({
  holderName: z.string().min(1).max(100).optional(),
  expiryMonth: z.number().int().min(1).max(12).optional(),
  expiryYear: z.number().int().min(2024).optional(),
  cardType: cardTypeSchema.optional(),
  isDefault: z.boolean().optional(),
});

export type UpdateSavedCardInput = z.infer<typeof updateSavedCardSchema>;
