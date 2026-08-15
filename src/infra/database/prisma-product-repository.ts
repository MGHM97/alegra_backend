import { Prisma } from '@prisma/client';
import { prisma } from './prisma-client.js';
import type { ProductEntity, ProductListItem, ProductSort } from '../../domain/entities/product.js';
import type {
  CreateProductInput,
  CursorPaginationParams,
  PaginatedResult,
  ProductFilters,
  ProductRepository,
  UpdateProductInput,
} from '../../domain/repositories/product-repository.js';
import { InventoryService } from '../../application/services/inventory-service.js';
import {
  decodeProductCursor,
  encodeProductCursor,
  expectNumberCursorValue,
  expectNumberOrNullCursorValue,
  expectStringCursorValue,
} from './product-list-cursor.js';

const inventoryService = new InventoryService();

// Row shape fetched internally to build both the public ProductListItem AND
// the outgoing pagination cursor. createdAt and discountPercent are NOT part
// of ProductListItem's public contract — they're stripped in `toListItem`
// before the response leaves the repository, so they never leak into
// GET /v1/products' JSON payload.
const PRODUCT_LIST_SELECT = {
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
  averageRating: true,
  reviewCount: true,
  soldCount: true,
  createdAt: true,
  discountPercent: true,
} as const;

type ProductListRow = Prisma.ProductGetPayload<{ select: typeof PRODUCT_LIST_SELECT }>;

function toListItem(row: ProductListRow): ProductListItem {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    shortDescription: row.shortDescription,
    price: row.price,
    originalPrice: row.originalPrice,
    currency: row.currency,
    category: row.category,
    thumbnailUrl: row.thumbnailUrl,
    badges: row.badges,
    stock: row.stock,
    reservedStock: row.reservedStock,
    maxInstallments: row.maxInstallments,
    installmentPrice: row.installmentPrice,
    isActive: row.isActive,
    averageRating: row.averageRating,
    reviewCount: row.reviewCount,
    soldCount: row.soldCount,
  };
}

/**
 * `relevance` has no ranking signal of its own today (no full-text-search
 * rank column, `search` just does ILIKE) — it always resolves to the same
 * ordering as `newest`, matching the fixed `createdAt desc` the API used
 * before server-side sort existed (including while searching).
 */
function resolveEffectiveSort(sort: ProductSort | undefined): Exclude<ProductSort, 'relevance'> {
  if (sort === undefined || sort === 'relevance') return 'newest';
  return sort;
}

function buildOrderBy(sort: Exclude<ProductSort, 'relevance'>): Prisma.ProductOrderByWithRelationInput[] {
  switch (sort) {
    case 'price_asc':
      return [{ price: 'asc' }, { id: 'asc' }];
    case 'price_desc':
      return [{ price: 'desc' }, { id: 'desc' }];
    case 'best_sellers':
      return [{ soldCount: 'desc' }, { id: 'desc' }];
    case 'discount':
      return [{ discountPercent: 'desc' }, { id: 'desc' }];
    case 'top_rated':
      return [{ averageRating: { sort: 'desc', nulls: 'last' } }, { reviewCount: 'desc' }, { id: 'desc' }];
    case 'newest':
      return [{ createdAt: 'desc' }, { id: 'desc' }];
  }
}

// --- Keyset (cursor) WHERE builders, one per sort shape ---------------
//
// Every sort orders by `id` last, so these mirror `buildOrderBy` exactly:
// "strictly past the boundary row" = "primary column strictly past `v`" OR
// "primary column tied with `v` AND id strictly past the boundary id".

function newestCursorWhere(value: Date, id: string): Prisma.ProductWhereInput {
  return { OR: [{ createdAt: { lt: value } }, { createdAt: value, id: { lt: id } }] };
}

function priceCursorWhere(value: number, id: string, direction: 'asc' | 'desc'): Prisma.ProductWhereInput {
  if (direction === 'asc') {
    return { OR: [{ price: { gt: value } }, { price: value, id: { gt: id } }] };
  }
  return { OR: [{ price: { lt: value } }, { price: value, id: { lt: id } }] };
}

function soldCountCursorWhere(value: number, id: string): Prisma.ProductWhereInput {
  return { OR: [{ soldCount: { lt: value } }, { soldCount: value, id: { lt: id } }] };
}

function discountCursorWhere(value: number, id: string): Prisma.ProductWhereInput {
  return { OR: [{ discountPercent: { lt: value } }, { discountPercent: value, id: { lt: id } }] };
}

/**
 * top_rated orders by (averageRating desc NULLS LAST, reviewCount desc, id
 * desc) — see the `v2`/secondaryValue comment in product-list-cursor.ts for
 * why the cursor carries reviewCount alongside averageRating.
 *
 * averageRating is null iff reviewCount is 0 (see schema.prisma comment on
 * Product.averageRating), so once the boundary is already inside the NULLS
 * bucket, reviewCount can't discriminate further — only `id` can.
 */
function topRatedCursorWhere(value: number | null, secondaryValue: number | null, id: string): Prisma.ProductWhereInput {
  if (value === null) {
    return { OR: [{ averageRating: null, id: { lt: id } }] };
  }
  const reviewCount = secondaryValue ?? 0;
  return {
    OR: [
      { averageRating: { lt: value } },
      { averageRating: null },
      { averageRating: value, reviewCount: { lt: reviewCount } },
      { averageRating: value, reviewCount, id: { lt: id } },
    ],
  };
}

function buildCursorWhere(
  sort: Exclude<ProductSort, 'relevance'>,
  value: string | number | null,
  secondaryValue: number | null,
  id: string,
): Prisma.ProductWhereInput {
  switch (sort) {
    case 'price_asc':
      return priceCursorWhere(expectNumberCursorValue(value), id, 'asc');
    case 'price_desc':
      return priceCursorWhere(expectNumberCursorValue(value), id, 'desc');
    case 'best_sellers':
      return soldCountCursorWhere(expectNumberCursorValue(value), id);
    case 'discount':
      return discountCursorWhere(expectNumberCursorValue(value), id);
    case 'top_rated':
      return topRatedCursorWhere(expectNumberOrNullCursorValue(value), secondaryValue, id);
    case 'newest':
      return newestCursorWhere(new Date(expectStringCursorValue(value)), id);
  }
}

function encodeCursorForRow(sort: Exclude<ProductSort, 'relevance'>, row: ProductListRow): string {
  switch (sort) {
    case 'price_asc':
    case 'price_desc':
      return encodeProductCursor(row.price.toNumber(), row.id);
    case 'best_sellers':
      return encodeProductCursor(row.soldCount, row.id);
    case 'discount':
      return encodeProductCursor(row.discountPercent ? row.discountPercent.toNumber() : 0, row.id);
    case 'top_rated':
      return encodeProductCursor(
        row.averageRating ? row.averageRating.toNumber() : null,
        row.id,
        row.averageRating ? row.reviewCount : undefined,
      );
    case 'newest':
      return encodeProductCursor(row.createdAt.toISOString(), row.id);
  }
}

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

    // Total independe do cursor (é sempre "quantos produtos casam esses
    // filtros", não "quantos restam a partir daqui") — dispara em paralelo
    // com a resolução do cursor/findMany abaixo em vez de esperar por eles.
    const totalPromise = prisma.product.count({ where });

    let effectiveSort = resolveEffectiveSort(filters.sort);
    let cursorWhere: Prisma.ProductWhereInput | undefined;

    if (pagination.cursor) {
      const decoded = decodeProductCursor(pagination.cursor);

      if (decoded.legacy) {
        // Pre-sort clients pass a bare product id and always expect
        // createdAt-desc pagination — resolve it to a `newest` cursor
        // regardless of the `sort` the (old) client happens to send.
        const legacyProduct = await prisma.product.findUnique({
          where: { id: decoded.id },
          select: { createdAt: true },
        });
        if (!legacyProduct) {
          // Referenced row no longer exists (deleted between page loads) —
          // degrade to "no more results" instead of erroring. `total` still
          // reflects the filters (it never depended on the cursor).
          return { items: [], cursor: null, hasMore: false, total: await totalPromise };
        }
        effectiveSort = 'newest';
        cursorWhere = newestCursorWhere(legacyProduct.createdAt, decoded.id);
      } else {
        cursorWhere = buildCursorWhere(effectiveSort, decoded.value, decoded.secondaryValue, decoded.id);
      }
    }

    const finalWhere: Prisma.ProductWhereInput = cursorWhere ? { AND: [where, cursorWhere] } : where;
    const take = pagination.limit + 1;

    const [rows, total] = await Promise.all([
      prisma.product.findMany({
        where: finalWhere,
        take,
        orderBy: buildOrderBy(effectiveSort),
        select: PRODUCT_LIST_SELECT,
      }),
      totalPromise,
    ]);

    const hasMore = rows.length > pagination.limit;
    const pageRows = hasMore ? rows.slice(0, pagination.limit) : rows;
    const lastRow = pageRows[pageRows.length - 1];
    const cursor = hasMore && lastRow ? encodeCursorForRow(effectiveSort, lastRow) : null;

    return { items: pageRows.map(toListItem), cursor, hasMore, total };
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
        videoUrl: data.videoUrl ?? null,
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
    if (data.sku !== undefined) updateData.sku = data.sku;
    if (data.weight !== undefined) updateData.weight = data.weight;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.maxInstallments !== undefined) updateData.maxInstallments = data.maxInstallments;
    if (data.installmentPrice !== undefined) updateData.installmentPrice = data.installmentPrice;
    if (data.videoUrl !== undefined) updateData.videoUrl = data.videoUrl;

    // stock é tratado à parte: precisa validar contra reservedStock e gravar
    // InventoryLog na MESMA transação que aplica os demais campos, para que
    // a edição de produto nunca deixe o estoque abaixo do que já está
    // reservado por pedidos PENDING/RESERVED.
    if (data.stock !== undefined) {
      const stock = data.stock;
      const product = await prisma.$transaction(
        async (tx) => {
          await inventoryService.adjustStock(tx, id, stock, 'Ajuste manual via edição de produto');
          return tx.product.update({
            where: { id },
            data: updateData,
          });
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 5000,
        },
      );
      return product as unknown as ProductEntity;
    }

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
