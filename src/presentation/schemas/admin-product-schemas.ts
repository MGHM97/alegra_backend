import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().min(2, 'Nome deve ter no mínimo 2 caracteres').max(200),
  description: z.string().min(10, 'Descrição deve ter no mínimo 10 caracteres').max(5000),
  shortDescription: z.string().min(5, 'Descrição curta deve ter no mínimo 5 caracteres').max(300),
  price: z.number().positive('Preço deve ser maior que zero'),
  originalPrice: z.number().positive().nullable().optional(),
  currency: z.string().length(3).default('BRL'),
  category: z.string().min(1, 'Categoria é obrigatória').max(50),
  subcategory: z.string().max(50).nullable().optional(),
  images: z.array(z.string().url()).min(1, 'Pelo menos uma imagem é obrigatória'),
  thumbnailUrl: z.string().url(),
  badges: z.array(z.string().max(30)).optional().default([]),
  specifications: z.record(z.string(), z.unknown()).optional().default({}),
  stock: z.number().int().nonnegative('Estoque não pode ser negativo'),
  sku: z.string().min(1, 'SKU é obrigatório').max(50),
  weight: z.number().positive('Peso deve ser maior que zero'),
  isActive: z.boolean().optional().default(true),
  maxInstallments: z.number().int().min(1).max(12).optional().default(1),
  installmentPrice: z.number().positive().nullable().optional(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z.object({
  name: z.string().min(2).max(200).optional(),
  description: z.string().min(10).max(5000).optional(),
  shortDescription: z.string().min(5).max(300).optional(),
  price: z.number().positive().optional(),
  originalPrice: z.number().positive().nullable().optional(),
  currency: z.string().length(3).optional(),
  category: z.string().min(1).max(50).optional(),
  subcategory: z.string().max(50).nullable().optional(),
  images: z.array(z.string().url()).optional(),
  thumbnailUrl: z.string().url().optional(),
  slug: z.string().min(1).max(200).optional(),
  badges: z.array(z.string().max(30)).optional(),
  specifications: z.record(z.string(), z.unknown()).optional(),
  stock: z.number().int().nonnegative().optional(),
  sku: z.string().min(1).max(50).optional(),
  weight: z.number().positive().optional(),
  isActive: z.boolean().optional(),
  maxInstallments: z.number().int().min(1).max(12).optional(),
  installmentPrice: z.number().positive().nullable().optional(),
});

export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const toggleStatusSchema = z.object({
  isActive: z.boolean(),
});

export type ToggleStatusInput = z.infer<typeof toggleStatusSchema>;
