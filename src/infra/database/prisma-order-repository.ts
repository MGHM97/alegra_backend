import { Prisma } from '@prisma/client';
import { prisma } from './prisma-client.js';
import type { OrderEntity, OrderWithProductsEntity } from '../../domain/entities/order.js';
import type {
  CreateOrderInput,
  OrderListFilters,
  OrderRepository,
} from '../../domain/repositories/order-repository.js';
import { InsufficientStockError, PriceMismatchError } from '../../domain/errors/app-error.js';
import {
  assertCouponUsable,
  computeDiscount,
  normalizeCouponCode,
  reserveCouponUsage,
} from '../../application/services/coupon-service.js';
import type { Coupon } from '../../domain/entities/coupon.js';
import { computeInstallmentFee } from '../../shared/utils/installments.js';
import { cacheInvalidatePattern } from '../../infra/cache/cache-utils.js';

const STOCK_RESERVATION_MINUTES = 15;

/**
 * Verifica se um PrismaClientKnownRequestError é uma violação de unique
 * constraint (P2002) sobre o campo indicado. O formato de `meta.target`
 * varia entre versões do engine (array de nomes de campo ou string com o
 * nome da constraint), então checamos as duas formas.
 */
function isUniqueConstraintViolation(err: unknown, fieldNameHint: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }
  const target = err.meta?.target;
  const hint = fieldNameHint.toLowerCase();
  if (Array.isArray(target)) {
    return target.some((t) => typeof t === 'string' && t.toLowerCase().includes(hint));
  }
  if (typeof target === 'string') {
    return target.toLowerCase().includes(hint);
  }
  return false;
}

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
    // A janela de reserva DEVE cobrir o prazo de pagamento, senão o job de
    // cleanup libera o estoque enquanto o cliente ainda pode pagar (PIX 30min,
    // boleto dias) — gerando oversell e pedidos "pagos porém cancelados".
    // Cartão é cobrado na hora, então 15min basta.
    let reservedUntil = new Date(Date.now() + STOCK_RESERVATION_MINUTES * 60 * 1000);
    if (data.paymentMethod === 'PIX' && data.pixExpiresAt) {
      reservedUntil = new Date(data.pixExpiresAt);
    } else if (data.paymentMethod === 'BOLETO' && data.boletoExpiresAt) {
      reservedUntil = new Date(data.boletoExpiresAt);
    }

    // Pre-fetch the coupon outside the transaction for early validation.
    // The atomic reservation (reserveCouponUsage) still happens inside
    // the transaction below to guarantee consistency under concurrency.
    let preCoupon: Coupon | null = null;
    if (data.couponCode) {
      const normalized = normalizeCouponCode(data.couponCode);
      const record = await prisma.coupon.findUnique({ where: { code: normalized } });
      if (record) {
        preCoupon = {
          id: record.id,
          code: record.code,
          discountType: record.discountType as Coupon['discountType'],
          discountValue: record.discountValue.toNumber(),
          maxUses: record.maxUses,
          usedCount: record.usedCount,
          validFrom: record.validFrom,
          validUntil: record.validUntil,
          minOrderAmount: record.minOrderAmount ? record.minOrderAmount.toNumber() : null,
          description: record.description,
          isActive: record.isActive,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
        };
      }
    }

    const createOrderTx = () => prisma.$transaction(async (tx) => {
      // Preço efetivamente cobrado por item — sempre o do banco, nunca o do
      // cliente. Quando o cliente ainda envia unitPrice (compat), ele é só
      // validado contra o banco (divergência = PriceMismatchError); o valor
      // gravado no pedido vem sempre de `resolvedItems[i].unitPrice`.
      const resolvedItems: Array<{ productId: string; quantity: number; unitPrice: number }> = [];

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

        const dbPrice = product.price.toNumber();
        if (item.unitPrice !== undefined && dbPrice !== item.unitPrice) {
          throw new PriceMismatchError();
        }
        resolvedItems.push({ productId: item.productId, quantity: item.quantity, unitPrice: dbPrice });

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

      const subtotal = resolvedItems.reduce(
        (sum, item) => sum + item.unitPrice * item.quantity,
        0,
      );

      // Apply coupon — revalidates server-side and reserves the usage slot
      // inside the same transaction. If the coupon hits maxUses concurrently,
      // reserveCouponUsage throws CouponError('COUPON_MAX_USES') and rolls
      // back the entire order (including stock reservations).
      let discountAmount = 0;
      let couponId: string | null = null;
      let couponCode: string | null = null;

      if (data.couponCode) {
        assertCouponUsable(preCoupon, subtotal);
        discountAmount = computeDiscount(subtotal, preCoupon);
        await reserveCouponUsage(tx, preCoupon.id);
        couponId = preCoupon.id;
        couponCode = preCoupon.code;
      }

      const shippingCost = data.shippingCost ?? 0;
      const totalAmount =
        Math.round((subtotal - discountAmount + shippingCost) * 100) / 100;

      // Juros de parcelamento (acima de 3x no cartão). Gravados no pedido para
      // que totalAmount + installmentFee == valor cobrado pela Stripe — sem
      // discrepância contábil entre o pedido e a cobrança.
      const installments = data.installments ?? 1;
      const installmentFee = computeInstallmentFee(
        totalAmount,
        data.paymentMethod,
        installments,
      );

      const newOrder = await tx.order.create({
        data: {
          userId: data.userId,
          status: 'RESERVED',
          totalAmount: new Prisma.Decimal(totalAmount),
          installments,
          installmentFee:
            installmentFee > 0 ? new Prisma.Decimal(installmentFee) : null,
          idempotencyKey: data.idempotencyKey,
          paymentIntentId: data.paymentIntentId,
          reservedUntil,
          notes: data.notes,
          couponId,
          couponCode,
          discountAmount: discountAmount > 0 ? new Prisma.Decimal(discountAmount) : null,
          paymentMethod: data.paymentMethod,
          paymentStatus: data.paymentStatus,
          savedCardId: data.savedCardId,
          shippingMethodName: data.shippingMethodName,
          shippingCarrier: data.shippingCarrier,
          shippingCost: shippingCost > 0 ? new Prisma.Decimal(shippingCost) : null,
          ...(data.shippingAddress && {
            shippingName: data.shippingAddress.recipientName,
            shippingStreet: data.shippingAddress.street,
            shippingNumber: data.shippingAddress.number,
            shippingComplement: data.shippingAddress.complement,
            shippingNeighborhood: data.shippingAddress.neighborhood,
            shippingCity: data.shippingAddress.city,
            shippingState: data.shippingAddress.state,
            shippingZipCode: data.shippingAddress.zipCode,
          }),
          pixQrCode: data.pixQrCode,
          pixQrCodeText: data.pixQrCodeText,
          pixExpiresAt: data.pixExpiresAt,
          boletoUrl: data.boletoUrl,
          boletoBarcode: data.boletoBarcode,
          boletoExpiresAt: data.boletoExpiresAt,
          items: {
            create: resolvedItems.map((item) => ({
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

    // Retry em falhas de serialização (P2034). Sob Serializable, duas
    // transações concorrentes sobre o mesmo produto podem abortar uma à outra;
    // reexecutamos até 3x antes de propagar, em vez de devolver 500 ao cliente.
    const order = await (async (): Promise<OrderEntity> => {
      for (let attempt = 1; ; attempt++) {
        try {
          const created = await createOrderTx();
          // Best-effort, FORA da transação (Redis não é transacional com o
          // Postgres): a reserva de estoque já commitou, então a listagem/
          // detalhe de produto em cache pode estar mostrando availableStock
          // desatualizado até isto rodar. Falha aqui nunca derruba o pedido.
          await cacheInvalidatePattern('products:*');
          return created as OrderEntity;
        } catch (err) {
          const isSerializationFailure =
            err instanceof Prisma.PrismaClientKnownRequestError &&
            err.code === 'P2034';
          if (isSerializationFailure && attempt < 3) {
            continue;
          }

          // Corrida na idempotency key: duas requisições concorrentes com a
          // mesma Idempotency-Key passam ambas pelo check prévio (não
          // atômico) do controller e tentam criar o pedido. A constraint
          // UNIQUE do banco barra a segunda com P2002 — em vez de propagar
          // um 500, devolvemos o pedido que já existe (mesmo comportamento
          // do caminho feliz de idempotência).
          if (data.idempotencyKey && isUniqueConstraintViolation(err, 'idempotency')) {
            const existing = await this.findByIdempotencyKey(data.idempotencyKey);
            if (existing) {
              return existing;
            }
          }

          throw err;
        }
      }
    })();

    return order;
  }
}
