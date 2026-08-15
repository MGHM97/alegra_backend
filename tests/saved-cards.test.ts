import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';

/**
 * Mocka o cliente Stripe compartilhado (src/infra/config/stripe.ts) para que
 * este arquivo NUNCA faça uma chamada de rede real à Stripe. `vi.hoisted`
 * garante que os `vi.fn()` existam antes do `vi.mock` (hoisted pelo vitest
 * para o topo do módulo) tentar referenciá-los.
 */
const stripeMock = vi.hoisted(() => ({
  customers: {
    create: vi.fn(),
  },
  setupIntents: {
    create: vi.fn(),
  },
  paymentMethods: {
    retrieve: vi.fn(),
    attach: vi.fn(),
    detach: vi.fn(),
  },
}));

vi.mock('../src/infra/config/stripe.js', () => ({ stripe: stripeMock }));

function api() {
  return getApp().then((app) => supertest(app.server));
}

/**
 * Ver tests/auth-hardening.test.ts: entropia aleatória ANTES do corte de 20
 * caracteres evita colisão de username entre execuções da suíte.
 */
function randomUsername(prefix: string): string {
  const tag = prefix.slice(0, 2).toLowerCase();
  const random = Math.random().toString(36).slice(2, 2 + (18 - tag.length));
  return `${tag}${random}`;
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
  return `10.90.${r()}.${r()}`;
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
// Único por execução da suíte: users.stripe_customer_id tem constraint única
// global (não composta por userId), e usuários de teste NUNCA são apagados
// (ver tests/testing convention) — um valor fixo colidiria com o usuário de
// uma execução anterior da suíte.
const stripeCustomerId = `cus_test_${Date.now()}${Math.random().toString(36).slice(2, 8)}`;

const cardBase = {
  id: 'pm_valid1',
  object: 'payment_method' as const,
  type: 'card' as const,
  customer: null as string | null,
  card: {
    brand: 'visa',
    last4: '4242',
    exp_month: 12,
    exp_year: 2035,
    issuer: 'Banco de Teste',
  },
};

describe('Saved Cards (Stripe SetupIntent)', () => {
  beforeAll(async () => {
    await clearLoginRateLimit();

    const suffix = uniqueSuffix();
    const user = {
      email: `savedcard_${suffix}@alegrafestas.com.br`,
      username: randomUsername('sc'),
      password: 'TestPass123',
      name: 'Saved Card Test User',
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
    if (userId) {
      await prisma.savedCard.deleteMany({ where: { userId } });
    }
    await closeApp();
  });

  it('POST /v1/cards/setup-intent — creates a Stripe customer on the first call and reuses it on the second', async () => {
    const agent = await api();

    stripeMock.customers.create.mockResolvedValueOnce({ id: stripeCustomerId });
    stripeMock.setupIntents.create.mockResolvedValueOnce({
      id: 'seti_1',
      client_secret: 'seti_1_secret_abc',
    });

    const firstRes = await agent
      .post('/v1/cards/setup-intent')
      .set('Authorization', `Bearer ${accessToken}`)
      .send();

    expect(firstRes.status).toBe(200);
    expect(firstRes.body.data.clientSecret).toBe('seti_1_secret_abc');
    expect(stripeMock.customers.create).toHaveBeenCalledTimes(1);

    const userAfterFirst = await prisma.user.findUnique({ where: { id: userId } });
    expect(userAfterFirst?.stripeCustomerId).toBe(stripeCustomerId);

    stripeMock.setupIntents.create.mockResolvedValueOnce({
      id: 'seti_2',
      client_secret: 'seti_2_secret_def',
    });

    const secondRes = await agent
      .post('/v1/cards/setup-intent')
      .set('Authorization', `Bearer ${accessToken}`)
      .send();

    expect(secondRes.status).toBe(200);
    expect(secondRes.body.data.clientSecret).toBe('seti_2_secret_def');
    // Customer NÃO é recriado na segunda chamada.
    expect(stripeMock.customers.create).toHaveBeenCalledTimes(1);
    expect(stripeMock.setupIntents.create).toHaveBeenCalledTimes(2);
  });

  it('POST /v1/cards — persists a card derived from a Stripe payment_method belonging to the user\'s customer', async () => {
    const agent = await api();

    stripeMock.paymentMethods.retrieve.mockResolvedValueOnce({
      ...cardBase,
      id: 'pm_valid1',
      customer: stripeCustomerId,
    });

    const res = await agent
      .post('/v1/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethodId: 'pm_valid1', holderName: 'Fulano da Silva' });

    expect(res.status).toBe(201);
    expect(res.body.data.lastFourDigits).toBe('4242');
    expect(res.body.data.brand).toBe('visa');
    expect(res.body.data.expiryMonth).toBe(12);
    expect(res.body.data.expiryYear).toBe(2035);
    expect(res.body.data.issuer).toBe('Banco de Teste');
    // Ids internos da Stripe nunca vazam na resposta.
    expect(res.body.data.stripePaymentMethodId).toBeUndefined();
    expect(res.body.data.stripeCustomerId).toBeUndefined();
    // PM já pertence ao customer correto — não precisa anexar.
    expect(stripeMock.paymentMethods.attach).not.toHaveBeenCalled();

    const stored = await prisma.savedCard.findFirst({
      where: { userId, stripePaymentMethodId: 'pm_valid1' },
    });
    expect(stored).not.toBeNull();
    expect(stored?.stripeCustomerId).toBe(stripeCustomerId);
    expect(stored?.holderName).toBe('Fulano da Silva');
  });

  it('POST /v1/cards — attaches a payment_method that is not yet attached to any customer', async () => {
    const agent = await api();

    stripeMock.paymentMethods.retrieve.mockResolvedValueOnce({
      ...cardBase,
      id: 'pm_unattached',
      customer: null,
    });
    stripeMock.paymentMethods.attach.mockResolvedValueOnce({});

    const res = await agent
      .post('/v1/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethodId: 'pm_unattached', holderName: 'Ciclana Souza' });

    expect(res.status).toBe(201);
    expect(stripeMock.paymentMethods.attach).toHaveBeenCalledWith('pm_unattached', {
      customer: stripeCustomerId,
    });
  });

  it('POST /v1/cards — payment_method belonging to another customer is rejected with 403', async () => {
    const agent = await api();

    stripeMock.paymentMethods.retrieve.mockResolvedValueOnce({
      ...cardBase,
      id: 'pm_othercustomer1',
      customer: 'cus_someone_else',
    });

    const res = await agent
      .post('/v1/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethodId: 'pm_othercustomer1', holderName: 'Intruso' });

    expect(res.status).toBe(403);

    const stored = await prisma.savedCard.findFirst({
      where: { userId, stripePaymentMethodId: 'pm_othercustomer1' },
    });
    expect(stored).toBeNull();
  });

  it('POST /v1/cards — the same payment_method twice returns 200 without duplicating', async () => {
    const agent = await api();

    stripeMock.paymentMethods.retrieve.mockResolvedValueOnce({
      ...cardBase,
      id: 'pm_valid1',
      customer: stripeCustomerId,
    });

    const res = await agent
      .post('/v1/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethodId: 'pm_valid1', holderName: 'Fulano da Silva' });

    expect(res.status).toBe(200);

    const count = await prisma.savedCard.count({
      where: { userId, stripePaymentMethodId: 'pm_valid1' },
    });
    expect(count).toBe(1);
  });

  it('POST /v1/cards — unsupported card brand is rejected with 422', async () => {
    const agent = await api();

    stripeMock.paymentMethods.retrieve.mockResolvedValueOnce({
      ...cardBase,
      id: 'pm_unsupportedbrand1',
      customer: stripeCustomerId,
      card: { ...cardBase.card, brand: 'diners' },
    });

    const res = await agent
      .post('/v1/cards')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethodId: 'pm_unsupportedbrand1', holderName: 'Beltrano' });

    expect(res.status).toBe(422);

    const stored = await prisma.savedCard.findFirst({
      where: { userId, stripePaymentMethodId: 'pm_unsupportedbrand1' },
    });
    expect(stored).toBeNull();
  });

  it('DELETE /v1/cards/:id — detaches the payment_method on the Stripe side', async () => {
    const agent = await api();

    const card = await prisma.savedCard.findFirst({
      where: { userId, stripePaymentMethodId: 'pm_valid1' },
    });
    expect(card).not.toBeNull();
    if (!card) return;

    stripeMock.paymentMethods.detach.mockResolvedValueOnce({});

    const res = await agent
      .delete(`/v1/cards/${card.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send();

    expect(res.status).toBe(204);
    expect(stripeMock.paymentMethods.detach).toHaveBeenCalledWith('pm_valid1');

    const stored = await prisma.savedCard.findUnique({ where: { id: card.id } });
    expect(stored).toBeNull();
  });
});
