import { z } from 'zod';

const addressTypeSchema = z.enum(['HOME', 'WORK']);

export const createAddressSchema = z.object({
  label: z.string().min(1, 'Label is required').max(50),
  street: z.string().min(1, 'Street is required').max(200),
  number: z.string().min(1, 'Number is required').max(20),
  complement: z.string().max(100).optional(),
  neighborhood: z.string().min(1, 'Neighborhood is required').max(100),
  city: z.string().min(1, 'City is required').max(100),
  state: z.string().length(2, 'State must be 2 characters'),
  zipCode: z.string().regex(/^\d{5}-?\d{3}$/, 'Invalid ZIP code format'),
  additionalInfo: z.string().max(128, 'Additional info must be at most 128 characters').optional(),
  addressType: addressTypeSchema.optional().default('HOME'),
  recipientName: z.string().min(1).max(100).optional(),
  recipientPhone: z.string().regex(/^\d{10,11}$/, 'Phone must be 10 or 11 digits').optional(),
  isDefault: z.boolean().optional(),
});

export type CreateAddressInput = z.infer<typeof createAddressSchema>;

export const updateAddressSchema = z.object({
  label: z.string().min(1).max(50).optional(),
  street: z.string().min(1).max(200).optional(),
  number: z.string().min(1).max(20).optional(),
  complement: z.string().max(100).nullable().optional(),
  neighborhood: z.string().min(1).max(100).optional(),
  city: z.string().min(1).max(100).optional(),
  state: z.string().length(2).optional(),
  zipCode: z.string().regex(/^\d{5}-?\d{3}$/).optional(),
  additionalInfo: z.string().max(128).nullable().optional(),
  addressType: addressTypeSchema.optional(),
  recipientName: z.string().min(1).max(100).nullable().optional(),
  recipientPhone: z.string().regex(/^\d{10,11}$/).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export type UpdateAddressInput = z.infer<typeof updateAddressSchema>;
