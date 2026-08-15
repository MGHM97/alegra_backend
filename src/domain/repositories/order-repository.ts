import type {
  OrderEntity,
  OrderWithProductsEntity,
  PaymentMethod,
  PaymentStatus,
} from '../entities/order.js';

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  /**
   * Opcional: quando presente, é comparado ao preço atual do produto no
   * banco e uma divergência lança PriceMismatchError. Quando ausente, o
   * preço do banco é usado diretamente. Em ambos os casos, o preço
   * efetivamente gravado no pedido é sempre o do banco — o cliente nunca é
   * a fonte de verdade do preço.
   */
  unitPrice?: number;
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
  /**
   * Cursor-based pagination (same pattern as admin-order-controller.ts):
   * `cursor` is the `id` of the last order seen on the previous page,
   * `limit` is the page size. When `limit` is set, the repository fetches
   * `limit + 1` rows internally so the caller can detect `hasMore` without
   * a second COUNT query.
   */
  cursor?: string;
  limit?: number;
}

export interface OrderRepository {
  findById(id: string): Promise<OrderEntity | null>;
  findByIdWithProducts(id: string): Promise<OrderWithProductsEntity | null>;
  findByIdempotencyKey(key: string): Promise<OrderEntity | null>;
  findByUserId(userId: string): Promise<OrderEntity[]>;
  findByUserIdWithProducts(userId: string, filters?: OrderListFilters): Promise<OrderWithProductsEntity[]>;
  create(data: CreateOrderInput): Promise<OrderEntity>;
}
