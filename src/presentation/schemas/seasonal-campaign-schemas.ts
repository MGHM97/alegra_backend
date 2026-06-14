import { z } from 'zod';

// ── Campos reutilizáveis ──────────────────────────────────────────────────────

const hexColorField = z
  .string()
  .trim()
  .regex(/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Cor inválida. Use formato hex (#RGB ou #RRGGBB).');

const monthField = z
  .number()
  .int()
  .min(1, 'Mês inválido.')
  .max(12, 'Mês inválido.');

const dayField = z
  .number()
  .int()
  .min(1, 'Dia inválido.')
  .max(31, 'Dia inválido.');

const keyField = z
  .string()
  .trim()
  .min(2, 'A chave deve ter no mínimo 2 caracteres.')
  .max(64, 'A chave deve ter no máximo 64 caracteres.')
  .regex(/^[a-z0-9-]+$/, 'A chave aceita apenas letras minúsculas, números e "-".');

// ── Admin: criar campanha ─────────────────────────────────────────────────────

export const createSeasonalCampaignSchema = z.object({
  key: keyField.optional(),
  ribbon: z
    .string()
    .trim()
    .min(1, 'A mensagem da faixa não pode ser vazia.')
    .max(200, 'A mensagem da faixa deve ter no máximo 200 caracteres.'),
  eyebrow: z
    .string()
    .trim()
    .min(1, 'O texto do eyebrow não pode ser vazio.')
    .max(100, 'O texto do eyebrow deve ter no máximo 100 caracteres.'),
  emoji: z
    .string()
    .trim()
    .min(1, 'O emoji não pode ser vazio.')
    .max(8, 'O emoji deve ter no máximo 8 caracteres.'),
  accent: hexColorField,
  accentText: hexColorField,
  startMonth: monthField,
  startDay: dayField,
  endMonth: monthField,
  endDay: dayField,
  year: z.number().int().min(2000).max(2100).nullable().optional(),
  priority: z.number().int().min(0, 'A prioridade deve ser maior ou igual a zero.').default(0),
  isActive: z.boolean().optional().default(true),
});

export type CreateSeasonalCampaignInput = z.infer<typeof createSeasonalCampaignSchema>;

// ── Admin: atualizar campanha ─────────────────────────────────────────────────

export const updateSeasonalCampaignSchema = z.object({
  key: keyField.optional(),
  ribbon: z.string().trim().min(1).max(200).optional(),
  eyebrow: z.string().trim().min(1).max(100).optional(),
  emoji: z.string().trim().min(1).max(8).optional(),
  accent: hexColorField.optional(),
  accentText: hexColorField.optional(),
  startMonth: monthField.optional(),
  startDay: dayField.optional(),
  endMonth: monthField.optional(),
  endDay: dayField.optional(),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
});

export type UpdateSeasonalCampaignInput = z.infer<typeof updateSeasonalCampaignSchema>;

// ── Admin: toggle isActive ────────────────────────────────────────────────────

export const toggleCampaignStatusSchema = z.object({
  isActive: z.boolean(),
});

export type ToggleCampaignStatusInput = z.infer<typeof toggleCampaignStatusSchema>;
