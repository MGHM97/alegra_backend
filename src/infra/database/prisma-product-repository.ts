import type { Prisma } from '@prisma/client';
import { prisma } from './prisma-client.js';
import type { ProductEntity, ProductListItem } from '../../domain/entities/product.js';
import type {
  CreateProductInput,
  CursorPaginationParams,
  PaginatedResult,
  ProductFilters,
  ProductRepository,
  UpdateProductInput,
} from '../../domain/repositories/product-repository.js';

export class PrismaProductRepository implements ProductRepository {
  async findById(id: string): Promise<ProductEntity | null> {
    const product = await prisma.product.findUnique({ where: { id } });
    return product as ProductEntity | null;
  }

  async findBySlug(slug: string): Promise<ProductEntity | null> {
    const product = await prisma.product.findUnique({ where: { slug } });
    return product as ProductEntity | null;
  }

  async findMany(
    filters: ProductFilters,
    pagination: CursorPaginationParams,
  ): Promise<PaginatedResult<ProductListItem>> {
    const where: Prisma.ProductWhereInput = {};

    if (filters.category) {
      where.category = filters.category;
    }

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
      where.price = {};
      if (filters.minPrice !== undefined) {
        where.price.gte = filters.minPrice;
      }
      if (filters.maxPrice !== undefined) {
        where.price.lte = filters.maxPrice;
      }
    }

    if (filters.badges && filters.badges.length > 0) {
      where.badges = { hasSome: filters.badges };
    }

    const take = pagination.limit + 1;

    const products = await prisma.product.findMany({
      where,
      take,
      ...(pagination.cursor ? { cursor: { id: pagination.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        shortDescription: true,
        price: true,
        originalPrice: true,
        currency: true,
        category: true,
        thumbnailUrl: true,
        badges: true,
        stock: true,
        reservedStock: true,
        maxInstallments: true,
        installmentPrice: true,
        isActive: true,
      },
    });

    const hasMore = products.length > pagination.limit;
    const items = hasMore ? products.slice(0, pagination.limit) : products;
    const lastItem = items[items.length - 1];
    const cursor = hasMore && lastItem ? lastItem.id : null;

    return { items, cursor, hasMore };
  }

  async getAvailableStock(productId: string): Promise<number> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { stock: true, reservedStock: true },
    });

    if (!product) return 0;
    return product.stock - product.reservedStock;
  }

  async create(data: CreateProductInput): Promise<ProductEntity> {
    const product = await prisma.product.create({
      data: {
        name: data.name,
        slug: data.slug,
        description: data.description,
        shortDescription: data.shortDescription,
        price: data.price,
        originalPrice: data.originalPrice ?? null,
        currency: data.currency ?? 'BRL',
        category: data.category,
        subcategory: data.subcategory ?? null,
        images: data.images,
        thumbnailUrl: data.thumbnailUrl,
        badges: data.badges ?? [],
        specifications: (data.specifications ?? {}) as Prisma.InputJsonValue,
        stock: data.stock,
        sku: data.sku,
        weight: data.weight,
        isActive: data.isActive ?? true,
        maxInstallments: data.maxInstallments ?? 1,
        installmentPrice: data.installmentPrice ?? null,
      },
    });
    return product as unknown as ProductEntity;
  }

  async update(id: string, data: UpdateProductInput): Promise<ProductEntity> {
    const updateData: Prisma.ProductUpdateInput = {};

    if (data.name !== undefined) updateData.name = data.name;
    if (data.slug !== undefined) updateData.slug = data.slug;
    if (data.description !== undefined) updateData.description = data.description;
    if (data.shortDescription !== undefined) updateData.shortDescription = data.shortDescription;
    if (data.price !== undefined) updateData.price = data.price;
    if (data.originalPrice !== undefined) updateData.originalPrice = data.originalPrice;
    if (data.currency !== undefined) updateData.currency = data.currency;
    if (data.category !== undefined) updateData.category = data.category;
    if (data.subcategory !== undefined) updateData.subcategory = data.subcategory;
    if (data.images !== undefined) updateData.images = data.images;
    if (data.thumbnailUrl !== undefined) updateData.thumbnailUrl = data.thumbnailUrl;
    if (data.badges !== undefined) updateData.badges = data.badges;
    if (data.specifications !== undefined) updateData.specifications = data.specifications as Prisma.InputJsonValue;
    if (data.stock !== undefined) updateData.stock = data.stock;
    if (data.sku !== undefined) updateData.sku = data.sku;
    if (data.weight !== undefined) updateData.weight = data.weight;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.maxInstallments !== undefined) updateData.maxInstallments = data.maxInstallments;
    if (data.installmentPrice !== undefined) updateData.installmentPrice = data.installmentPrice;

    const product = await prisma.product.update({
      where: { id },
      data: updateData,
    });
    return product as unknown as ProductEntity;
  }

  async delete(id: string): Promise<void> {
    await prisma.product.delete({ where: { id } });
  }
}
