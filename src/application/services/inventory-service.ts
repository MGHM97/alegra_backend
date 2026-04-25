import { Prisma } from '@prisma/client';
import { prisma } from '../../infra/database/prisma-client.js';
import { NotFoundError, InsufficientStockError } from '../../domain/errors/app-error.js';
import type { InventorySyncInput } from '../../presentation/schemas/inventory-schemas.js';
import { releaseCouponUsage } from './coupon-service.js';

interface StockInfo {
  productId: string;
  sku: string;
  name: string;
  stock: number;
  reservedStock: number;
  availableStock: number;
}

interface SyncResult {
  updated: number;
  items: Array<{
    productId: string;
    previousStock: number;
    newStock: number;
  }>;
}

export class InventoryService {
  async fetchStock(productId: string): Promise<StockInfo> {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        sku: true,
        name: true,
        stock: true,
        reservedStock: true,
      },
    });

    if (!product) {
      throw new NotFoundError('Product');
    }

    return {
      productId: product.id,
      sku: product.sku,
      name: product.name,
      stock: product.stock,
      reservedStock: product.reservedStock,
      availableStock: product.stock - product.reservedStock,
    };
  }

  async updateStock(
    productId: string,
    quantityChange: number,
    reason: string,
  ): Promise<StockInfo> {
    const result = await prisma.$transaction(async (tx) => {
      const product = await tx.product.findUnique({
        where: { id: productId },
        select: { id: true, sku: true, name: true, stock: true, reservedStock: true },
      });

      if (!product) {
        throw new NotFoundError('Product');
      }

      const newStock = product.stock + quantityChange;
      if (newStock < 0) {
        throw new InsufficientStockError(productId, product.stock, Math.abs(quantityChange));
      }

      // Ensure stock never goes below reserved
      if (newStock < product.reservedStock) {
        throw new InsufficientStockError(
          productId,
          product.stock - product.reservedStock,
          Math.abs(quantityChange),
        );
      }

      await tx.product.update({
        where: { id: productId },
        data: { stock: newStock },
      });

      const action = quantityChange > 0 ? 'RESTOCK' : 'ADJUSTMENT';
      await tx.inventoryLog.create({
        data: {
          productId,
          action,
          quantity: Math.abs(quantityChange),
          reason,
          metadata: { previousStock: product.stock, newStock },
        },
      });

      return {
        productId: product.id,
        sku: product.sku,
        name: product.name,
        stock: newStock,
        reservedStock: product.reservedStock,
        availableStock: newStock - product.reservedStock,
      };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 5000,
    });

    return result;
  }

  async syncInventory(input: InventorySyncInput): Promise<SyncResult> {
    const result = await prisma.$transaction(async (tx) => {
      const updatedItems: SyncResult['items'] = [];

      for (const item of input.items) {
        const product = await tx.product.findUnique({
          where: { id: item.productId },
          select: { id: true, stock: true, reservedStock: true },
        });

        if (!product) {
          throw new NotFoundError(`Product ${item.productId}`);
        }

        // Cannot set stock below reserved amount
        if (item.stock < product.reservedStock) {
          throw new InsufficientStockError(
            item.productId,
            product.reservedStock,
            item.stock,
          );
        }

        await tx.product.update({
          where: { id: item.productId },
          data: { stock: item.stock },
        });

        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            action: 'SYNC',
            quantity: Math.abs(item.stock - product.stock),
            reason: item.reason ?? 'Admin inventory sync',
            metadata: {
              previousStock: product.stock,
              newStock: item.stock,
            },
          },
        });

        updatedItems.push({
          productId: item.productId,
          previousStock: product.stock,
          newStock: item.stock,
        });
      }

      return { updated: updatedItems.length, items: updatedItems };
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15000,
    });

    return result;
  }

  async releaseExpiredReservations(): Promise<number> {
    const now = new Date();

    const expiredOrders = await prisma.order.findMany({
      where: {
        status: 'RESERVED',
        reservedUntil: { lt: now },
      },
      include: { items: true },
    });

    let released = 0;

    for (const order of expiredOrders) {
      await prisma.$transaction(async (tx) => {
        for (const item of order.items) {
          await tx.product.update({
            where: { id: item.productId },
            data: { reservedStock: { decrement: item.quantity } },
          });

          await tx.inventoryLog.create({
            data: {
              productId: item.productId,
              action: 'RESERVATION_RELEASE',
              quantity: item.quantity,
              reason: `Expired reservation for order ${order.id}`,
            },
          });
        }

        if (order.couponId) {
          await releaseCouponUsage(tx, order.couponId);
        }

        await tx.order.update({
          where: { id: order.id },
          data: { status: 'CANCELLED' },
        });
      });

      released++;
    }

    return released;
  }
}
