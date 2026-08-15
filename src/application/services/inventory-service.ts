import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../../infra/database/prisma-client.js';
import { NotFoundError, InsufficientStockError, ConflictError } from '../../domain/errors/app-error.js';
import type { InventorySyncInput } from '../../presentation/schemas/inventory-schemas.js';
import type { OrderStatus } from '../../domain/entities/order.js';
import { releaseCouponUsage } from './coupon-service.js';
import { cacheInvalidatePattern } from '../../infra/cache/cache-utils.js';

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export interface SaleOrderItem {
  productId: string;
  quantity: number;
}

// Status em que o pedido ainda NÃO teve sua reserva convertida em venda
// (commitSale nunca rodou). Cancelar/estornar um pedido nesses status deve
// apenas liberar a reserva (reservedStock); em qualquer status posterior,
// stock físico já foi decrementado e precisa ser devolvido (stock).
const PRE_SALE_STATUSES: ReadonlySet<OrderStatus> = new Set(['PENDING', 'RESERVED']);

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

  /**
   * Ajusta o estoque físico de um produto para um valor absoluto (não um
   * delta), usado pela edição de produto no admin. Deve ser chamado dentro
   * da MESMA transação que persiste os demais campos do produto, para que a
   * checagem de `reservedStock` e a escrita do InventoryLog fiquem
   * atômicas com a atualização.
   *
   * Estoque nunca pode ficar abaixo da quantidade já reservada (pedidos
   * PENDING/RESERVED contam com aquele estoque) — reduzir abaixo disso
   * quebraria a garantia de "stock nunca fica negativo" na hora de
   * confirmar essas reservas.
   */
  async adjustStock(
    tx: TransactionClient,
    productId: string,
    newStock: number,
    reason: string,
  ): Promise<void> {
    const product = await tx.product.findUnique({
      where: { id: productId },
      select: { stock: true, reservedStock: true },
    });

    if (!product) {
      throw new NotFoundError('Product');
    }

    if (newStock < product.reservedStock) {
      throw new ConflictError(
        `Estoque não pode ser menor que a quantidade reservada (${product.reservedStock}).`,
      );
    }

    if (newStock === product.stock) {
      return;
    }

    await tx.product.update({
      where: { id: productId },
      data: { stock: newStock },
    });

    await tx.inventoryLog.create({
      data: {
        productId,
        action: 'ADJUSTMENT',
        quantity: Math.abs(newStock - product.stock),
        reason,
        metadata: { previousStock: product.stock, newStock },
      },
    });
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

  /**
   * Converte a reserva de estoque de um pedido em venda efetiva. Deve ser
   * chamado dentro da MESMA transação (idealmente Serializable) que muda o
   * status do pedido para CONFIRMED/PAID, garantindo que estoque e status
   * fiquem consistentes mesmo sob concorrência ou falha no meio do caminho.
   *
   * Para cada item: `stock -= quantity` e `reservedStock -= quantity`
   * (a reserva já havia incrementado reservedStock na criação do pedido).
   * O decremento é condicional (updateMany com guarda de quantidade) para
   * que o estoque jamais fique negativo, mesmo em cenários inesperados.
   */
  async commitSale(
    tx: TransactionClient,
    orderId: string,
    items: SaleOrderItem[],
  ): Promise<void> {
    for (const item of items) {
      const result = await tx.product.updateMany({
        where: {
          id: item.productId,
          stock: { gte: item.quantity },
          reservedStock: { gte: item.quantity },
        },
        data: {
          stock: { decrement: item.quantity },
          reservedStock: { decrement: item.quantity },
          // Agregado denormalizado para o card "★ 4.9 · +100 vendidos" —
          // mesma transação Serializable que efetiva a venda, então nunca
          // fica dessincronizado do estoque físico.
          soldCount: { increment: item.quantity },
        },
      });

      if (result.count === 0) {
        throw new InsufficientStockError(item.productId, 0, item.quantity);
      }

      await tx.inventoryLog.create({
        data: {
          productId: item.productId,
          action: 'SALE',
          quantity: item.quantity,
          reason: `Sale committed for order ${orderId}`,
        },
      });
    }
  }

  /**
   * Reverte o efeito de um pedido no estoque ao ser cancelado/estornado,
   * escolhendo o ramo correto conforme o status de ORIGEM (`fromStatus`) do
   * pedido — o status em que ele estava antes da transição de
   * cancelamento/estorno ser reivindicada:
   *
   * - Pré-venda (PENDING/RESERVED): a reserva nunca virou venda (commitSale
   *   não rodou). Libera a reserva: `reservedStock -= qty`,
   *   InventoryLog.action = RESERVATION_RELEASE.
   * - Pós-venda (CONFIRMED/PROCESSING/SHIPPED/DELIVERED): commitSale já
   *   decrementou `stock` e `reservedStock` na confirmação do pagamento.
   *   Devolve ao estoque físico: `stock += qty`, sem tocar reservedStock.
   *   InventoryLog.action = RESTOCK.
   *
   * Chame dentro da MESMA transação que reivindica a transição de status.
   */
  async releaseOrderStock(
    tx: TransactionClient,
    orderId: string,
    items: SaleOrderItem[],
    fromStatus: OrderStatus,
    reason: string,
  ): Promise<void> {
    const isPreSale = PRE_SALE_STATUSES.has(fromStatus);

    for (const item of items) {
      if (isPreSale) {
        await tx.product.update({
          where: { id: item.productId },
          data: { reservedStock: { decrement: item.quantity } },
        });

        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            action: 'RESERVATION_RELEASE',
            quantity: item.quantity,
            reason,
          },
        });
      } else {
        await tx.product.update({
          where: { id: item.productId },
          data: {
            stock: { increment: item.quantity },
            // Contrapartida do increment em commitSale: este ramo só roda
            // pós-venda (commitSale já rodou para este pedido), então
            // sempre existe um increment correspondente a desfazer aqui.
            soldCount: { decrement: item.quantity },
          },
        });

        await tx.inventoryLog.create({
          data: {
            productId: item.productId,
            action: 'RESTOCK',
            quantity: item.quantity,
            reason,
            metadata: { orderId, restockedFromStatus: fromStatus },
          },
        });
      }
    }
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

    if (released > 0) {
      // Fora de cada transação por pedido e best-effort (Redis não é
      // transacional com o Postgres): uma invalidação por execução do job
      // basta, mesmo liberando várias reservas expiradas de uma vez.
      await cacheInvalidatePattern('products:*');
    }

    return released;
  }
}
