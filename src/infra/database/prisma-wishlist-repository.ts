import { prisma } from './prisma-client.js';
import type {
  WishlistItem,
  WishlistItemWithProduct,
} from '../../domain/entities/wishlist-item.js';
import type { WishlistRepository } from '../../domain/repositories/wishlist-repository.js';

export class PrismaWishlistRepository implements WishlistRepository {
  async findByUserId(userId: string): Promise<WishlistItemWithProduct[]> {
    const records = await prisma.wishlistItem.findMany({
      where: { userId },
      include: { product: true },
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record) => ({
      id: record.id,
      userId: record.userId,
      productId: record.productId,
      createdAt: record.createdAt,
      product: {
        id: record.product.id,
        name: record.product.name,
        slug: record.product.slug,
        shortDescription: record.product.shortDescription,
        price: record.product.price.toNumber(),
        originalPrice: record.product.originalPrice
          ? record.product.originalPrice.toNumber()
          : null,
        currency: record.product.currency,
        category: record.product.category,
        thumbnailUrl: record.product.thumbnailUrl,
        badges: record.product.badges,
        stock: record.product.stock,
        reservedStock: record.product.reservedStock,
        availableStock: Math.max(
          record.product.stock - record.product.reservedStock,
          0,
        ),
        maxInstallments: record.product.maxInstallments,
        installmentPrice: record.product.installmentPrice
          ? record.product.installmentPrice.toNumber()
          : null,
        isActive: record.product.isActive,
      },
    }));
  }

  async findByUserAndProduct(
    userId: string,
    productId: string,
  ): Promise<WishlistItem | null> {
    const record = await prisma.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (!record) return null;
    return {
      id: record.id,
      userId: record.userId,
      productId: record.productId,
      createdAt: record.createdAt,
    };
  }

  async create(userId: string, productId: string): Promise<WishlistItem> {
    const record = await prisma.wishlistItem.create({
      data: { userId, productId },
    });
    return {
      id: record.id,
      userId: record.userId,
      productId: record.productId,
      createdAt: record.createdAt,
    };
  }

  async delete(userId: string, productId: string): Promise<void> {
    await prisma.wishlistItem.deleteMany({
      where: { userId, productId },
    });
  }
}
