import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { prisma } from '../src/infra/database/prisma-client.js';

/**
 * Integração de ponta a ponta com `prisma/seed-samples.ts`: roda o script
 * de verdade (subprocesso `tsx`, mesmo caminho de execução de
 * `yarn seed:samples`/produção) contra o Postgres/Redis reais do ambiente
 * de teste — sem mocks, seguindo o padrão do resto da suíte. Cobre:
 * idempotência, cobertura das 12 categorias, URLs de imagem, coerência dos
 * agregados de review e o modo `PILOT_SAMPLES=remove` (incluindo a exceção
 * de "não excluir produto com pedido associado").
 */

const SKU_PREFIX = 'AMOSTRA-';
const TEST_CUSTOMER_EMAIL = 'alegra@alegrafestas.com.br';
const SAMPLE_COUPON_CODES = ['BEMVINDA10', 'FRETEFESTA'] as const;
const EXPECTED_CATEGORY_COUNT = 12;
const EXPECTED_PRODUCT_COUNT = 30;
const TSX_BIN = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

interface SeedRunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runSeedScript(mode?: 'remove'): SeedRunResult {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (mode === 'remove') {
    env['PILOT_SAMPLES'] = 'remove';
  } else {
    delete env['PILOT_SAMPLES'];
  }

  const result = spawnSync(TSX_BIN, ['prisma/seed-samples.ts'], {
    cwd: process.cwd(),
    env,
    encoding: 'utf-8',
  });

  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

async function countSampleCoupons(): Promise<number> {
  return prisma.coupon.count({ where: { code: { in: [...SAMPLE_COUPON_CODES] } } });
}

async function countSampleReviews(): Promise<number> {
  return prisma.review.count({ where: { product: { sku: { startsWith: SKU_PREFIX } } } });
}

describe('prisma/seed-samples.ts — seed de amostras do piloto', () => {
  beforeAll(() => {
    const result = runSeedScript();
    expect(result.status, `seed inicial falhou:\n${result.stderr}`).toBe(0);
  }, 30000);

  it('cria exatamente 30 produtos AMOSTRA-*, todos ativos, cobrindo as 12 categorias do frontend', async () => {
    const products = await prisma.product.findMany({ where: { sku: { startsWith: SKU_PREFIX } } });

    expect(products).toHaveLength(EXPECTED_PRODUCT_COUNT);
    expect(products.every((product) => product.isActive)).toBe(true);

    const categories = new Set(products.map((product) => product.category));
    expect(categories.size).toBe(EXPECTED_CATEGORY_COUNT);
  });

  it('grava images/thumbnailUrl apontando para /uploads/products/amostra-', async () => {
    const products = await prisma.product.findMany({ where: { sku: { startsWith: SKU_PREFIX } } });

    for (const product of products) {
      expect(product.thumbnailUrl).toContain('/uploads/products/amostra-');
      expect(product.images.length).toBeGreaterThan(0);
      for (const image of product.images) {
        expect(image).toContain('/uploads/products/amostra-');
        expect(image.toLowerCase()).toMatch(/\.svg$/);
      }
    }
  });

  it('cria os cupons BEMVINDA10 (10%, mín. R$50, 100 usos) e FRETEFESTA (R$15 fixo, mín. R$120)', async () => {
    const bemVinda = await prisma.coupon.findUnique({ where: { code: 'BEMVINDA10' } });
    expect(bemVinda).not.toBeNull();
    expect(bemVinda?.discountType).toBe('PERCENTAGE');
    expect(bemVinda?.discountValue.toNumber()).toBe(10);
    expect(bemVinda?.minOrderAmount?.toNumber()).toBe(50);
    expect(bemVinda?.maxUses).toBe(100);
    expect(bemVinda?.isActive).toBe(true);

    const freteFesta = await prisma.coupon.findUnique({ where: { code: 'FRETEFESTA' } });
    expect(freteFesta).not.toBeNull();
    expect(freteFesta?.discountType).toBe('FIXED');
    expect(freteFesta?.discountValue.toNumber()).toBe(15);
    expect(freteFesta?.minOrderAmount?.toNumber()).toBe(120);
    expect(freteFesta?.isActive).toBe(true);
  });

  it('ativa a campanha sazonal dia-das-criancas (banner, sem vínculo de produto no schema)', async () => {
    const campaign = await prisma.seasonalCampaign.findUnique({ where: { key: 'dia-das-criancas' } });
    expect(campaign).not.toBeNull();
    expect(campaign?.isActive).toBe(true);
    expect(campaign?.startMonth).toBe(10);
    expect(campaign?.endMonth).toBe(10);
  });

  it('cria 6 a 8 reviews reais do cliente de teste, com agregados coerentes (ou avisa e pula se o cliente não existir)', async () => {
    const customer = await prisma.user.findUnique({ where: { email: TEST_CUSTOMER_EMAIL } });
    if (!customer) {
      // Mesmo comportamento tolerante do próprio script (ver seed-samples.ts)
      // — sem o cliente de teste, não há review real para verificar aqui.
      console.warn(
        `Cliente de teste (${TEST_CUSTOMER_EMAIL}) não encontrado — pulando asserções de review.`,
      );
      return;
    }

    const reviews = await prisma.review.findMany({
      where: { userId: customer.id, product: { sku: { startsWith: SKU_PREFIX } } },
    });

    expect(reviews.length).toBeGreaterThanOrEqual(6);
    expect(reviews.length).toBeLessThanOrEqual(8);

    for (const review of reviews) {
      const product = await prisma.product.findUnique({ where: { id: review.productId } });
      expect(product).not.toBeNull();

      // Recalcula de forma independente (mesma fórmula de
      // product-rating-service.ts) para confirmar que o agregado
      // denormalizado do produto nunca divergiu da review real.
      const aggregate = await prisma.review.aggregate({
        where: { productId: review.productId },
        _avg: { rating: true },
        _count: true,
      });
      const expectedAverage =
        aggregate._avg.rating !== null ? Math.round(aggregate._avg.rating * 10) / 10 : null;

      expect(product?.reviewCount).toBe(aggregate._count);
      expect(product?.averageRating?.toNumber() ?? null).toBe(expectedAverage);
    }
  });

  it('é idempotente: rodar de novo não duplica produtos, reviews nem cupons', async () => {
    const before = {
      products: await prisma.product.count({ where: { sku: { startsWith: SKU_PREFIX } } }),
      reviews: await countSampleReviews(),
      coupons: await countSampleCoupons(),
    };

    const second = runSeedScript();
    expect(second.status, `segunda execução falhou:\n${second.stderr}`).toBe(0);

    const after = {
      products: await prisma.product.count({ where: { sku: { startsWith: SKU_PREFIX } } }),
      reviews: await countSampleReviews(),
      coupons: await countSampleCoupons(),
    };

    expect(after).toEqual(before);
    expect(after.products).toBe(EXPECTED_PRODUCT_COUNT);
  }, 20000);

  describe('PILOT_SAMPLES=remove', () => {
    let orderId: string | null = null;
    let fixtureUserId: string | null = null;
    let targetSku: string | null = null;

    beforeAll(async () => {
      // Garante um catálogo de amostra completo antes de testar a remoção.
      const seeded = runSeedScript();
      expect(seeded.status, `seed antes do teste de remoção falhou:\n${seeded.stderr}`).toBe(0);

      const product = await prisma.product.findFirst({
        where: { sku: { startsWith: SKU_PREFIX } },
        orderBy: { sku: 'asc' },
      });
      if (!product) {
        throw new Error('Nenhum produto AMOSTRA-* encontrado após o seed — não deveria acontecer.');
      }
      targetSku = product.sku;

      // Fixture mínima (não passa pelo fluxo de checkout — só precisamos de
      // um OrderItem real referenciando o produto, para exercitar a regra
      // "produto com pedido associado nunca é excluído, só desativado").
      const fixtureUser = await prisma.user.create({
        data: {
          email: `seed_samples_remove_fixture_${Date.now()}@alegrafestas.com.br`,
          username: `ssrf${Date.now()}`.slice(0, 20),
          passwordHash: 'not-a-real-hash-fixture-only',
          name: 'Fixture Remove Test',
          role: 'CUSTOMER',
        },
      });
      fixtureUserId = fixtureUser.id;

      const order = await prisma.order.create({
        data: {
          userId: fixtureUser.id,
          status: 'CONFIRMED',
          totalAmount: product.price,
          items: {
            create: [
              { productId: product.id, quantity: 1, unitPrice: product.price, total: product.price },
            ],
          },
        },
      });
      orderId = order.id;

      const removed = runSeedScript('remove');
      expect(removed.status, `PILOT_SAMPLES=remove falhou:\n${removed.stderr}`).toBe(0);
    }, 30000);

    afterAll(async () => {
      if (orderId) {
        await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
      }
      if (fixtureUserId) {
        await prisma.user.delete({ where: { id: fixtureUserId } }).catch(() => undefined);
      }
      // Restaura o catálogo de amostra completo — este arquivo de teste não
      // pode deixar o banco do piloto pela metade para quem rodar depois.
      const restored = runSeedScript();
      expect(restored.status, `restauração pós-teste falhou:\n${restored.stderr}`).toBe(0);
    }, 30000);

    it('desativa (nunca exclui) o produto que tem pedido associado', async () => {
      if (!targetSku) throw new Error('targetSku não definido — beforeAll falhou.');
      const product = await prisma.product.findUnique({ where: { sku: targetSku } });
      expect(product).not.toBeNull();
      expect(product?.isActive).toBe(false);
    });

    it('exclui os demais produtos AMOSTRA-* (sem pedido associado)', async () => {
      const remaining = await prisma.product.findMany({ where: { sku: { startsWith: SKU_PREFIX } } });
      expect(remaining).toHaveLength(1);
      expect(remaining[0]?.sku).toBe(targetSku);
    });

    it('remove os cupons de amostra (nenhum foi usado)', async () => {
      const coupons = await countSampleCoupons();
      expect(coupons).toBe(0);
    });
  });
});
