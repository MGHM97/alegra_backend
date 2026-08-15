import type { Decimal } from '@prisma/client/runtime/library';

export type OrderStatus =
  | 'PENDING'
  | 'RESERVED'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'REFUNDED';

export type PaymentMethod = 'PIX' | 'CARD' | 'SAVED_CARD' | 'BOLETO';

export type PaymentStatus =
  | 'PENDING'
  | 'REQUIRES_ACTION'
  | 'REQUIRES_CONFIRMATION'
  | 'PROCESSING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCELED'
  | 'DISPUTED'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED';

export interface OrderItemEntity {
  id: string;
  orderId: string;
  productId: string;
  quantity: number;
  unitPrice: Decimal;
  total: Decimal;
}

export interface OrderEntity {
  id: string;
  userId: string;
  status: OrderStatus;
  totalAmount: Decimal;
  idempotencyKey: string | null;
  reservedUntil: Date | null;
  notes: string | null;
  shippingName: string | null;
  shippingStreet: string | null;
  shippingNumber: string | null;
  shippingComplement: string | null;
  shippingNeighborhood: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingZipCode: string | null;
  trackingCode: string | null;
  shippingCarrier: string | null;
  shippingMethodName: string | null;
  shippingCost: Decimal | null;
  deliveredAt: Date | null;
  couponId: string | null;
  couponCode: string | null;
  discountAmount: Decimal | null;
  paymentMethod: PaymentMethod | null;
  paymentStatus: PaymentStatus | null;
  paidAt: Date | null;
  refundedAmount: Decimal;
  installments: number;
  installmentFee: Decimal | null;
  pixQrCode: string | null;
  pixQrCodeText: string | null;
  pixExpiresAt: Date | null;
  boletoUrl: string | null;
  boletoBarcode: string | null;
  boletoExpiresAt: Date | null;
  savedCardId: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemEntity[];
}

export interface OrderWithProductsEntity extends OrderEntity {
  items: OrderItemWithProductEntity[];
}

export interface OrderItemWithProductEntity extends OrderItemEntity {
  product: {
    name: string;
    slug: string;
    thumbnailUrl: string;
    images: string[];
  };
}
