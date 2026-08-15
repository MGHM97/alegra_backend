import path from 'node:path';
import fs from 'node:fs';
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

/**
 * `@fastify/multipart` lança `FST_REQ_FILE_TOO_LARGE` de dentro de
 * `part.toBuffer()` quando o arquivo excede `limits.fileSize` (comportamento
 * padrão com `throwFileSizeLimit: true`, o default do plugin).
 */
function isFileTooLargeError(err: unknown): boolean {
  return (
    err instanceof Error &&
    'code' in err &&
    (err as { code: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  );
}

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

  // file-type é ESM-only; import dinâmico funciona mesmo com o projeto
  // compilando para CJS (ver memória do agente sobre import.meta/Node16).
  const { fileTypeFromBuffer } = await import('file-type');

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

    let buffer: Buffer;
    try {
      buffer = await part.toBuffer();
    } catch (err: unknown) {
      if (isFileTooLargeError(err)) {
        throw new ValidationError('Cada imagem deve ter no máximo 5 MB.');
      }
      request.log.error({ err }, 'Falha ao ler upload de imagem.');
      throw new ValidationError('Erro ao processar a imagem. Tente novamente.');
    }

    // Defesa extra: cobre o caso de `throwFileSizeLimit` vir desabilitado.
    if (part.file.truncated) {
      throw new ValidationError('Cada imagem deve ter no máximo 5 MB.');
    }

    // Valida os magic bytes reais do arquivo: `mimetype` e a extensão vêm
    // do cliente e podem ser forjados (ex.: um HTML malicioso renomeado
    // para .jpg com Content-Type falso). Rejeita se a assinatura binária
    // não for reconhecida, não estiver entre os tipos aceitos, ou divergir
    // do Content-Type declarado.
    const detected = await fileTypeFromBuffer(buffer);
    if (!detected || !ACCEPTED_MIME_TYPES.has(detected.mime) || detected.mime !== mimetype) {
      throw new ValidationError(
        'Arquivo inválido: o conteúdo não corresponde a uma imagem suportada.',
      );
    }

    const ext = MIME_TO_EXT[mimetype] ?? originalExt;
    const filename = `${randomUUID()}${ext}`;
    const filePath = path.join(uploadsDir, filename);

    try {
      await fs.promises.writeFile(filePath, buffer);
    } catch (err: unknown) {
      await fs.promises.unlink(filePath).catch(() => undefined);
      request.log.error({ err }, 'Falha ao salvar imagem no disco.');
      throw new ValidationError('Erro ao salvar a imagem. Tente novamente.');
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
