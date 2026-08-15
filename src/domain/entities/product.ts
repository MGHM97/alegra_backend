import type { Decimal } from '@prisma/client/runtime/library';

// Server-side sort for GET /v1/products (Mercado Livre-style listing).
// 'relevance' has no ranking signal of its own today (no full-text-search
// rank column) — it always resolves to the same tuple as 'newest'
// (createdAt desc), including when `search` is set, matching the previous
// (pre-sort) fixed ordering exactly.
export type ProductSort =
  | 'relevance'
  | 'price_asc'
  | 'price_desc'
  | 'newest'
  | 'best_sellers'
  | 'top_rated'
  | 'discount';

export interface ProductEntity {
  id: string;
  name: string;
  slug: string;
  description: string;
  shortDescription: string;
  price: Decimal;
  originalPrice: Decimal | null;
  currency: string;
  category: string;
  subcategory: string | null;
  images: string[];
  thumbnailUrl: string;
  badges: string[];
  specifications: Record<string, unknown>;
  stock: number;
  reservedStock: number;
  sku: string;
  weight: Decimal;
  isActive: boolean;
  maxInstallments: number;
  installmentPrice: Decimal | null;
  videoUrl: string | null;
  // Agregados denormalizados — ver comentário em prisma/schema.prisma.
  // averageRating é null enquanto o produto não tiver nenhuma review.
  averageRating: Decimal | null;
  reviewCount: number;
  soldCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  shortDescription: string;
  price: Decimal;
  originalPrice: Decimal | null;
  currency: string;
  category: string;
  thumbnailUrl: string;
  badges: string[];
  stock: number;
  reservedStock: number;
  maxInstallments: number;
  installmentPrice: Decimal | null;
  isActive: boolean;
  averageRating: Decimal | null;
  reviewCount: number;
  soldCount: number;
}
