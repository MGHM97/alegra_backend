import type { FastifyReply, FastifyRequest } from 'fastify';
import { successResponse } from '../../shared/utils/response.js';
import { validateCouponForSubtotal } from '../../application/services/coupon-service.js';
import type { ValidateCouponInput } from '../schemas/coupon-schemas.js';

/**
 * Endpoint público de validação. Não é necessário autenticar — qualquer
 * visitante pode testar um cupom no checkout. Apenas LEITURA: nunca
 * incrementa usedCount nem marca uso (a reserva acontece no fluxo
 * de criação do pedido / pagamento).
 */
export async function validateCouponHandler(
  request: FastifyRequest<{ Body: ValidateCouponInput }>,
  reply: FastifyReply,
): Promise<void> {
  const result = await validateCouponForSubtotal({
    code: request.body.code,
    subtotal: request.body.subtotal,
  });

  void reply.status(200).send(
    successResponse({
      valid: true,
      coupon: {
        id: result.coupon.id,
        code: result.coupon.code,
        discountType: result.coupon.discountType,
        discountValue: result.coupon.discountValue,
        description: result.coupon.description,
      },
      discountAmount: result.discountAmount,
      finalTotal: result.finalTotal,
    }),
  );
}
