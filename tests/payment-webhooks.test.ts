import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import supertest from 'supertest';
import { getApp, closeApp } from './setup.js';
import { prisma } from '../src/infra/database/prisma-client.js';
import { getRedisClient } from '../src/infra/cache/redis-client.js';
import { confirmOrderPayment } from '../src/application/services/order-confirmation-service.js';

/**
 * Mocka o cliente Stripe compartilhado (src/infra/config/stripe.ts) — mesmo
 * padrão de tests/saved-cards.test.ts e tests/payment-hardening.test.ts —
 * para que este arquivo NUNCA faça uma chamada de rede real à Stripe.
 * `webhooks.constructEvent` é mockado para devolver o evento construído no
 * próprio teste (o corpo/assinatura enviados ao endpoint são irrelevantes,
 * já que a verificação real da Stripe não roda).
 */
const stripeMock = vi.hoisted(() => ({
  webhooks: { constructEvent: vi.fn() },
  refunds: { create: vi.fn() },
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
 * Octeto 93 escolhido por não colidir com os já usados por outros arquivos
 * (77, 90, 91).
 */
function randomForwardedFor(): string {
  const r = () => Math.floor(Math.random() * 254) + 1;
  return `10.93.${r()}.${r()}`;
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

const RUN_ID = uniqueSuffix();

const CUSTOMER_USER = {
  email: `pw_customer_${RUN_ID}@alegrafestas.com.br`,
  username: randomUsername('pc'),
  password: 'TestPass123',
  name: 'Payment Webhooks Customer',
};

const ADMIN_USER = {
  email: `pw_admin_${RUN_ID}@alegrafestas.com.br`,
  username: randomUsername('pa'),
  password: 'TestPass123',
  name: 'Payment Webhooks Admin',
};

let customerToken = '';
let adminToken = '';

interface TestProduct {
  id: string;
  price: number;
}

async function createTestProduct(price: number, stock = 50): Promise<TestProduct> {
  const suffix = uniqueSuffix();
  const product = await prisma.product.create({
    data: {
      name: `Payment Webhooks Test Product ${suffix}`,
      slug: `payment-webhooks-test-product-${suffix}`,
      description: 'A product for payment webhook testing',
      shortDescription: 'Test product',
      price,
      category: 'baloes',
      images: ['https://placehold.co/400'],
      thumbnailUrl: 'https://placehold.co/200',
      stock,
      sku: `PAYWH-SKU-${suffix}`,
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

async function getProductStock(
  productId: string,
): Promise<{ stock: number; reservedStock: number }> {
  const product = await prisma.product.findUniqueOrThrow({
    where: { id: productId },
    select: { stock: true, reservedStock: true },
  });
  return product;
}

interface CreatedOrder {
  id: string;
  paymentIntentId: string;
}

async function createOrder(
  productId: string,
  quantity: number,
  opts: { paymentMethod?: 'pix' | 'card' } = {},
): Promise<CreatedOrder> {
  const paymentIntentId = `pi_test_${uniqueSuffix()}`;
  const agent = await api();
  const res = await agent
    .post('/v1/orders')
    .set('Authorization', `Bearer ${customerToken}`)
    .send({
      items: [{ productId, quantity }],
      idempotencyKey: crypto.randomUUID(),
      paymentIntentId,
      paymentMethod: opts.paymentMethod ?? 'card',
    });
  expect(res.status).toBe(201);
  return { id: res.body.data.id as string, paymentIntentId };
}

/**
 * Move o pedido de RESERVED -> CONFIRMED (commitSale roda, estoque físico é
 * decrementado) e marca paymentStatus SUCCEEDED (+ paidAt), exatamente como o
 * webhook payment_intent.succeeded faria em produção. Usado para simular um
 * pedido "pós-venda" antes de disparar disputa/reembolso/cancelamento.
 */
async function confirmOrder(orderId: string, productId: string, quantity: number): Promise<void> {
  const converted = await confirmOrderPayment({
    orderId,
    fromStatuses: ['RESERVED'],
    toStatus: 'CONFIRMED',
    paymentStatus: 'SUCCEEDED',
    items: [{ productId, quantity }],
  });
  expect(converted).toBe(true);
}

/**
 * Faz `stripe.webhooks.constructEvent` devolver o evento fornecido na
 * próxima chamada e dispara POST /v1/payments/webhook. O corpo/assinatura
 * reais não importam pois a verificação da Stripe está mockada — só
 * precisam existir para passar pelos guards do handler (rawBody presente,
 * header stripe-signature presente).
 */
async function postWebhookEvent(
  eventType: string,
  dataObject: Record<string, unknown>,
): Promise<supertest.Response> {
  const eventId = `evt_test_${uniqueSuffix()}`;
  stripeMock.webhooks.constructEvent.mockReturnValueOnce({
    id: eventId,
    type: eventType,
    data: { object: dataObject },
  });

  const agent = await api();
  return agent
    .post('/v1/payments/webhook')
    .set('stripe-signature', 'test-signature')
    .send({});
}

describe('Payment webhooks (dispute, refund reconciliation, cancellation) and partial refund API', () => {
  beforeAll(async () => {
    await clearLoginRateLimit();

    const agent = await api();
    await agent.post('/v1/auth/register').send(CUSTOMER_USER);
    const customerLogin = await agent
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomForwardedFor())
      .send({ identifier: CUSTOMER_USER.email, password: CUSTOMER_USER.password });
    customerToken = customerLogin.body.data?.accessToken as string;

    const agent2 = await api();
    await agent2.post('/v1/auth/register').send(ADMIN_USER);
    const adminUser = await prisma.user.findUnique({ where: { email: ADMIN_USER.email } });
    if (adminUser) {
      await prisma.user.update({ where: { id: adminUser.id }, data: { role: 'ADMIN' } });
    }
    const adminLogin = await agent2
      .post('/v1/auth/login')
      .set('X-Forwarded-For', randomForwardedFor())
      .send({ identifier: ADMIN_USER.email, password: ADMIN_USER.password });
    adminToken = adminLogin.body.data?.accessToken as string;
  });

  afterAll(async () => {
    await closeApp();
  });

  it('charge.dispute.created marks the order paymentStatus as DISPUTED without touching stock', async () => {
    const product = await createTestProduct(100);
    try {
      const order = await createOrder(product.id, 2, { paymentMethod: 'card' });
      await confirmOrder(order.id, product.id, 2);
      const stockBefore = await getProductStock(product.id);

      const res = await postWebhookEvent('charge.dispute.created', {
        id: `dp_${uniqueSuffix()}`,
        payment_intent: order.paymentIntentId,
        reason: 'fraudulent',
        status: 'warning_needs_response',
      });

      expect(res.status).toBe(200);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.paymentStatus).toBe('DISPUTED');
      expect(updated.status).toBe('CONFIRMED');

      const stockAfter = await getProductStock(product.id);
      expect(stockAfter).toEqual(stockBefore);
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('charge.dispute.closed with status "lost" refunds the order and restocks (RESTOCK)', async () => {
    const product = await createTestProduct(150, 30);
    try {
      const order = await createOrder(product.id, 3, { paymentMethod: 'card' });
      await confirmOrder(order.id, product.id, 3);
      const stockAfterSale = await getProductStock(product.id);
      expect(stockAfterSale.stock).toBe(27); // 30 - 3 (SALE)

      const res = await postWebhookEvent('charge.dispute.closed', {
        id: `dp_${uniqueSuffix()}`,
        payment_intent: order.paymentIntentId,
        reason: 'fraudulent',
        status: 'lost',
      });

      expect(res.status).toBe(200);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('REFUNDED');
      expect(updated.paymentStatus).toBe('REFUNDED');
      expect(updated.refundedAmount.toNumber()).toBeCloseTo(150 * 3, 2);

      const stockAfterLoss = await getProductStock(product.id);
      expect(stockAfterLoss.stock).toBe(30); // restocked (RESTOCK)
      expect(stockAfterLoss.reservedStock).toBe(0);

      const restockLog = await prisma.inventoryLog.findFirst({
        where: { productId: product.id, action: 'RESTOCK' },
      });
      expect(restockLog).not.toBeNull();
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('charge.dispute.closed with status "won" restores paymentStatus to SUCCEEDED', async () => {
    const product = await createTestProduct(80);
    try {
      const order = await createOrder(product.id, 1, { paymentMethod: 'card' });
      await confirmOrder(order.id, product.id, 1);

      await postWebhookEvent('charge.dispute.created', {
        id: `dp_${uniqueSuffix()}`,
        payment_intent: order.paymentIntentId,
        reason: 'fraudulent',
        status: 'warning_needs_response',
      });

      const disputed = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(disputed.paymentStatus).toBe('DISPUTED');

      const res = await postWebhookEvent('charge.dispute.closed', {
        id: `dp_${uniqueSuffix()}`,
        payment_intent: order.paymentIntentId,
        reason: 'fraudulent',
        status: 'won',
      });

      expect(res.status).toBe(200);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.paymentStatus).toBe('SUCCEEDED');
      expect(updated.status).toBe('CONFIRMED');
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('charge.refunded (full, amount_refunded === amount) reconciles a Dashboard refund and restocks', async () => {
    const product = await createTestProduct(200, 20);
    try {
      const order = await createOrder(product.id, 2, { paymentMethod: 'card' });
      await confirmOrder(order.id, product.id, 2);
      const totalCents = Math.round(200 * 2 * 100);

      const res = await postWebhookEvent('charge.refunded', {
        id: `ch_${uniqueSuffix()}`,
        payment_intent: order.paymentIntentId,
        amount: totalCents,
        amount_refunded: totalCents,
        refunded: true,
      });

      expect(res.status).toBe(200);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('REFUNDED');
      expect(updated.paymentStatus).toBe('REFUNDED');

      const stock = await getProductStock(product.id);
      expect(stock.stock).toBe(20); // restocked back to original
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('charge.refunded is a no-op (stock unchanged) when the order is already REFUNDED', async () => {
    const product = await createTestProduct(90, 15);
    try {
      const order = await createOrder(product.id, 1, { paymentMethod: 'card' });
      await confirmOrder(order.id, product.id, 1);
      const totalCents = Math.round(90 * 100);
      const chargeObject = {
        id: `ch_${uniqueSuffix()}`,
        payment_intent: order.paymentIntentId,
        amount: totalCents,
        amount_refunded: totalCents,
        refunded: true,
      };

      const first = await postWebhookEvent('charge.refunded', chargeObject);
      expect(first.status).toBe(200);

      const stockAfterFirst = await getProductStock(product.id);
      expect(stockAfterFirst.stock).toBe(15);

      // Segunda entrega do MESMO evento de negócio (charge.refunded), com um
      // event.id diferente (simula reentrega/segundo webhook da Stripe para
      // o mesmo charge, ex.: refund.updated também dispara charge.refunded).
      // A idempotência externa (IdempotencyRecord por event.id) não barra
      // esta segunda chamada — é a checagem interna
      // (order.paymentStatus === 'REFUNDED') que precisa fazer o no-op.
      const second = await postWebhookEvent('charge.refunded', chargeObject);
      expect(second.status).toBe(200);

      const stockAfterSecond = await getProductStock(product.id);
      expect(stockAfterSecond).toEqual(stockAfterFirst);

      const restockLogs = await prisma.inventoryLog.count({
        where: { productId: product.id, action: 'RESTOCK' },
      });
      expect(restockLogs).toBe(1); // só o primeiro reembolso gerou RESTOCK
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('charge.refunded (partial, amount_refunded < amount) marks PARTIALLY_REFUNDED without releasing stock', async () => {
    const product = await createTestProduct(300, 10);
    try {
      const order = await createOrder(product.id, 1, { paymentMethod: 'card' });
      await confirmOrder(order.id, product.id, 1);

      const res = await postWebhookEvent('charge.refunded', {
        id: `ch_${uniqueSuffix()}`,
        payment_intent: order.paymentIntentId,
        amount: 30000,
        amount_refunded: 10000, // R$ 100 de R$ 300 -> parcial
        refunded: false,
      });

      expect(res.status).toBe(200);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(updated.status).toBe('CONFIRMED');
      expect(updated.refundedAmount.toNumber()).toBeCloseTo(100, 2);

      const stock = await getProductStock(product.id);
      expect(stock.stock).toBe(9); // still decremented from the sale, not restored
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('payment_intent.canceled releases the pre-sale stock reservation for a PENDING/RESERVED order', async () => {
    const product = await createTestProduct(120, 40);
    try {
      const order = await createOrder(product.id, 4, { paymentMethod: 'card' });

      const reservedBefore = await getProductStock(product.id);
      expect(reservedBefore.reservedStock).toBe(4);
      expect(reservedBefore.stock).toBe(40);

      const res = await postWebhookEvent('payment_intent.canceled', {
        id: order.paymentIntentId,
      });

      expect(res.status).toBe(200);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.status).toBe('CANCELLED');
      expect(updated.paymentStatus).toBe('CANCELED');

      const stockAfter = await getProductStock(product.id);
      expect(stockAfter.reservedStock).toBe(0);
      expect(stockAfter.stock).toBe(40); // never committed, so physical stock never moved

      const releaseLog = await prisma.inventoryLog.findFirst({
        where: { productId: product.id, action: 'RESERVATION_RELEASE' },
      });
      expect(releaseLog).not.toBeNull();
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('POST /v1/admin/orders/:id/refund with { amount } does a partial refund: PARTIALLY_REFUNDED and stock intact', async () => {
    const product = await createTestProduct(400, 5);
    try {
      const order = await createOrder(product.id, 1, { paymentMethod: 'card' });
      await confirmOrder(order.id, product.id, 1);

      stripeMock.refunds.create.mockClear();
      stripeMock.refunds.create.mockResolvedValueOnce({ id: `re_${uniqueSuffix()}` });

      const agent = await api();
      const res = await agent
        .post(`/v1/admin/orders/${order.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 100 });

      expect(res.status).toBe(200);
      expect(res.body.data.isFullRefund).toBe(false);
      expect(res.body.data.amountRefunded).toBeCloseTo(100, 2);
      expect(res.body.data.totalRefunded).toBeCloseTo(100, 2);

      expect(stripeMock.refunds.create).toHaveBeenCalledTimes(1);
      const [params] = stripeMock.refunds.create.mock.calls[0] as [{ amount?: number }];
      expect(params.amount).toBe(10000);

      const updated = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
      expect(updated.paymentStatus).toBe('PARTIALLY_REFUNDED');
      expect(updated.status).toBe('CONFIRMED'); // unchanged
      expect(updated.refundedAmount.toNumber()).toBeCloseTo(100, 2);

      const stock = await getProductStock(product.id);
      expect(stock.stock).toBe(4); // still decremented from the sale, not restored
    } finally {
      await cleanupProduct(product.id);
    }
  });

  it('POST /v1/admin/orders/:id/refund rejects a Pix order paid more than 90 days ago with 422', async () => {
    const product = await createTestProduct(60); // default stock 50
    try {
      const order = await createOrder(product.id, 1, { paymentMethod: 'pix' });
      await confirmOrder(order.id, product.id, 1);

      const ninetyOneDaysAgo = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
      await prisma.order.update({
        where: { id: order.id },
        data: { paidAt: ninetyOneDaysAgo },
      });

      stripeMock.refunds.create.mockClear();

      const agent = await api();
      const res = await agent
        .post(`/v1/admin/orders/${order.id}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send();

      expect(res.status).toBe(422);
      expect(res.body.message).toContain(
        'Reembolso de PIX só é possível em até 90 dias após o pagamento.',
      );
      expect(stripeMock.refunds.create).not.toHaveBeenCalled();

      const stock = await getProductStock(product.id);
      expect(stock.stock).toBe(49); // sale committed (50-1), refund never happened — nothing restored
    } finally {
      await cleanupProduct(product.id);
    }
  });
});
