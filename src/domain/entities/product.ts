import type { Decimal } from '@prisma/client/runtime/library';

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
}
