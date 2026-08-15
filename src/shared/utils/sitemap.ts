/**
 * Chave/TTL do cache de GET /sitemap.xml (ver src/app.ts). Centralizados
 * aqui para que a invalidação em admin-product-controller.ts nunca dessincronize
 * do valor real usado pela rota.
 */
export const SITEMAP_CACHE_KEY = 'sitemap:xml';
export const SITEMAP_CACHE_TTL_SECONDS = 60 * 60; // 1h
