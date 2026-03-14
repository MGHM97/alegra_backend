import type { OrderEntity, OrderWithProductsEntity } from '../entities/order.js';

export interface CreateOrderItemInput {
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface CreateOrderInput {
  userId: string;
  items: CreateOrderItemInput[];
  idempotencyKey?: string;
  notes?: string;
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
