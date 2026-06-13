import { describe, it, expect } from 'vitest';
import {
  computeChargeableTotal,
  computeInstallmentFee,
  FREE_INSTALLMENTS,
} from './installments.js';

describe('installments', () => {
  describe('computeChargeableTotal', () => {
    it('não cobra juros à vista (1x)', () => {
      expect(computeChargeableTotal(100, 'card', 1)).toBe(100);
    });

    it('não cobra juros até 3x (limite sem juros)', () => {
      expect(computeChargeableTotal(100, 'card', FREE_INSTALLMENTS)).toBe(100);
      expect(computeChargeableTotal(300, 'card', 2)).toBe(300);
    });

    it('cobra juros acima de 3x (Tabela Price 1,99% a.m.)', () => {
      const charged = computeChargeableTotal(100, 'card', 6);
      expect(charged).toBeGreaterThan(100);
      // 6x de R$100 a 1,99% a.m. ≈ R$107,08 no total.
      expect(charged).toBeCloseTo(107.08, 1);
    });

    it('aceita saved_card como cartão', () => {
      expect(computeChargeableTotal(100, 'saved_card', 10)).toBeGreaterThan(100);
    });

    it('aceita o método em maiúsculas (enum Prisma)', () => {
      expect(computeChargeableTotal(100, 'CARD', 10)).toBeGreaterThan(100);
    });

    it('NUNCA cobra juros em PIX, mesmo com installments alto', () => {
      expect(computeChargeableTotal(100, 'pix', 10)).toBe(100);
    });

    it('trata total zero/negativo sem quebrar', () => {
      expect(computeChargeableTotal(0, 'card', 12)).toBe(0);
      expect(computeChargeableTotal(-50, 'card', 12)).toBe(-50);
    });
  });

  describe('computeInstallmentFee', () => {
    it('é zero quando não há juros', () => {
      expect(computeInstallmentFee(100, 'card', 3)).toBe(0);
      expect(computeInstallmentFee(100, 'pix', 12)).toBe(0);
    });

    it('é o acréscimo exato (chargeable - total)', () => {
      const total = 250;
      const fee = computeInstallmentFee(total, 'card', 8);
      const charged = computeChargeableTotal(total, 'card', 8);
      expect(fee).toBeCloseTo(charged - total, 2);
      expect(fee).toBeGreaterThan(0);
    });
  });
});
