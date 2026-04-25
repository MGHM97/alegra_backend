import { z } from 'zod';

/**
 * Schema de inscrição na newsletter.
 *
 * Limite de 254 caracteres conforme RFC 5321 (tamanho máximo de e-mail).
 * Normalização: lowercase + trim para garantir idempotência (não criar
 * inscrições duplicadas só porque o usuário digitou MAIÚSCULAS).
 */
export const subscribeNewsletterSchema = z.object({
  email: z
    .string()
    .email('E-mail inválido.')
    .max(254, 'E-mail excede o limite de caracteres permitido.')
    .transform((v) => v.toLowerCase().trim()),
});

export type SubscribeNewsletterInput = z.infer<typeof subscribeNewsletterSchema>;
