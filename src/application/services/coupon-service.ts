import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../infra/database/prisma-client.js';
import { PrismaCouponRepository } from '../../infra/database/prisma-coupon-repository.js';
import type { Coupon, CouponValidationResult } from '../../domain/entities/coupon.js';
import { CouponError } from '../../domain/errors/app-error.js';

const couponRepository = new PrismaCouponRepository();

/**
 * Normaliza o código do cupom: remove espaços e converte para uppercase.
 * Mantém uma única forma canônica em todo o sistema.
 */
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

/**
 * Calcula o desconto aplicado ao subtotal a partir de um cupom.
 * - PERCENTAGE: percentual aplicado sobre o subtotal (ex: 15 = 15%)
 * - FIXED: valor absoluto em reais
 *
 * Garante que o desconto nunca ultrapasse o subtotal (sem totais negativos)
 * e arredonda para 2 casas decimais.
 */
export function computeDiscount(subtotal: number, coupon: Coupon): number {
  let discount = 0;

  if (coupon.discountType === 'PERCENTAGE') {
    discount = (subtotal * coupon.discountValue) / 100;
  } else {
    discount = coupon.discountValue;
  }

  if (discount > subtotal) {
    discount = subtotal;
  }

  return Math.round(discount * 100) / 100;
}

/**
 * Verifica regras de negócio do cupom contra o subtotal informado.
 * Lança CouponError com código descritivo quando alguma regra falha.
 *
 * IMPORTANTE: esta função é puramente de validação. NÃO incrementa usedCount.
 */
export function assertCouponUsable(coupon: Coupon | null, subtotal: number): asserts coupon {
  if (!coupon) {
    throw new CouponError('Cupom não encontrado.', 'COUPON_NOT_FOUND', 404);
  }

  if (!coupon.isActive) {
    throw new CouponError('Este cupom não está mais ativo.', 'COUPON_INACTIVE');
  }

  const now = new Date();

  if (coupon.validFrom && now < coupon.validFrom) {
    throw new CouponError('Este cupom ainda não está válido.', 'COUPON_NOT_YET_VALID');
  }

  if (coupon.validUntil && now > coupon.validUntil) {
    throw new CouponError('Este cupom expirou.', 'COUPON_EXPIRED');
  }

  if (coupon.maxUses !== null && coupon.usedCount >= coupon.maxUses) {
    throw new CouponError('Este cupom atingiu o limite máximo de utilizações.', 'COUPON_MAX_USES');
  }

  if (coupon.minOrderAmount !== null && subtotal < coupon.minOrderAmount) {
    throw new CouponError(
      `Este cupom requer pedido mínimo de R$ ${coupon.minOrderAmount.toFixed(2).replace('.', ',')}.`,
      'COUPON_MIN_ORDER',
    );
  }
}

export interface ValidateCouponInput {
  code: string;
  subtotal: number;
}

/**
 * Valida um cupom para um determinado subtotal e retorna o desconto calculado.
 * Não realiza reserva nem altera contadores — uso seguro em qualquer ponto.
 */
export async function validateCouponForSubtotal(
  input: ValidateCouponInput,
): Promise<CouponValidationResult> {
  const code = normalizeCouponCode(input.code);
  const coupon = await couponRepository.findByCode(code);

  assertCouponUsable(coupon, input.subtotal);

  const discountAmount = computeDiscount(input.subtotal, coupon);
  const finalTotal = Math.round((input.subtotal - discountAmount) * 100) / 100;

  return { coupon, discountAmount, finalTotal };
}

type TransactionClient = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

/**
 * Incrementa o usedCount de um cupom de forma atômica, evitando overuse
 * sob concorrência. Se o cupom tem limite e já está esgotado no momento
 * do update, lança CouponError('COUPON_MAX_USES').
 *
 * Deve ser chamado dentro da MESMA transação onde o pedido é criado, para
 * que estoque, pedido e contador do cupom permaneçam consistentes.
 */
export async function reserveCouponUsage(
  tx: TransactionClient,
  couponId: string,
): Promise<void> {
  const coupon = await tx.coupon.findUnique({ where: { id: couponId } });
  if (!coupon) {
    throw new CouponError('Cupom não encontrado.', 'COUPON_NOT_FOUND', 404);
  }

  const where: Prisma.CouponWhereUniqueInput = { id: couponId };

  // Quando há limite, condicionamos o update à condição usedCount < maxUses.
  // Em concorrência, apenas uma transação consegue passar; a outra recebe 0
  // linhas afetadas e disparamos COUPON_MAX_USES.
  if (coupon.maxUses !== null) {
    const result = await tx.coupon.updateMany({
      where: { id: couponId, usedCount: { lt: coupon.maxUses } },
      data: { usedCount: { increment: 1 } },
    });

    if (result.count === 0) {
      throw new CouponError(
        'Este cupom atingiu o limite máximo de utilizações.',
        'COUPON_MAX_USES',
      );
    }
    return;
  }

  // Sem limite: incremento direto.
  await tx.coupon.update({
    where,
    data: { usedCount: { increment: 1 } },
  });
}

/**
 * Reverte o uso de um cupom — chamado quando um pedido confirmado
 * é cancelado ou estornado, devolvendo o "slot" ao cupom.
 */
export async function releaseCouponUsage(
  tx: TransactionClient,
  couponId: string,
): Promise<void> {
  await tx.coupon.updateMany({
    where: { id: couponId, usedCount: { gt: 0 } },
    data: { usedCount: { decrement: 1 } },
  });
}

/**
 * Busca um cupom pelo código (normalizado). Retorna null se não existir.
 * Útil em endpoints como create-intent que precisam recalcular antes de cobrar.
 */
export async function findCouponByCode(code: string): Promise<Coupon | null> {
  return prisma.coupon.findUnique({
    where: { code: normalizeCouponCode(code) },
  }).then((record) => {
    if (!record) return null;
    return {
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
  });
}
