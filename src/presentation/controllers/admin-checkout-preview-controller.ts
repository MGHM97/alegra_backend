import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../../infra/database/prisma-client.js';
import { successResponse } from '../../shared/utils/response.js';
import {
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../domain/errors/app-error.js';
import {
  assertCouponUsable,
  computeDiscount,
  findCouponByCode,
} from '../../application/services/coupon-service.js';
import {
  PREVIEW_CLIENT_SECRET_PREFIX,
  type ConfirmPreviewIntentInput,
  type CreatePreviewIntentInput,
  type CreatePreviewOrderInput,
} from '../schemas/admin-checkout-preview-schemas.js';
/**
 * Admin Checkout Preview Controllers
 *
 * PREVIEW MODE — admin-only, no persistence, no Stripe call, no stock
 * decrement, no coupon usage increment. Used to walk through the full
 * checkout UI for QA without producing real-world side effects.
 *
 * Each handler revalidates everything server-side (prices, stock availability
 * check is informational, coupon rules) so the admin sees the same numbers
 * a real customer would see — only the persistence and Stripe call are
 * skipped.
 */

function ensureAdmin(request: FastifyRequest): void {
  const currentUser = request.currentUser;
  if (!currentUser) {
    throw new UnauthorizedError();
  }
  if (currentUser.role !== 'ADMIN') {
    throw new ForbiddenError('Recurso disponível apenas para administradores.');
  }
}

/**
 * 1×1 transparent placeholder PNG encoded as a data URL. Mirrors what Stripe
 * returns for `pix_display_qr_code.image_url_png` so the FE can render it
 * directly into <img src> without additional plumbing.
 */
const PIX_PLACEHOLDER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function buildFakePixData(): {
  qrCodeImage: string;
  qrCodeText: string;
  expiresAt: string;
} {
  const expires = new Date(Date.now() + 30 * 60 * 1000); // 30 min
  return {
    qrCodeImage: PIX_PLACEHOLDER_PNG,
    qrCodeText: `00020126360014BR.GOV.BCB.PIX0114preview-${randomUUID().slice(0, 8)}5204000053039865802BR5915ALEGRA FESTAS6009MANAUS62070503***6304ABCD`,
    expiresAt: expires.toISOString(),
  };
}

function buildFakeBoletoData(): {
  pdfUrl: string;
  barcodeNumber: string;
  expiresAt: string;
} {
  const expires = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000); // 3 days
  return {
    pdfUrl: '#preview',
    barcodeNumber: '00190.00009 02394.000007 03003.000004 8 99990000000150',
    expiresAt: expires.toISOString(),
  };
}

/**
 * POST /v1/admin/checkout-preview/create-intent
 *
 * Mirrors the response shape of /v1/payments/create-intent so the frontend
 * can swap services without changing flow logic. The clientSecret follows
 * a sentinel pattern that downstream preview endpoints validate.
 */
export async function createPreviewIntentHandler(
  request: FastifyRequest<{ Body: CreatePreviewIntentInput }>,
  reply: FastifyReply,
): Promise<void> {
  ensureAdmin(request);

  const { items, shippingCost, couponCode, paymentMethod, savedCardId, installments } =
    request.body;

  // Authoritative price revalidation — same as the real endpoint.
  const productIds = items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: { id: true, price: true, stock: true, reservedStock: true, name: true },
  });

  if (products.length !== productIds.length) {
    const found = new Set(products.map((p) => p.id));
    const missing = productIds.filter((id) => !found.has(id));
    throw new NotFoundError(`Produtos não encontrados: ${missing.join(', ')}`);
  }

  let subtotal = 0;
  for (const item of items) {
    const product = products.find((p) => p.id === item.productId);
    if (!product) continue;

    // Stock availability is checked for parity with the real flow but a
    // preview run does not actually reserve stock.
    const available = product.stock - product.reservedStock;
    if (available < item.quantity) {
      throw new ValidationError(
        `Estoque insuficiente para "${product.name}": disponível=${available}, solicitado=${item.quantity}`,
      );
    }

    subtotal += product.price.toNumber() * item.quantity;
  }

  let discountAmount = 0;
  let appliedCouponId: string | null = null;
  let appliedCouponCode: string | null = null;

  if (couponCode) {
    const coupon = await findCouponByCode(couponCode);
    assertCouponUsable(coupon, subtotal);
    discountAmount = computeDiscount(subtotal, coupon);
    appliedCouponId = coupon.id;
    appliedCouponCode = coupon.code;
  }

  // Saved-card ownership for parity with the real flow. A non-owned card id
  // is rejected even in preview to avoid leaking the existence of others'
  // cards.
  if (paymentMethod === 'saved_card' && savedCardId) {
    const card = await prisma.savedCard.findFirst({
      where: { id: savedCardId },
      select: { id: true, userId: true },
    });
    if (!card) {
      throw new NotFoundError('Cartão não encontrado.');
    }
    if (card.userId !== request.currentUser?.sub) {
      throw new ForbiddenError('Cartão não pertence a este usuário.');
    }
  }

  const totalAmount =
    Math.round((subtotal - discountAmount + shippingCost) * 100) / 100;

  // Sentinel format `preview_admin_{uuid}_secret_{uuid}`. Mirrors Stripe's
  // shape so any code that splits on `_secret_` keeps working.
  const intentId = `${PREVIEW_CLIENT_SECRET_PREFIX}${randomUUID()}`;
  const clientSecret = `${intentId}_secret_${randomUUID()}`;

  // Method-specific fake data — same shape the real /payments/create-intent
  // would return for these methods.
  const pixData = paymentMethod === 'pix' ? buildFakePixData() : null;
  const boletoData = paymentMethod === 'boleto' ? buildFakeBoletoData() : null;

  // Status mirrors what real Stripe would return per method:
  // - pix: 'requires_action' (waiting on QR scan)
  // - boleto: 'requires_action' (waiting on barcode payment)
  // - card: 'requires_payment_method' (PaymentElement still needed on FE)
  // - saved_card: 'succeeded' (off_session confirm)
  let status: string;
  if (paymentMethod === 'pix' || paymentMethod === 'boleto') {
    status = 'requires_action';
  } else if (paymentMethod === 'saved_card') {
    status = 'succeeded';
  } else {
    status = 'requires_payment_method';
  }

  request.log.info(
    {
      event: 'admin_checkout_preview_intent_created',
      adminId: request.currentUser?.sub,
      itemCount: items.length,
      subtotal,
      totalAmount,
      coupon: appliedCouponCode,
      paymentMethod,
    },
    'admin checkout preview intent created',
  );

  void reply.status(200).send(
    successResponse({
      clientSecret,
      paymentIntentId: intentId,
      paymentMethod,
      status,
      totalAmount,
      subtotal,
      discountAmount,
      shippingCost,
      installments: installments ?? 1,
      coupon: appliedCouponId
        ? { id: appliedCouponId, code: appliedCouponCode }
        : null,
      pixData,
      boletoData,
      isPreview: true,
    }),
  );
}

/**
 * POST /v1/admin/checkout-preview/confirm
 *
 * Simulates a successful Stripe confirmation. The schema already enforces
 * the sentinel prefix; here we just extract a stable paymentIntentId from
 * the clientSecret so the next step (preview order) can pass the validation
 * rule on `paymentIntentId.startsWith('preview_admin_')`.
 */
export async function confirmPreviewIntentHandler(
  request: FastifyRequest<{ Body: ConfirmPreviewIntentInput }>,
  reply: FastifyReply,
): Promise<void> {
  ensureAdmin(request);

  const { clientSecret } = request.body;

  // Extract the intent id from the sentinel: `{intentId}_secret_{uuid}`.
  // Defensive: if the format is unexpected, fall back to the raw value.
  const [intentId] = clientSecret.split('_secret_');
  const paymentIntentId =
    intentId && intentId.startsWith(PREVIEW_CLIENT_SECRET_PREFIX)
      ? intentId
      : clientSecret;

  request.log.info(
    {
      event: 'admin_checkout_preview_intent_confirmed',
      adminId: request.currentUser?.sub,
      paymentIntentId,
    },
    'admin checkout preview intent confirmed',
  );

  void reply.status(200).send(
    successResponse({
      status: 'succeeded' as const,
      paymentIntentId,
      isPreview: true,
    }),
  );
}

/**
 * POST /v1/admin/checkout-preview/order
 *
 * Returns a fake Order shaped exactly like a real one (so the success page
 * works without conditional rendering for fields). Marks `isPreview: true`
 * so the frontend can show a "this is a visualization" badge.
 *
 * NEVER persists, NEVER decrements stock, NEVER increments coupon usage.
 */
export async function createPreviewOrderHandler(
  request: FastifyRequest<{ Body: CreatePreviewOrderInput }>,
  reply: FastifyReply,
): Promise<void> {
  ensureAdmin(request);

  const {
    items,
    paymentIntentId,
    notes,
    couponCode,
    shippingCost,
    shippingMethodName,
    shippingAddressId,
    paymentMethod,
    savedCardId,
    installments,
  } = request.body;

  // Re-fetch products to get authoritative names + thumbnails for the
  // success-page summary. Same security boundary as the real endpoint.
  const productIds = items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, isActive: true },
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      thumbnailUrl: true,
      images: true,
    },
  });

  if (products.length !== productIds.length) {
    const found = new Set(products.map((p) => p.id));
    const missing = productIds.filter((id) => !found.has(id));
    throw new NotFoundError(`Produtos não encontrados: ${missing.join(', ')}`);
  }

  // Recalculate subtotal from authoritative DB prices, ignoring any
  // unitPrice the client tried to supply.
  let subtotal = 0;
  const enrichedItems = items.map((item) => {
    const product = products.find((p) => p.id === item.productId);
    if (!product) {
      // Defensive: should be unreachable due to length check above.
      throw new NotFoundError(`Produto não encontrado: ${item.productId}`);
    }
    const unitPrice = product.price.toNumber();
    const total = Math.round(unitPrice * item.quantity * 100) / 100;
    subtotal += total;
    return {
      product,
      quantity: item.quantity,
      unitPrice,
      total,
    };
  });

  let discountAmount = 0;
  let appliedCouponId: string | null = null;
  let appliedCouponCode: string | null = null;

  if (couponCode) {
    const coupon = await findCouponByCode(couponCode);
    assertCouponUsable(coupon, subtotal);
    discountAmount = computeDiscount(subtotal, coupon);
    appliedCouponId = coupon.id;
    appliedCouponCode = coupon.code;
  }

  const finalShippingCost = shippingCost ?? 0;
  const totalAmount =
    Math.round((subtotal - discountAmount + finalShippingCost) * 100) / 100;

  // Optional address resolution for a richer success-page preview.
  let shippingAddressInfo: {
    name: string | null;
    street: string | null;
    number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
  } | null = null;

  if (shippingAddressId && request.currentUser) {
    const addr = await prisma.address.findUnique({
      where: { id: shippingAddressId },
      select: {
        userId: true,
        recipientName: true,
        label: true,
        street: true,
        number: true,
        complement: true,
        neighborhood: true,
        city: true,
        state: true,
        zipCode: true,
      },
    });
    // Even admins should only preview addresses that belong to them — keeps
    // PII boundaries clean and avoids leaking other users' addresses on
    // accident.
    if (addr && addr.userId === request.currentUser.sub) {
      shippingAddressInfo = {
        name: addr.recipientName ?? addr.label,
        street: addr.street,
        number: addr.number,
        complement: addr.complement,
        neighborhood: addr.neighborhood,
        city: addr.city,
        state: addr.state,
        zipCode: addr.zipCode,
      };
    }
  }

  // Method-specific fake payment payload (same shape as create-intent).
  const pixData = paymentMethod === 'pix' ? buildFakePixData() : null;
  const boletoData = paymentMethod === 'boleto' ? buildFakeBoletoData() : null;

  const previewId = `preview_admin_${randomUUID()}`;
  const previewNumber = `PREVIEW-${randomUUID().slice(0, 8).toUpperCase()}`;
  const now = new Date();

  // For PIX/Boleto in preview, the order represents an "awaiting payment"
  // state to faithfully mirror the real customer experience. CARD/SAVED_CARD
  // remain CONFIRMED since the simulated confirm step already succeeded.
  const orderStatus: 'CONFIRMED' | 'RESERVED' =
    paymentMethod === 'pix' || paymentMethod === 'boleto'
      ? 'RESERVED'
      : 'CONFIRMED';

  const paymentStatus: string =
    paymentMethod === 'pix' || paymentMethod === 'boleto'
      ? 'requires_action'
      : 'succeeded';

  const fakeOrder = {
    id: previewId,
    number: previewNumber,
    userId: request.currentUser?.sub ?? 'preview-admin',
    status: orderStatus,
    totalAmount,
    discountAmount: discountAmount > 0 ? discountAmount : null,
    couponId: appliedCouponId,
    couponCode: appliedCouponCode,
    notes: notes
      ? `${notes} | Preview Admin: ${paymentIntentId}`
      : `Preview Admin: ${paymentIntentId}${shippingMethodName ? ` | Frete: ${shippingMethodName}` : ''}`,
    shippingAddress: shippingAddressInfo,
    shippingCost: finalShippingCost > 0 ? finalShippingCost : null,
    shippingMethodName: shippingMethodName ?? null,
    trackingCode: null,
    shippingCarrier: null,
    deliveredAt: null,
    canRequestHelp: false,
    paymentMethod,
    paymentStatus,
    pixQrCode: pixData?.qrCodeImage ?? null,
    pixQrCodeText: pixData?.qrCodeText ?? null,
    pixExpiresAt: pixData?.expiresAt ?? null,
    boletoUrl: boletoData?.pdfUrl ?? null,
    boletoBarcode: boletoData?.barcodeNumber ?? null,
    boletoExpiresAt: boletoData?.expiresAt ?? null,
    savedCardId: savedCardId ?? null,
    installments: installments ?? 1,
    createdAt: now,
    updatedAt: now,
    items: enrichedItems.map((item) => ({
      id: `preview_item_${randomUUID()}`,
      productId: item.product.id,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.total,
      product: {
        name: item.product.name,
        slug: item.product.slug,
        thumbnailUrl: item.product.thumbnailUrl,
        images: item.product.images,
      },
    })),
    isPreview: true as const,
  };

  request.log.info(
    {
      event: 'admin_checkout_preview_order_simulated',
      adminId: request.currentUser?.sub,
      previewId,
      totalAmount,
      itemCount: items.length,
      coupon: appliedCouponCode,
      paymentMethod,
    },
    'admin checkout preview order simulated (no persistence)',
  );

  void reply.status(201).send(successResponse(fakeOrder));
}
