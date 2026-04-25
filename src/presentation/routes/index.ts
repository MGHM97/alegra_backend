import type { FastifyInstance } from 'fastify';
import { authRoutes } from './auth-routes.js';
import { productRoutes } from './product-routes.js';
import { orderRoutes } from './order-routes.js';
import { inventoryRoutes } from './inventory-routes.js';
import { addressRoutes } from './address-routes.js';
import { savedCardRoutes } from './saved-card-routes.js';
import { reviewRoutes } from './review-routes.js';
import { adminProductRoutes } from './admin-product-routes.js';
import { adminOrderRoutes } from './admin-order-routes.js';
import { adminUserRoutes } from './admin-user-routes.js';
import { adminCouponRoutes } from './admin-coupon-routes.js';
import { adminMetricsRoutes } from './admin-metrics-routes.js';
import { adminReviewRoutes } from './admin-review-routes.js';
import { adminCheckoutPreviewRoutes } from './admin-checkout-preview-routes.js';
import { shippingRoutes } from './shipping-routes.js';
import { paymentRoutes } from './payment-routes.js';
import { contactRoutes } from './contact-routes.js';
import { couponRoutes } from './coupon-routes.js';
import { wishlistRoutes } from './wishlist-routes.js';
import { newsletterRoutes } from './newsletter-routes.js';

export async function registerRoutes(fastify: FastifyInstance): Promise<void> {
  await fastify.register(authRoutes, { prefix: '/v1/auth' });
  await fastify.register(productRoutes, { prefix: '/v1/products' });
  await fastify.register(orderRoutes, { prefix: '/v1/orders' });
  await fastify.register(inventoryRoutes, { prefix: '/v1/inventory' });
  await fastify.register(addressRoutes, { prefix: '/v1/addresses' });
  await fastify.register(savedCardRoutes, { prefix: '/v1/cards' });
  await fastify.register(reviewRoutes, { prefix: '/v1/reviews' });
  await fastify.register(couponRoutes, { prefix: '/v1/coupons' });
  await fastify.register(wishlistRoutes, { prefix: '/v1/wishlist' });
  await fastify.register(adminProductRoutes, { prefix: '/v1/admin/products' });
  await fastify.register(adminOrderRoutes, { prefix: '/v1/admin/orders' });
  await fastify.register(adminUserRoutes, { prefix: '/v1/admin/users' });
  await fastify.register(adminCouponRoutes, { prefix: '/v1/admin/coupons' });
  await fastify.register(adminMetricsRoutes, { prefix: '/v1/admin/metrics' });
  await fastify.register(adminReviewRoutes, { prefix: '/v1/admin/reviews' });
  await fastify.register(adminCheckoutPreviewRoutes, {
    prefix: '/v1/admin/checkout-preview',
  });
  await fastify.register(shippingRoutes, { prefix: '/v1/shipping' });
  await fastify.register(paymentRoutes, { prefix: '/v1/payments' });
  await fastify.register(contactRoutes, { prefix: '/v1/contact' });
  await fastify.register(newsletterRoutes, { prefix: '/v1/newsletter' });
}
