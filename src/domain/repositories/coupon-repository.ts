import type { Coupon, CouponDiscountType } from '../entities/coupon.js';

export interface CreateCouponInput {
  code: string;
  discountType: CouponDiscountType;
  discountValue: number;
  maxUses?: number | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  minOrderAmount?: number | null;
  description?: string | null;
  isActive?: boolean;
}

export interface UpdateCouponInput {
  code?: string;
  discountType?: CouponDiscountType;
  discountValue?: number;
  maxUses?: number | null;
  validFrom?: Date | null;
  validUntil?: Date | null;
  minOrderAmount?: number | null;
  description?: string | null;
  isActive?: boolean;
}

export interface CouponListFilters {
  cursor?: string;
  limit: number;
  isActive?: boolean;
  search?: string;
}

export interface CouponListResult {
  data: Coupon[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface CouponRepository {
  findById(id: string): Promise<Coupon | null>;
  findByCode(code: string): Promise<Coupon | null>;
  list(filters: CouponListFilters): Promise<CouponListResult>;
  create(input: CreateCouponInput): Promise<Coupon>;
  update(id: string, input: UpdateCouponInput): Promise<Coupon>;
  delete(id: string): Promise<void>;
}
