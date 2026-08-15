import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';

/**
 * Mocka o cliente Stripe compartilhado (src/infra/config/stripe.ts) — mesmo
 * padrão de tests/saved-cards.test.ts — para que este arquivo NUNCA faça uma
 * chamada de rede real à Stripe.
 */
const stripeMock = vi.hoisted(() => ({
  paymentIntents: {
    create: vi.fn(),
  },
}));

vi.mock('../src/infra/config/stripe.js', () => ({ stripe: stripeMock }));

function api() {
  return getApp().then((app) => supertest(app.server));
}

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Ver tests/auth-hardening.test.ts: rate limit de login é compartilhado por
 * IP entre TODOS os arquivos de teste rodando em paralelo — um X-Forwarded-For
 * forjado por chamada mantém este arquivo fora do orçamento compartilhado.
 */
function randomForwardedFor(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.91.${r()}.${r()}`;
}

function randomUsername(prefix: string): string {
  const tag = prefix.slice(0, 2).toLowerCase();
  const random = Math.random().toString(36).slice(2, 2 + (18 - tag.length));
  return `${tag}${random}`;
}

async function clearLoginRateLimit(): Promise<void> {
  try {
    const redis = await getRedisClient();
    const keys = await redis.keys('ratelimit:login:*');
    if (keys.length > 0) await redis.del(keys);
  } catch {
    /* ignore — Redis may not be available */
  }
}

let accessToken = '';
let userId = '';

interface TestProduct {
  id: string;
  price: number;
}

async function createTestProduct(price: number, stock = 50): Promise<TestProduct> {
  const suffix = uniqueSuffix();
  const product = await prisma.product.create({
    data: {
      name: `Payment Hardening Test Product ${suffix}`,
      slug: `payment-hardening-test-product-${suffix}`,
      description: 'A product for payment hardening testing',
      shortDescription: 'Test product',
      price,
      category: 'baloes',
      images: ['https://placehold.co/400'],
      thumbnailUrl: 'https://placehold.co/200',
      stock,
      sku: `PAYHARD-SKU-${suffix}`,
      weight: 0.5,
      isActive: true,
    },
  });
  return { id: product.id, price: product.price.toNumber() };
}

async function cleanupProduct(productId: string): Promise<void> {
  await prisma.orderItem.deleteMany({ where: { productId } });
  await prisma.inventoryLog.deleteMany({ where: { productId } });
  await prisma.order.deleteMany({ where: { items: { some: { productId } } } });
  await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
}

function mockPaymentIntentCreate(): void {
  // Limpa o histórico de chamadas do mock a cada teste — os asserts abaixo
  // contam invocações de forma absoluta (toHaveBeenCalledTimes / índice do
  // .mock.calls), então testes anteriores no mesmo arquivo não podem
  // "vazar" chamadas para os próximos.
  stripeMock.paymentIntents.create.mockClear();
  stripeMock.paymentIntents.create.mockImplementation(
    (params: { payment_method_options?: unknown }) =>
      Promise.resolve({
        id: `pi_${uniqueSuffix()}`,
        client_secret: `pi_${uniqueSuffix()}_secret`,
        status: 'requires_action',
        next_action:
          Array.isArray(params.payment_method_options) ||
          typeof params.payment_method_options !== 'object'
            ? null
            : {
                type: 'pix_display_qr_code',
                pix_display_qr_code: {
                  image_url_png: 'https://example.com/qr.png',
                  data: '00020126...pix',
                  expires_at: Math.floor(Date.now() / 1000) + 1800,
                },
              },
      }),
  );
}

describe('Payment hardening (idempotency key, Pix cap, Pix expiry)', () => {
  beforeAll(async () => {
    await clearLoginRateLimit();

    const suffix = uniqueSuffix();
    const user = {
      email: `payhard_${suffix}@alegrafestas.com.br`,
      username: randomUsername('ph'),
      password: 'TestPass123',
      name: 'Payment Hardening Test User',
    };

    const agent = await api();
    const registerRes = await agent.post('/v1/auth/register').send(user);
    expect(registerRes.status).toBe(201);
    userId = registerRes.body.data.id as string;

    const loginRes = await agent
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomForwardedFor())
      .send({ identifier: user.email, password: user.password });
    expect(loginRes.status).toBe(200);
    accessToken = loginRes.body.data.accessToken as string;
  });

  afterAll(async () => {
    void userId;
    await closeApp();
  });

  it('Pix with total R$ 3.500,00 is rejected with 422 and the pt-BR cap message', async () => {
    const product = await createTestProduct(3500);
    try {
      mockPaymentIntentCreate();
      const agent = await api();

      const res = await agent
        .post('/v1/payments/create-intent')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          shippingCost: 0,
          paymentMethod: 'pix',
        });

      expect(res.status).toBe(422);
      expect(res.body.message).toContain('PIX está disponível para pedidos entre R$ 0,50 e R$ 3.000,00');
      expect(stripeMock.paymentIntents.create).not.toHaveBeenCalled();
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('Pix with total R$ 200,00 is accepted and expires_after_seconds === 1800 is sent to Stripe', async () => {
    const product = await createTestProduct(200);
    try {
      mockPaymentIntentCreate();
      const agent = await api();

      const res = await agent
        .post('/v1/payments/create-intent')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({
          items: [{ productId: product.id, quantity: 1 }],
          shippingCost: 0,
          paymentMethod: 'pix',
        });

      expect(res.status).toBe(200);
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(1);
      const [params] = stripeMock.paymentIntents.create.mock.calls[0] as [
        { payment_method_options?: { pix?: { expires_after_seconds?: number } } },
      ];
      expect(params.payment_method_options?.pix?.expires_after_seconds).toBe(1800);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('create-intent called twice with the same body sends the same idempotencyKey to Stripe', async () => {
    const product = await createTestProduct(150);
    try {
      mockPaymentIntentCreate();
      const agent = await api();

      const body = {
        items: [{ productId: product.id, quantity: 1 }],
        shippingCost: 0,
        paymentMethod: 'pix',
      };

      const first = await agent
        .post('/v1/payments/create-intent')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);
      const second = await agent
        .post('/v1/payments/create-intent')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(body);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(stripeMock.paymentIntents.create).toHaveBeenCalledTimes(2);

      const [, firstOptions] = stripeMock.paymentIntents.create.mock.calls[0] as [
        unknown,
        { idempotencyKey?: string },
      ];
      const [, secondOptions] = stripeMock.paymentIntents.create.mock.calls[1] as [
        unknown,
        { idempotencyKey?: string },
      ];

      expect(firstOptions.idempotencyKey).toBeTruthy();
      expect(firstOptions.idempotencyKey).toBe(secondOptions.idempotencyKey);
    } finally {
      await cleanupProduct(product.id);
    }
  });
});
