import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaProductRepository } from '../../infra/database/prisma-product-repository.js';
import type { ProductFiltersInput } from '../schemas/product-schemas.js';
import { successResponse, listResponse } from '../../shared/utils/response.js';
import { NotFoundError } from '../../domain/errors/app-error.js';

const productRepository = new PrismaProductRepository();

export async function listProductsHandler(
  request: FastifyRequest<{ Querystring: ProductFiltersInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { cursor, limit, ...filters } = request.query;

  const result = await productRepository.findMany(filters, { cursor, limit });

  const serialized = result.items.map((item) => ({
    ...item,
    price: Number(item.price),
    originalPrice: item.originalPrice ? Number(item.originalPrice) : null,
    installmentPrice: item.installmentPrice ? Number(item.installmentPrice) : null,
    availableStock: item.stock - item.reservedStock,
  }));

  void reply.status(200).send(listResponse(serialized, result.cursor, result.hasMore));
}

export async function getProductHandler(
  request: FastifyRequest<{ Params: { slug: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const product = await productRepository.findBySlug(request.params.slug);

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
