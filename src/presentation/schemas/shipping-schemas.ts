import { z } from 'zod';

export const calculateShippingSchema = z.object({
  zipCode: z
    .string()
    .regex(/^\d{5}-?\d{3}$/, 'CEP inválido. Use o formato 00000-000 ou 00000000'),
  // Subtotal do carrinho em REAIS, usado para calcular elegibilidade de
  // frete grátis progressivo (ver shipping-controller.ts). Opcional: quando
  // ausente, a resposta ainda traz `meta.freeShipping` (não elegível).
  subtotal: z.number().nonnegative().optional(),
});

export type CalculateShippingInput = z.infer<typeof calculateShippingSchema>;
