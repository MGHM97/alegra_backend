import { z } from 'zod';

const usernameSchema = z
  .string()
  .min(3, 'O usuário deve ter no mínimo 3 caracteres')
  .max(20, 'O usuário deve ter no máximo 20 caracteres')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    'O usuário deve começar com uma letra e conter apenas letras, números e underline',
  )
  .transform((v) => v.toLowerCase().trim());

export const registerSchema = z.object({
  email: z
    .string()
    .email('Formato de e-mail inválido')
    .max(255)
    .transform((v) => v.toLowerCase().trim()),
  username: usernameSchema,
  password: z
    .string()
    .min(8, 'A senha deve ter no mínimo 8 caracteres')
    .max(128)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'A senha deve conter pelo menos uma letra minúscula, uma maiúscula e um dígito',
    ),
  name: z
    .string()
    .min(2, 'O nome deve ter no mínimo 2 caracteres')
    .max(100)
    .transform((v) => v.trim()),
});

export const loginSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Informe seu e-mail ou usuário')
    .max(255)
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, 'Informe sua senha').max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(2, 'O nome deve ter no mínimo 2 caracteres')
    .max(100)
    .transform((v) => v.trim())
    .optional(),
  phone: z
    .string()
    .regex(/^\d{10,11}$/, 'O telefone deve ter 10 ou 11 dígitos')
    .optional(),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/**
 * Schema para DELETE /v1/auth/me — exige confirmação por senha.
 *
 * A senha é re-verificada server-side via bcrypt.compare como camada
 * adicional de proteção contra deleção acidental ou via token roubado
 * (Zero-Trust: o JWT autentica, mas a senha confirma a intenção).
 */
export const deleteAccountSchema = z.object({
  password: z
    .string()
    .min(1, 'Senha é obrigatória para confirmar a exclusão.')
    .max(128),
});

export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;
