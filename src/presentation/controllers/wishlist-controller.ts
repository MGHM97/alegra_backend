import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaWishlistRepository } from '../../infra/database/prisma-wishlist-repository.js';
import { PrismaProductRepository } from '../../infra/database/prisma-product-repository.js';
import { successResponse } from '../../shared/utils/response.js';
import {
  UnauthorizedError,
  NotFoundError,
  ValidationError,
} from '../../domain/errors/app-error.js';
import type {
  AddToWishlistInput,
  WishlistProductIdParam,
} from '../schemas/wishlist-schemas.js';
import type { WishlistItemWithProduct } from '../../domain/entities/wishlist-item.js';

const wishlistRepository = new PrismaWishlistRepository();
const productRepository = new PrismaProductRepository();

function serializeWishlistItem(item: WishlistItemWithProduct) {
  return {
    id: item.id,
    productId: item.productId,
    createdAt: item.createdAt.toISOString(),
    product: item.product,
  };
}

/**
 * GET /v1/wishlist
 * Lista todos os produtos favoritados pelo usuário autenticado,
 * incluindo o produto completo para renderização direta no frontend.
 */
export async function listWishlistHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const items = await wishlistRepository.findByUserId(currentUser.sub);
  void reply.status(200).send(successResponse(items.map(serializeWishlistItem)));
}

/**
 * POST /v1/wishlist
 * Adiciona um produto à wishlist do usuário autenticado.
 *
 * Idempotente: se o produto já está na lista, retorna 200 com o item
 * existente em vez de erro — evita race condition em duplo clique e
 * simplifica o frontend (não precisa diferenciar criar/já existe).
 *
 * Valida que:
 *  - O produto existe
 *  - O produto está ativo (não permite favoritar produtos descontinuados)
 *
 * Segurança: o userId vem SEMPRE do JWT (request.currentUser.sub),
 * nunca do body — Zero-Trust em ação.
 */
export async function addToWishlistHandler(
  request: FastifyRequest<{ Body: AddToWishlistInput }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  const { productId } = request.body;

  // Valida produto existe e está ativo
  const product = await productRepository.findById(productId);
  if (!product) {
    throw new NotFoundError('Product');
  }
  if (!product.isActive) {
    throw new ValidationError('Não é possível favoritar um produto inativo.');
  }

  // Idempotente: verifica se já existe
  const existing = await wishlistRepository.findByUserAndProduct(
    currentUser.sub,
    productId,
  );

  if (existing) {
    void reply.status(200).send(
      successResponse({
        id: existing.id,
        productId: existing.productId,
        createdAt: existing.createdAt.toISOString(),
        alreadyExists: true,
      }),
    );
    return;
  }

  const created = await wishlistRepository.create(currentUser.sub, productId);
  void reply.status(201).send(
    successResponse({
      id: created.id,
      productId: created.productId,
      createdAt: created.createdAt.toISOString(),
      alreadyExists: false,
    }),
  );
}

/**
 * DELETE /v1/wishlist/:productId
 * Remove um produto da wishlist do usuário autenticado.
 * Idempotente: deleteMany não falha se não houver match (retorna 204
 * mesmo quando o item já foi removido em outra aba/dispositivo).
 */
export async function removeFromWishlistHandler(
  request: FastifyRequest<{ Params: WishlistProductIdParam }>,
  reply: FastifyReply,
): Promise<void> {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }

  await wishlistRepository.delete(currentUser.sub, request.params.productId);
  void reply.status(204).send();
}
