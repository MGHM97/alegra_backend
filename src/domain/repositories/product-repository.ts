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

export interface CreateProductInput {
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  price: number;
  originalPrice?: number | null;
  currency?: string;
  category: string;
  subcategory?: string | null;
  images: string[];
  thumbnailUrl: string;
  badges?: string[];
  specifications?: Record<string, unknown>;
  stock: number;
  sku: string;
  weight: number;
  isActive?: boolean;
  maxInstallments?: number;
  installmentPrice?: number | null;
  videoUrl?: string | null;
}

export interface UpdateProductInput {
  name?: string;
  slug?: string;
  description?: string;
  shortDescription?: string;
  price?: number;
  originalPrice?: number | null;
  currency?: string;
  category?: string;
  subcategory?: string | null;
  images?: string[];
  thumbnailUrl?: string;
  badges?: string[];
  specifications?: Record<string, unknown>;
  stock?: number;
  sku?: string;
  weight?: number;
  isActive?: boolean;
  maxInstallments?: number;
  installmentPrice?: number | null;
  videoUrl?: string | null;
}

export interface ProductRepository {
  findById(id: string): Promise<ProductEntity | null>;
  findBySlug(slug: string): Promise<ProductEntity | null>;
  findMany(
    filters: ProductFilters,
    pagination: CursorPaginationParams,
  ): Promise<PaginatedResult<ProductListItem>>;
  getAvailableStock(productId: string): Promise<number>;
  create(data: CreateProductInput): Promise<ProductEntity>;
  update(id: string, data: UpdateProductInput): Promise<ProductEntity>;
  delete(id: string): Promise<void>;
}
