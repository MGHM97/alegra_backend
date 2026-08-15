import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { prisma } from '../src/infra/database/prisma-client.js';
import { selectOrdersForReviewReminder } from '../src/application/services/review-reminder-service.js';

function uniqueSuffix(): string {
  return `${Date.now()}${Math.random().toString(36).slice(2, 8)}`;
}

const NOW = new Date('2026-08-15T12:00:00.000Z');
const FIVE_DAYS_AGO = new Date(NOW.getTime() - 5 * 24 * 60 * 60 * 1000);
const ONE_DAY_AGO = new Date(NOW.getTime() - 1 * 24 * 60 * 60 * 1000);

interface TestUser {
  id: string;
  email: string;
  name: string;
}

async function createTestUser(): Promise<TestUser> {
  const suffix = uniqueSuffix();
  const user = await prisma.user.create({
    data: {
      email: `review_reminder_${suffix}@alegrafestas.com.br`,
      username: `rr${suffix}`.slice(0, 20),
      passwordHash: 'not-a-real-hash-unused-in-this-test',
      name: `Review Reminder User ${suffix}`,
    },
  });
  return { id: user.id, email: user.email, name: user.name };
}

async function createTestProduct(): Promise<string> {
  const suffix = uniqueSuffix();
  const product = await prisma.product.create({
    data: {
      name: `Review Reminder Product ${suffix}`,
      slug: `review-reminder-product-${suffix}`,
      description: 'Product used to test the review reminder selector',
      shortDescription: 'Test product',
      price: 29.9,
      category: 'baloes',
      images: ['https://placehold.co/400'],
      thumbnailUrl: 'https://placehold.co/200',
      stock: 10,
      sku: `RR-SKU-${suffix}`,
      weight: 0.3,
      isActive: true,
    },
  });
  return product.id;
}

interface CreateOrderOptions {
  userId: string;
  productId: string;
  status: 'DELIVERED' | 'SHIPPED';
  deliveredAt: Date | null;
  reviewReminderSentAt: Date | null;
}

async function createTestOrder(options: CreateOrderOptions): Promise<string> {
  const order = await prisma.order.create({
    data: {
      userId: options.userId,
      status: options.status,
      totalAmount: 29.9,
      deliveredAt: options.deliveredAt,
      reviewReminderSentAt: options.reviewReminderSentAt,
      items: {
        create: [{ productId: options.productId, quantity: 1, unitPrice: 29.9, total: 29.9 }],
      },
    },
  });
  return order.id;
}

describe('selectOrdersForReviewReminder', () => {
  let user: TestUser;
  let productId: string;
  const orderIds: string[] = [];

  beforeAll(async () => {
    user = await createTestUser();
    productId = await createTestProduct();
  });

  afterAll(async () => {
    await prisma.review.deleteMany({ where: { userId: user.id, productId } });
    await prisma.orderItem.deleteMany({ where: { productId } });
    await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    await prisma.product.delete({ where: { id: productId } }).catch(() => undefined);
  });

  it('selects a DELIVERED order older than 3 days, never reminded, never reviewed', async () => {
    const orderId = await createTestOrder({
      userId: user.id,
      productId,
      status: 'DELIVERED',
      deliveredAt: FIVE_DAYS_AGO,
      reviewReminderSentAt: null,
    });
    orderIds.push(orderId);

    const candidates = await selectOrdersForReviewReminder(NOW);
    const match = candidates.find((c) => c.orderId === orderId);

    expect(match).toBeDefined();
    expect(match?.userEmail).toBe(user.email);
    expect(match?.userName).toBe(user.name);
  });

  it('excludes an order delivered less than 3 days ago', async () => {
    const orderId = await createTestOrder({
      userId: user.id,
      productId,
      status: 'DELIVERED',
      deliveredAt: ONE_DAY_AGO,
      reviewReminderSentAt: null,
    });
    orderIds.push(orderId);

    const candidates = await selectOrdersForReviewReminder(NOW);
    expect(candidates.find((c) => c.orderId === orderId)).toBeUndefined();
  });

  it('excludes an order that already had reviewReminderSentAt marked', async () => {
    const orderId = await createTestOrder({
      userId: user.id,
      productId,
      status: 'DELIVERED',
      deliveredAt: FIVE_DAYS_AGO,
      reviewReminderSentAt: FIVE_DAYS_AGO,
    });
    orderIds.push(orderId);

    const candidates = await selectOrdersForReviewReminder(NOW);
    expect(candidates.find((c) => c.orderId === orderId)).toBeUndefined();
  });

  it('excludes an order still SHIPPED (not DELIVERED)', async () => {
    const orderId = await createTestOrder({
      userId: user.id,
      productId,
      status: 'SHIPPED',
      deliveredAt: null,
      reviewReminderSentAt: null,
    });
    orderIds.push(orderId);

    const candidates = await selectOrdersForReviewReminder(NOW);
    expect(candidates.find((c) => c.orderId === orderId)).toBeUndefined();
  });

  it('excludes an order whose user already reviewed a product from it', async () => {
    const reviewedProductId = await createTestProduct();
    const orderId = await createTestOrder({
      userId: user.id,
      productId: reviewedProductId,
      status: 'DELIVERED',
      deliveredAt: FIVE_DAYS_AGO,
      reviewReminderSentAt: null,
    });
    orderIds.push(orderId);

    await prisma.review.create({
      data: {
        userId: user.id,
        productId: reviewedProductId,
        userName: user.name,
        rating: 5,
        comment: 'Ja avaliei este produto do pedido.',
        isVerifiedPurchase: true,
      },
    });

    try {
      const candidates = await selectOrdersForReviewReminder(NOW);
      expect(candidates.find((c) => c.orderId === orderId)).toBeUndefined();
    } finally {
      await prisma.review.deleteMany({ where: { userId: user.id, productId: reviewedProductId } });
      await prisma.orderItem.deleteMany({ where: { productId: reviewedProductId } });
      await prisma.order.delete({ where: { id: orderId } }).catch(() => undefined);
      orderIds.splice(orderIds.indexOf(orderId), 1);
      await prisma.product.delete({ where: { id: reviewedProductId } }).catch(() => undefined);
    }
  });
});
