import type {
  OrderEntity,
  OrderWithProductsEntity,
  PaymentMethod,
  PaymentStatus,
} from '../entities/order.js';

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateOrderShippingAddress {
  recipientName: string | null;
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

export interface CreateOrderInput {
  userId: string;
  items: CreateOrderItemInput[];
  idempotencyKey?: string;
  notes?: string;
  couponCode?: string;
  shippingCost?: number;
  shippingMethodName?: string;
  shippingCarrier?: string;
  shippingAddress?: CreateOrderShippingAddress;
  paymentIntentId?: string;
  paymentMethod?: PaymentMethod;
  paymentStatus?: PaymentStatus;
  installments?: number;
  savedCardId?: string;
  pixQrCode?: string;
  pixQrCodeText?: string;
  pixExpiresAt?: Date;
  boletoUrl?: string;
  boletoBarcode?: string;
  boletoExpiresAt?: Date;
}

export interface OrderListFilters {
  period?: number; // months
  search?: string;
}

export interface OrderRepository {
  findById(id: string): Promise<OrderEntity | null>;
  findByIdWithProducts(id: string): Promise<OrderWithProductsEntity | null>;
  findByIdempotencyKey(key: string): Promise<OrderEntity | null>;
  findByUserId(userId: string): Promise<OrderEntity[]>;
  findByUserIdWithProducts(userId: string, filters?: OrderListFilters): Promise<OrderWithProductsEntity[]>;
  create(data: CreateOrderInput): Promise<OrderEntity>;
}
