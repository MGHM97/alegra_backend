/**
 * Chave/TTL do cache de GET /sitemap.xml (ver src/app.ts). Centralizados
 * aqui para que a invalidação em admin-product-controller.ts nunca dessincronize
 * do valor real usado pela rota.
 */
export const SITEMAP_CACHE_KEY = 'sitemap:xml';
export const SITEMAP_CACHE_TTL_SECONDS = 60 * 60; // 1h

// Google Imagens não documenta um limite oficial de <image:image> por <url>,
// mas recomenda manter a listagem enxuta às imagens realmente relevantes do
// produto — 5 casa com o limite de upload de imagens por produto (ver
// admin-upload-controller.ts).
export const SITEMAP_MAX_IMAGES_PER_PRODUCT = 5;

/**
 * Escapa os 5 caracteres reservados de XML. Necessário em qualquer texto de
 * origem do banco (nome de produto, URL de imagem) inserido no sitemap —
 * nunca confiar que `name`/`images` já vêm seguros para XML.
 */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * `Product.images` pode conter URLs absolutas (seed/produtos antigos) ou
 * caminhos relativos de upload (`/uploads/produtos/xxx.jpg`, ver
 * admin-upload-controller.ts). Google Imagens exige `<image:loc>` absoluto.
 */
export function resolveSitemapImageUrl(baseUrl: string, image: string): string {
  if (/^https?:\/\//i.test(image)) return image;
  return `${baseUrl}${image.startsWith('/') ? image : `/${image}`}`;
}
