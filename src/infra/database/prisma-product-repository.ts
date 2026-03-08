import type { Prisma } from '@prisma/client';
import { prisma } from './prisma-client.js';
import type { ProductEntity, ProductListItem } from '../../domain/entities/product.js';
import type {
  CursorPaginationParams,
  PaginatedResult,
  ProductFilters,
  ProductRepository,
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
}
