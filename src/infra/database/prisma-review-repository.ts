import { prisma } from './prisma-client.js';
import type {
  AdminReviewListFilters,
  AdminReviewListResult,
  ReviewEntity,
  ReviewWithRelations,
} from '../../domain/entities/review.js';
import type {
  CreateReviewInput,
  ReviewRepository,
} from '../../domain/repositories/review-repository.js';

const DEFAULT_ADMIN_LIMIT = 20;
const MAX_ADMIN_LIMIT = 100;

export class PrismaReviewRepository implements ReviewRepository {
  async findByProductId(productId: string): Promise<ReviewEntity[]> {
    return prisma.review.findMany({
      where: { productId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByProductSlug(slug: string): Promise<ReviewEntity[]> {
    return prisma.review.findMany({
      where: { product: { slug } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByUserId(userId: string): Promise<ReviewEntity[]> {
    return prisma.review.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findById(id: string): Promise<ReviewEntity | null> {
    return prisma.review.findUnique({ where: { id } });
  }

  async findByUserAndProduct(
    userId: string,
    productId: string,
  ): Promise<ReviewEntity | null> {
    return prisma.review.findUnique({
      where: { userId_productId: { userId, productId } },
    });
  }

  async create(data: CreateReviewInput): Promise<ReviewEntity> {
    return prisma.review.create({
      data: {
        userId: data.userId,
        productId: data.productId,
        userName: data.userName,
        rating: data.rating,
        comment: data.comment,
        photos: data.photos ?? [],
        isVerifiedPurchase: data.isVerifiedPurchase ?? false,
      },
    });
  }

  async delete(id: string): Promise<void> {
    await prisma.review.delete({ where: { id } });
  }

  async listAdmin(filters: AdminReviewListFilters): Promise<AdminReviewListResult> {
    const limit = Math.min(
      Math.max(1, filters.limit ?? DEFAULT_ADMIN_LIMIT),
      MAX_ADMIN_LIMIT,
    );

    const where: Record<string, unknown> = {};
    if (filters.productId) {
      where.productId = filters.productId;
    }
    if (filters.userId) {
      where.userId = filters.userId;
    }
    if (typeof filters.rating === 'number') {
      where.rating = filters.rating;
    }
    if (filters.search && filters.search.trim().length > 0) {
      where.comment = { contains: filters.search.trim(), mode: 'insensitive' };
    }

    const rows = await prisma.review.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit + 1,
      ...(filters.cursor
        ? {
            cursor: { id: filters.cursor },
            skip: 1,
          }
        : {}),
      include: {
        user: { select: { id: true, name: true, email: true } },
        product: {
          select: { id: true, name: true, slug: true, thumbnailUrl: true },
        },
      },
    });

    const hasMore = rows.length > limit;
    const slice = hasMore ? rows.slice(0, limit) : rows;
    const last = slice[slice.length - 1];
    const nextCursor = hasMore && last ? last.id : null;

    const data: ReviewWithRelations[] = slice.map((r) => ({
      id: r.id,
      userId: r.userId,
      productId: r.productId,
      userName: r.userName,
      rating: r.rating,
      comment: r.comment,
      photos: r.photos,
      isVerifiedPurchase: r.isVerifiedPurchase,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      user: r.user,
      product: r.product,
    }));

    return { data, nextCursor, hasMore };
  }
}
