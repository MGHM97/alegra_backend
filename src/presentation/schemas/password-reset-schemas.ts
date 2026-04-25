import { z } from 'zod';

export const forgotPasswordSchema = z.object({
  email: z
    .string()
    .email('Formato de e-mail invalido')
    .max(255)
    .transform((v) => v.toLowerCase().trim()),
});

export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().uuid('Token invalido'),
  password: z
    .string()
    .min(8, 'A senha deve ter no minimo 8 caracteres')
    .max(128)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'A senha deve conter pelo menos uma letra minuscula, uma maiuscula e um digito',
    ),
});

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
