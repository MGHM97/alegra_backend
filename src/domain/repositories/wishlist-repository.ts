import type { WishlistItem, WishlistItemWithProduct } from '../entities/wishlist-item.js';

export interface WishlistRepository {
  /**
   * Lists all wishlist items for a user, joined with their products.
   * Returns items ordered by `createdAt DESC` (most recent first).
   */
  findByUserId(userId: string): Promise<WishlistItemWithProduct[]>;

  /**
   * Returns a wishlist item if the (userId, productId) pair already
   * exists. Used to make POST idempotent.
   */
  findByUserAndProduct(userId: string, productId: string): Promise<WishlistItem | null>;

  /**
   * Creates a new wishlist item. Caller MUST guarantee uniqueness
   * via `findByUserAndProduct` first to avoid hitting the unique
   * constraint exception.
   */
  create(userId: string, productId: string): Promise<WishlistItem>;

  /**
   * Removes the wishlist item identified by (userId, productId).
   * Idempotent: if no row matches, no error is thrown.
   */
  delete(userId: string, productId: string): Promise<void>;
}
