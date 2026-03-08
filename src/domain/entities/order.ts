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
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemEntity[];
}
