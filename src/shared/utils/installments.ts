/**
 * Regras de parcelamento — FONTE ÚNICA DE VERDADE no backend.
 * Espelha o frontend em `src/utils/installments.ts`.
 *
 * - Até 3x: sem juros.
 * - Acima de 3x: juros compostos pela Tabela Price a 1,99% a.m.
 * - Só se aplica a cartão (card / saved_card).
 */
export const FREE_INSTALLMENTS = 3;
export const MONTHLY_INTEREST = 0.0199;

function isCardMethod(paymentMethod: string | null | undefined): boolean {
  if (!paymentMethod) return false;
  const m = paymentMethod.toLowerCase();
  return m === 'card' || m === 'saved_card';
}

/**
 * Total efetivamente cobrado do cliente, já incluindo juros de parcelamento
 * quando aplicável. Retorna o próprio total quando não há juros.
 */
export function computeChargeableTotal(
  total: number,
  paymentMethod: string | null | undefined,
  installments: number,
): number {
  if (!isCardMethod(paymentMethod) || installments <= FREE_INSTALLMENTS || total <= 0) {
    return Math.round(total * 100) / 100;
  }
  const r = MONTHLY_INTEREST;
  const perInstallment = (total * r) / (1 - Math.pow(1 + r, -installments));
  return Math.round(perInstallment * installments * 100) / 100;
}

/**
 * Apenas o valor dos juros (acréscimo sobre o total de mercadorias+frete).
 * Zero quando não há juros.
 */
export function computeInstallmentFee(
  total: number,
  paymentMethod: string | null | undefined,
  installments: number,
): number {
  const chargeable = computeChargeableTotal(total, paymentMethod, installments);
  return Math.round((chargeable - total) * 100) / 100;
}
