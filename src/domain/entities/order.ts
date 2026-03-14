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
  deliveredAt: Date | null;
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
