import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaProductRepository } from '../../infra/database/prisma-product-repository.js';
import type { ProductFiltersInput } from '../schemas/product-schemas.js';
import { successResponse, listResponse } from '../../shared/utils/response.js';
import { NotFoundError } from '../../domain/errors/app-error.js';
import { cacheGet, cacheSet } from '../../infra/cache/cache-utils.js';

const productRepository = new PrismaProductRepository();

const PRODUCTS_LIST_TTL = 300; // 5 minutes
const PRODUCT_SLUG_TTL = 600; // 10 minutes

export async function listProductsHandler(
  request: FastifyRequest<{ Querystring: ProductFiltersInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { cursor, limit, ...filters } = request.query;

  const cacheKey = `products:list:${JSON.stringify({ ...filters, cursor, limit })}`;
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached) {
    void reply.status(200).send(cached);
    return;
  }

  const result = await productRepository.findMany(filters, { cursor, limit });

  const serialized = result.items.map((item) => ({
    ...item,
    price: Number(item.price),
    originalPrice: item.originalPrice ? Number(item.originalPrice) : null,
    installmentPrice: item.installmentPrice ? Number(item.installmentPrice) : null,
    availableStock: item.stock - item.reservedStock,
  }));

  const response = listResponse(serialized, result.cursor, result.hasMore);
  await cacheSet(cacheKey, response, PRODUCTS_LIST_TTL);

  void reply.status(200).send(response);
}

export async function getProductHandler(
  request: FastifyRequest<{ Params: { slug: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { slug } = request.params;

  const cacheKey = `products:slug:${slug}`;
  const cached = await cacheGet<unknown>(cacheKey);
  if (cached) {
    void reply.status(200).send(cached);
    return;
  }

  const product = await productRepository.findBySlug(slug);

  if (!product) {
    throw new NotFoundError('Product');
  }

  const serialized = {
    ...product,
    price: Number(product.price),
    originalPrice: product.originalPrice ? Number(product.originalPrice) : null,
    weight: Number(product.weight),
    installmentPrice: product.installmentPrice ? Number(product.installmentPrice) : null,
    availableStock: product.stock - product.reservedStock,
  };

  const response = successResponse(serialized);
  await cacheSet(cacheKey, response, PRODUCT_SLUG_TTL);

  void reply.status(200).send(response);
}

export async function getProductByIdHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const product = await productRepository.findById(request.params.id);

  if (!product) {
    throw new NotFoundError('Product');
  }

  const serialized = {
    ...product,
    price: Number(product.price),
    originalPrice: product.originalPrice ? Number(product.originalPrice) : null,
    weight: Number(product.weight),
    installmentPrice: product.installmentPrice ? Number(product.installmentPrice) : null,
    availableStock: product.stock - product.reservedStock,
  };

  void reply.status(200).send(successResponse(serialized));
}
