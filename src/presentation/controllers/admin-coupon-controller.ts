import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaCouponRepository } from '../../infra/database/prisma-coupon-repository.js';
import { listResponse, successResponse } from '../../shared/utils/response.js';
import { ConflictError, NotFoundError } from '../../domain/errors/app-error.js';
import { normalizeCouponCode } from '../../application/services/coupon-service.js';
import type {
  CreateCouponInput,
  ListCouponsQuery,
  UpdateCouponInput,
} from '../schemas/coupon-schemas.js';
import type { Coupon } from '../../domain/entities/coupon.js';

const couponRepository = new PrismaCouponRepository();

function serializeCoupon(coupon: Coupon) {
  return {
    id: coupon.id,
    code: coupon.code,
    discountType: coupon.discountType,
    discountValue: coupon.discountValue,
    maxUses: coupon.maxUses,
    usedCount: coupon.usedCount,
    validFrom: coupon.validFrom ? coupon.validFrom.toISOString() : null,
    validUntil: coupon.validUntil ? coupon.validUntil.toISOString() : null,
    minOrderAmount: coupon.minOrderAmount,
    description: coupon.description,
    isActive: coupon.isActive,
    createdAt: coupon.createdAt.toISOString(),
    updatedAt: coupon.updatedAt.toISOString(),
  };
}

function isPrismaUniqueViolation(err: unknown): boolean {
  return (
    err !== null &&
    typeof err === 'object' &&
    'code' in err &&
    (err as { code: string }).code === 'P2002'
  );
}

export async function listCouponsHandler(
  request: FastifyRequest<{ Querystring: ListCouponsQuery }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await couponRepository.list({
    cursor: request.query.cursor,
    limit: request.query.limit,
    isActive: request.query.isActive,
    search: request.query.search,
  });

  void reply
    .status(200)
    .send(listResponse(result.data.map(serializeCoupon), result.nextCursor, result.hasMore));
}

export async function getCouponHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const coupon = await couponRepository.findById(request.params.id);
  if (!coupon) {
    throw new NotFoundError('Coupon');
  }
  void reply.status(200).send(successResponse(serializeCoupon(coupon)));
}

export async function createCouponHandler(
  request: FastifyRequest<{ Body: CreateCouponInput }>,
  reply: FastifyReply,
): Promise<void> {
  const body = request.body;
  const normalizedCode = normalizeCouponCode(body.code);

  try {
    const coupon = await couponRepository.create({
      code: normalizedCode,
      discountType: body.discountType,
      discountValue: body.discountValue,
      maxUses: body.maxUses ?? null,
      validFrom: body.validFrom ? new Date(body.validFrom) : null,
      validUntil: body.validUntil ? new Date(body.validUntil) : null,
      minOrderAmount: body.minOrderAmount ?? null,
      description: body.description ?? null,
      isActive: body.isActive ?? true,
    });
    void reply.status(201).send(successResponse(serializeCoupon(coupon)));
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new ConflictError(`Já existe um cupom com o código "${normalizedCode}".`);
    }
    throw err;
  }
}

export async function updateCouponHandler(
  request: FastifyRequest<{ Params: { id: string }; Body: UpdateCouponInput }>,
  reply: FastifyReply,
): Promise<void> {
  const existing = await couponRepository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Coupon');
  }

  const body = request.body;
  const normalizedCode = body.code ? normalizeCouponCode(body.code) : undefined;

  try {
    const coupon = await couponRepository.update(request.params.id, {
      code: normalizedCode,
      discountType: body.discountType,
      discountValue: body.discountValue,
      maxUses: body.maxUses,
      validFrom:
        body.validFrom === undefined
          ? undefined
          : body.validFrom === null
            ? null
            : new Date(body.validFrom),
      validUntil:
        body.validUntil === undefined
          ? undefined
          : body.validUntil === null
            ? null
            : new Date(body.validUntil),
      minOrderAmount: body.minOrderAmount,
      description: body.description,
      isActive: body.isActive,
    });
    void reply.status(200).send(successResponse(serializeCoupon(coupon)));
  } catch (err) {
    if (isPrismaUniqueViolation(err)) {
      throw new ConflictError(`Já existe um cupom com o código "${normalizedCode}".`);
    }
    throw err;
  }
}

export async function deleteCouponHandler(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
): Promise<void> {
  const existing = await couponRepository.findById(request.params.id);
  if (!existing) {
    throw new NotFoundError('Coupon');
  }

  // Soft delete: se o cupom já foi usado, apenas desativa para preservar histórico.
  // Hard delete somente quando ainda não foi utilizado.
  if (existing.usedCount > 0) {
    const updated = await couponRepository.update(request.params.id, { isActive: false });
    void reply.status(200).send(successResponse(serializeCoupon(updated)));
    return;
  }

  await couponRepository.delete(request.params.id);
  void reply.status(204).send();
}
