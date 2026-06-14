import type { FastifyInstance } from 'fastify';
import { uploadProductImagesHandler } from '../controllers/admin-upload-controller.js';
import { authGuard, requireRole } from '../../shared/middlewares/auth-guard.js';

export async function adminUploadRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.addHook('preHandler', authGuard);
  fastify.addHook('preHandler', requireRole('ADMIN'));

  /**
   * POST /v1/admin/uploads/images
   *
   * Faz upload de imagens de produto.
   * Content-Type: multipart/form-data
   * Campo: files (múltiplos, até 5)
   * Formatos: JPEG, PNG, WebP, GIF, AVIF — máximo 5 MB/arquivo
   */
  fastify.post('/images', {
    handler: uploadProductImagesHandler,
  });
}
