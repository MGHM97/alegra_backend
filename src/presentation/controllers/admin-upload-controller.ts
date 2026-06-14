import path from 'node:path';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ValidationError } from '../../domain/errors/app-error.js';
import { successResponse } from '../../shared/utils/response.js';

/** Tipos MIME aceitos para upload de imagens de produto */
const ACCEPTED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

/** Extensões aceitas — validadas em conjunto com o MIME type */
const ACCEPTED_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif']);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

const MAX_FILES = 5;

function getUploadsDir(): string {
  // __dirname (CJS/tsx): src/presentation/controllers/ → ../../.. → raiz do projeto
  // Em produção (dist/): dist/presentation/controllers/ → ../../.. → raiz do projeto
  // Em ambos os casos três níveis acima chega à raiz onde fica public/uploads/products
  return path.join(__dirname, '..', '..', '..', 'public', 'uploads', 'products');
}

/**
 * POST /v1/admin/uploads/images
 *
 * Faz upload de até 5 imagens de produto e devolve as URLs públicas.
 * Formatos aceitos: JPEG, PNG, WebP, GIF, AVIF — máximo 5 MB por arquivo.
 */
export async function uploadProductImagesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const parts = request.files();

  const urls: string[] = [];
  const uploadsDir = getUploadsDir();

  // Garante que o diretório existe em runtime
  await fs.promises.mkdir(uploadsDir, { recursive: true });

  for await (const part of parts) {
    if (urls.length >= MAX_FILES) {
      // Drena o stream restante para evitar memory leak e rejeita
      await part.toBuffer().catch(() => undefined);
      throw new ValidationError('Envie no máximo 5 imagens.');
    }

    const mimetype = part.mimetype;
    const originalName = part.filename ?? '';
    const originalExt = path.extname(originalName).toLowerCase();

    // Valida MIME type
    if (!ACCEPTED_MIME_TYPES.has(mimetype)) {
      await part.toBuffer().catch(() => undefined);
      throw new ValidationError('Formato de imagem não suportado.');
    }

    // Valida extensão (quando presente — alguns clientes podem omiti-la)
    if (originalExt && !ACCEPTED_EXTENSIONS.has(originalExt)) {
      await part.toBuffer().catch(() => undefined);
      throw new ValidationError('Formato de imagem não suportado.');
    }

    const ext = MIME_TO_EXT[mimetype] ?? originalExt;
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    try {
      const writeStream = fs.createWriteStream(filePath);
      await pipeline(part.file, writeStream);
    } catch (err: unknown) {
      // Remove arquivo parcial em caso de falha
      await fs.promises.unlink(filePath).catch(() => undefined);
      request.log.error({ err }, 'Falha ao salvar imagem no disco.');
      throw new ValidationError('Erro ao salvar a imagem. Tente novamente.');
    }

    // Verifica se o @fastify/multipart rejeitou o arquivo por tamanho
    if (part.file.truncated) {
      await fs.promises.unlink(filePath).catch(() => undefined);
      throw new ValidationError('Cada imagem deve ter no máximo 5 MB.');
    }

    const baseUrl =
      (process.env['PUBLIC_ASSET_BASE_URL'] as string | undefined) ??
      `${request.protocol}://${request.hostname}`;

    const url = `${baseUrl}/uploads/products/${filename}`;
    urls.push(url);
  }

  if (urls.length === 0) {
    throw new ValidationError('Nenhuma imagem enviada.');
  }

  void reply.status(201).send(successResponse({ urls }));
}
