import { z } from 'zod';

export const contactSchema = z.object({
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres').max(100),
  email: z.string().email('E-mail inválido').max(255),
  subject: z.string().max(200).optional().default(''),
  message: z.string().min(10, 'Mensagem deve ter no mínimo 10 caracteres').max(2000),
});

export type ContactInput = z.infer<typeof contactSchema>;
