import type { FastifyInstance } from 'fastify';
import {
  listWishlistHandler,
  addToWishlistHandler,
  removeFromWishlistHandler,
} from '../controllers/wishlist-controller.js';
import { addToWishlistSchema } from '../schemas/wishlist-schemas.js';
import { validateBody } from '../../shared/middlewares/validate.js';
import { authGuard } from '../../shared/middlewares/auth-guard.js';

export async function wishlistRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);

  fastify.get('/', { handler: listWishlistHandler });

  fastify.post('/', {
    preHandler: [validateBody(addToWishlistSchema)],
    handler: addToWishlistHandler,
  });

  fastify.delete('/:productId', { handler: removeFromWishlistHandler });
}
