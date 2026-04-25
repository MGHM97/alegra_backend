export interface WishlistItem {
  id: string;
  userId: string;
  productId: string;
  createdAt: Date;
}

export interface WishlistItemWithProduct extends WishlistItem {
  product: {
    id: string;
    name: string;
    slug: string;
    shortDescription: string;
    price: number;
    originalPrice: number | null;
    currency: string;
    category: string;
    thumbnailUrl: string;
    badges: string[];
    stock: number;
    reservedStock: number;
    availableStock: number;
    maxInstallments: number;
    installmentPrice: number | null;
    isActive: boolean;
  };
}
