import { z } from 'zod';

/**
 * Body para POST /v1/wishlist. Aceita um productId (string), seguindo
 * o padrão relaxado adotado em sessões anteriores — IDs já são UUIDs
 * gerados pelo backend, validar como UUID estrito quebra integrações
 * que enviam string limpa.
 */
export const addToWishlistSchema = z.object({
  productId: z
    .string()
    .trim()
    .min(1, 'productId é obrigatório.')
    .max(64, 'productId inválido.'),
});

export type AddToWishlistInput = z.infer<typeof addToWishlistSchema>;

export const wishlistProductIdParamSchema = z.object({
  productId: z
    .string()
    .trim()
    .min(1, 'productId é obrigatório.')
    .max(64, 'productId inválido.'),
});

export type WishlistProductIdParam = z.infer<typeof wishlistProductIdParamSchema>;
