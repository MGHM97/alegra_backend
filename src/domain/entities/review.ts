export interface ReviewEntity {
  id: string;
  userId: string;
  productId: string;
  userName: string;
  rating: number;
  comment: string;
  photos: string[];
  isVerifiedPurchase: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReviewWithRelations extends ReviewEntity {
  user: {
    id: string;
    name: string;
    email: string;
  };
  product: {
    id: string;
    name: string;
    slug: string;
    thumbnailUrl: string;
  };
}

export interface AdminReviewListFilters {
  cursor?: string;
  limit?: number;
  productId?: string;
  userId?: string;
  rating?: number;
  search?: string;
}

export interface AdminReviewListResult {
  data: ReviewWithRelations[];
  nextCursor: string | null;
  hasMore: boolean;
}
