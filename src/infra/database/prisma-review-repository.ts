import { prisma } from './prisma-client.js';
import type { ReviewEntity } from '../../domain/entities/review.js';
import type {
  ReviewRepository,
  CreateReviewInput,
} from '../../domain/repositories/review-repository.js';

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

  async create(data: CreateReviewInput): Promise<ReviewEntity> {
    return prisma.review.create({
      data: {
        userId: data.userId,
        productId: data.productId,
        userName: data.userName,
        rating: data.rating,
        comment: data.comment,
        photos: data.photos ?? [],
      },
    });
  }
}
