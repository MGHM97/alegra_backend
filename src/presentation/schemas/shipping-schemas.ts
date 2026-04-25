import { z } from 'zod';

export const calculateShippingSchema = z.object({
  zipCode: z
    .string()
    .regex(/^\d{5}-?\d{3}$/, 'CEP invalido. Use o formato 00000-000 ou 00000000'),
});

export type CalculateShippingInput = z.infer<typeof calculateShippingSchema>;
