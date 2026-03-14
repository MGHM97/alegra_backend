import { Prisma } from '@prisma/client';
import { prisma } from './prisma-client.js';
import type { OrderEntity, OrderWithProductsEntity } from '../../domain/entities/order.js';
import type {
  CreateOrderInput,
  OrderListFilters,
  OrderRepository,
} from '../../domain/repositories/order-repository.js';
import { InsufficientStockError } from '../../domain/errors/app-error.js';

const STOCK_RESERVATION_MINUTES = 15;

const orderInclude = {
  items: true,
} as const;

const orderWithProductsInclude = {
  items: {
    include: {
      product: {
        select: {
          name: true,
          slug: true,
          thumbnailUrl: true,
          images: true,
        },
      },
    },
  },
} as const;

export class PrismaOrderRepository implements OrderRepository {
  async findById(id: string): Promise<OrderEntity | null> {
    const order = await prisma.order.findUnique({
      where: { id },
      include: orderInclude,
    });
    return order as OrderEntity | null;
  }

  async findByIdWithProducts(id: string): Promise<OrderWithProductsEntity | null> {
    const order = await prisma.order.findUnique({
      where: { id },
      include: orderWithProductsInclude,
    });
    return order as OrderWithProductsEntity | null;
  }

  async findByIdempotencyKey(key: string): Promise<OrderEntity | null> {
    const order = await prisma.order.findUnique({
      where: { idempotencyKey: key },
      include: orderInclude,
    });
    return order as OrderEntity | null;
  }

  async findByUserId(userId: string): Promise<OrderEntity[]> {
    const orders = await prisma.order.findMany({
      where: { userId },
      include: orderInclude,
      orderBy: { createdAt: 'desc' },
    });
    return orders as OrderEntity[];
  }

  async findByUserIdWithProducts(
    userId: string,
    filters?: OrderListFilters,
  ): Promise<OrderWithProductsEntity[]> {
    const where: Prisma.OrderWhereInput = { userId };

    if (filters?.period) {
      const since = new Date();
      since.setMonth(since.getMonth() - filters.period);
      where.createdAt = { gte: since };
    }

    if (filters?.search) {
      const searchTerm = filters.search.trim();
      where.OR = [
        { id: { contains: searchTerm, mode: 'insensitive' } },
        { items: { some: { product: { name: { contains: searchTerm, mode: 'insensitive' } } } } },
      ];
    }

    const orders = await prisma.order.findMany({
      where,
      include: orderWithProductsInclude,
      orderBy: { createdAt: 'desc' },
    });
    return orders as unknown as OrderWithProductsEntity[];
  }

  async create(data: CreateOrderInput): Promise<OrderEntity> {
    const reservedUntil = new Date(Date.now() + STOCK_RESERVATION_MINUTES * 60 * 1000);

    const order = await prisma.$transaction(async (tx) => {
      for (const item of data.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, stock: true, reservedStock: true, price: true, name: true },
        });

        if (!product) {
          throw new InsufficientStockError(item.productId, 0, item.quantity);
        }

        const availableStock = product.stock - product.reservedStock;
        if (availableStock < item.quantity) {
          throw new InsufficientStockError(item.productId, availableStock, item.quantity);
        }

        if (product.price.toNumber() !== item.unitPrice) {
          throw new Error(
            `Price mismatch for product ${product.name}: expected ${product.price.toNumber()}, received ${item.unitPrice}`,
          );
        }

        await tx.product.update({
          where: { id: item.productId },
          data: { reservedStock: { increment: item.quantity } },
        });

        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            action: 'RESERVATION',
            quantity: item.quantity,
            reason: 'Order stock reservation',
          },
        });
      }

      const totalAmount = data.items.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0,
      );

      const newOrder = await tx.order.create({
        data: {
          userId: data.userId,
          status: 'RESERVED',
          totalAmount: new Prisma.Decimal(totalAmount),
          idempotencyKey: data.idempotencyKey,
          reservedUntil,
          notes: data.notes,
          items: {
            create: data.items.map((item) => ({
              productId: item.productId,
              quantity: item.quantity,
              unitPrice: new Prisma.Decimal(item.unitPrice),
              total: new Prisma.Decimal(item.unitPrice * item.quantity),
            })),
          },
        },
        include: orderInclude,
      });

      return newOrder;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 10000,
    });

    return order as OrderEntity;
  }
}
