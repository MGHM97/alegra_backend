import { z } from 'zod';

const usernameSchema = z
  .string()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be at most 20 characters')
  .regex(
    /^[a-zA-Z][a-zA-Z0-9_]*$/,
    'Username must start with a letter and contain only letters, numbers, and underscores',
  )
  .transform((v) => v.toLowerCase().trim());

export const registerSchema = z.object({
  email: z
    .string()
    .email('Invalid email format')
    .max(255)
    .transform((v) => v.toLowerCase().trim()),
  username: usernameSchema,
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128)
    .regex(
      /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/,
      'Password must contain at least one lowercase, one uppercase, and one digit',
    ),
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .max(100)
    .transform((v) => v.trim()),
});

export const loginSchema = z.object({
  identifier: z
    .string()
    .min(1, 'Email or username is required')
    .max(255)
    .transform((v) => v.trim().toLowerCase()),
  password: z.string().min(1, 'Password is required').max(128),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export const updateProfileSchema = z.object({
  name: z
    .string()
    .min(2, 'Nome deve ter no minimo 2 caracteres')
    .max(100)
    .transform((v) => v.trim())
    .optional(),
  phone: z
    .string()
    .regex(/^\d{10,11}$/, 'Telefone deve ter 10 ou 11 digitos')
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
