export interface ReviewEntity {
  id: string;
  userId: string;
  productId: string;
  userName: string;
  rating: number;
  comment: string;
  photos: string[];
  createdAt: Date;
  updatedAt: Date;
}
