import type { OrderEntity } from '../entities/order.js';

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

export interface OrderRepository {
  findById(id: string): Promise<OrderEntity | null>;
  findByIdempotencyKey(key: string): Promise<OrderEntity | null>;
  findByUserId(userId: string): Promise<OrderEntity[]>;
  create(data: CreateOrderInput): Promise<OrderEntity>;
}
