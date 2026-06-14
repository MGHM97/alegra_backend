import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaProductRepository } from '../../infra/database/prisma-product-repository.js';
import type {
  CreateProductInput,
  UpdateProductInput,
  ToggleStatusInput,
} from '../schemas/admin-product-schemas.js';
import { successResponse } from '../../shared/utils/response.js';
import { NotFoundError, ConflictError } from '../../domain/errors/app-error.js';
import { cacheInvalidatePattern } from '../../infra/cache/cache-utils.js';

const productRepository = new PrismaProductRepository();

async function invalidateProductCache(): Promise<void> {
  await cacheInvalidatePattern('products:*');
}

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
}

function serializeProduct(product: {
  id: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  price: unknown;
  originalPrice: unknown;
  currency: string;
  category: string;
  subcategory: string | null;
  images: string[];
  thumbnailUrl: string;
  badges: string[];
  specifications: unknown;
  stock: number;
  reservedStock: number;
  sku: string;
  weight: unknown;
  isActive: boolean;
  maxInstallments: number;
  installmentPrice: unknown;
  videoUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    shortDescription: product.shortDescription,
    price: Number(product.price),
    originalPrice: product.originalPrice ? Number(product.originalPrice) : null,
    currency: product.currency,
    category: product.category,
    subcategory: product.subcategory,
    images: product.images,
    thumbnailUrl: product.thumbnailUrl,
    badges: product.badges,
    specifications: product.specifications,
    stock: product.stock,
    reservedStock: product.reservedStock,
    availableStock: product.stock - product.reservedStock,
    sku: product.sku,
    weight: Number(product.weight),
    isActive: product.isActive,
    maxInstallments: product.maxInstallments,
    installmentPrice: product.installmentPrice ? Number(product.installmentPrice) : null,
    videoUrl: product.videoUrl,
    createdAt: product.createdAt.toISOString(),
    updatedAt: product.updatedAt.toISOString(),
  };
}

export async function createProductHandler(
  request: FastifyRequest<{ Body: CreateProductInput }>,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body;

  const slug = generateSlug(body.name);

  const existingSlug = await productRepository.findBySlug(slug);
  if (existingSlug) {
    throw new ConflictError(`Já existe um produto com o slug "${slug}"`);
  }

  let product;
  try {
    product = await productRepository.create({
      ...body,
      slug,
    });
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      throw new ConflictError('Este SKU ja esta em uso. Escolha outro.');
    }
    throw err;
  }

  await invalidateProductCache();
  void reply.status(201).send(successResponse(serializeProduct(product)));
}

export async function updateProductHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateProductInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;
  const body = request.body;

  const existing = await productRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Product');
  }

  const updateData = { ...body };

  if (body.name && body.name !== existing.name) {
    const newSlug = generateSlug(body.name);
    const slugConflict = await productRepository.findBySlug(newSlug);
    if (slugConflict && slugConflict.id !== id) {
      throw new ConflictError(`Já existe um produto com o slug "${newSlug}"`);
    }
    updateData.slug = newSlug;
  }

  let product;
  try {
    product = await productRepository.update(id, updateData);
  } catch (err: unknown) {
    if (err && typeof err === 'object' && 'code' in err && (err as { code: string }).code === 'P2002') {
      throw new ConflictError('Este SKU ja esta em uso. Escolha outro.');
    }
    throw err;
  }

  await invalidateProductCache();
  void reply.status(200).send(successResponse(serializeProduct(product)));
}

export async function toggleProductStatusHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: ToggleStatusInput }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;

  const existing = await productRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Product');
  }

  const product = await productRepository.update(id, {
    isActive: request.body.isActive,
  });

  await invalidateProductCache();
  void reply.status(200).send(successResponse(serializeProduct(product)));
}

export async function deleteProductHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const { id } = request.params;

  const existing = await productRepository.findById(id);
  if (!existing) {
    throw new NotFoundError('Product');
  }

  if (existing.reservedStock > 0) {
    throw new ConflictError(
      'Não é possível excluir um produto com estoque reservado. Aguarde as reservas expirarem.',
    );
  }

  await productRepository.delete(id);

  await invalidateProductCache();
  void reply.status(204).send();
}
