import { z } from 'zod';

// ---- Admin ----

const isoDateString = z
  .string()
  .datetime({ offset: true, message: 'Data inválida (use formato ISO 8601).' });

const couponCodeField = z
  .string()
  .trim()
  .min(3, 'O código deve ter no mínimo 3 caracteres.')
  .max(32, 'O código deve ter no máximo 32 caracteres.')
  .regex(/^[A-Z0-9_-]+$/i, 'O código aceita apenas letras, números, "_" e "-".');

const baseCouponShape = {
  code: couponCodeField,
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  discountValue: z.number().positive('O valor do desconto deve ser maior que zero.'),
  maxUses: z.number().int().positive().nullable().optional(),
  validFrom: isoDateString.nullable().optional(),
  validUntil: isoDateString.nullable().optional(),
  minOrderAmount: z.number().positive().nullable().optional(),
  description: z.string().trim().max(255).nullable().optional(),
  isActive: z.boolean().optional(),
};

export const createCouponSchema = z
  .object(baseCouponShape)
  .superRefine((data, ctx) => {
    if (data.discountType === 'PERCENTAGE' && data.discountValue > 100) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'O percentual não pode ser maior que 100.',
      });
    }
    if (data.validFrom && data.validUntil) {
      const start = new Date(data.validFrom);
      const end = new Date(data.validUntil);
      if (end <= start) {
        ctx.addIssue({
          code: 'custom',
          path: ['validUntil'],
          message: 'A data de expiração deve ser posterior à data de início.',
        });
      }
    }
  });

export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = z
  .object({
    code: couponCodeField.optional(),
    discountType: z.enum(['PERCENTAGE', 'FIXED']).optional(),
    discountValue: z.number().positive().optional(),
    maxUses: z.number().int().positive().nullable().optional(),
    validFrom: isoDateString.nullable().optional(),
    validUntil: isoDateString.nullable().optional(),
    minOrderAmount: z.number().positive().nullable().optional(),
    description: z.string().trim().max(255).nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .superRefine((data, ctx) => {
    if (
      data.discountType === 'PERCENTAGE' &&
      data.discountValue !== undefined &&
      data.discountValue > 100
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['discountValue'],
        message: 'O percentual não pode ser maior que 100.',
      });
    }
    if (data.validFrom && data.validUntil) {
      const start = new Date(data.validFrom);
      const end = new Date(data.validUntil);
      if (end <= start) {
        ctx.addIssue({
          code: 'custom',
          path: ['validUntil'],
          message: 'A data de expiração deve ser posterior à data de início.',
        });
      }
    }
  });

export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;

export const listCouponsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isActive: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === 'true')),
  search: z.string().trim().max(64).optional(),
});

export type ListCouponsQuery = z.infer<typeof listCouponsQuerySchema>;

// ---- Public validate endpoint ----

export const validateCouponSchema = z.object({
  code: couponCodeField,
  subtotal: z.number().positive('Subtotal inválido.'),
});

export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
