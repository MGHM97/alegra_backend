import type { ProductEntity, ProductListItem } from '../entities/product.js';

export interface ProductFilters {
  category?: string;
  search?: string;
  minPrice?: number;
  maxPrice?: number;
  isActive?: boolean;
  badges?: string[];
}

export interface CursorPaginationParams {
  cursor?: string;
  limit: number;
}

export interface PaginatedResult<T> {
  items: T[];
  cursor: string | null;
  hasMore: boolean;
}

export interface ProductRepository {
  findById(id: string): Promise<ProductEntity | null>;
  findBySlug(slug: string): Promise<ProductEntity | null>;
  findMany(
    filters: ProductFilters,
    pagination: CursorPaginationParams,
  ): Promise<PaginatedResult<ProductListItem>>;
  getAvailableStock(productId: string): Promise<number>;
}
