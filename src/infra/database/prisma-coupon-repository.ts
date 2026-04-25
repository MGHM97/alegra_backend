import type { Prisma, Coupon as PrismaCoupon } from '@prisma/client';
import { prisma } from './prisma-client.js';
import type { Coupon, CouponDiscountType } from '../../domain/entities/coupon.js';
import type {
  CouponListFilters,
  CouponListResult,
  CouponRepository,
  CreateCouponInput,
  UpdateCouponInput,
} from '../../domain/repositories/coupon-repository.js';

function mapCoupon(record: PrismaCoupon): Coupon {
  return {
    id: record.id,
    code: record.code,
    discountType: record.discountType as CouponDiscountType,
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

export class PrismaCouponRepository implements CouponRepository {
  async findById(id: string): Promise<Coupon | null> {
    const record = await prisma.coupon.findUnique({ where: { id } });
    return record ? mapCoupon(record) : null;
  }

  async findByCode(code: string): Promise<Coupon | null> {
    const record = await prisma.coupon.findUnique({ where: { code } });
    return record ? mapCoupon(record) : null;
  }

  async list(filters: CouponListFilters): Promise<CouponListResult> {
    const where: Prisma.CouponWhereInput = {};

    if (filters.isActive !== undefined) {
      where.isActive = filters.isActive;
    }

    if (filters.search) {
      where.code = { contains: filters.search, mode: 'insensitive' };
    }

    const take = filters.limit + 1;

    const records = await prisma.coupon.findMany({
      where,
      take,
      ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });

    const hasMore = records.length > filters.limit;
    const data = hasMore ? records.slice(0, filters.limit) : records;
    const lastItem = data[data.length - 1];
    const nextCursor = hasMore && lastItem ? lastItem.id : null;

    return {
      data: data.map(mapCoupon),
      nextCursor,
      hasMore,
    };
  }

  async create(input: CreateCouponInput): Promise<Coupon> {
    const record = await prisma.coupon.create({
      data: {
        code: input.code,
        discountType: input.discountType,
        discountValue: input.discountValue,
        maxUses: input.maxUses ?? null,
        validFrom: input.validFrom ?? null,
        validUntil: input.validUntil ?? null,
        minOrderAmount: input.minOrderAmount ?? null,
        description: input.description ?? null,
        isActive: input.isActive ?? true,
      },
    });
    return mapCoupon(record);
  }

  async update(id: string, input: UpdateCouponInput): Promise<Coupon> {
    const data: Prisma.CouponUpdateInput = {};

    if (input.code !== undefined) data.code = input.code;
    if (input.discountType !== undefined) data.discountType = input.discountType;
    if (input.discountValue !== undefined) data.discountValue = input.discountValue;
    if (input.maxUses !== undefined) data.maxUses = input.maxUses;
    if (input.validFrom !== undefined) data.validFrom = input.validFrom;
    if (input.validUntil !== undefined) data.validUntil = input.validUntil;
    if (input.minOrderAmount !== undefined) data.minOrderAmount = input.minOrderAmount;
    if (input.description !== undefined) data.description = input.description;
    if (input.isActive !== undefined) data.isActive = input.isActive;

    const record = await prisma.coupon.update({ where: { id }, data });
    return mapCoupon(record);
  }

  async delete(id: string): Promise<void> {
    await prisma.coupon.delete({ where: { id } });
  }
}
