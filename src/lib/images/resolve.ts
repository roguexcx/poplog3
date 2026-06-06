/**
 * resolve.ts — Helper canônico para resolução de URLs de imagem do catálogo.
 *
 * Aceita qualquer formato de entrada:
 *   - URL completa (Balloonerismm, IMDb, TVDB, CDN próprio) → passthrough
 *   - Path TMDB legado (/abc.jpg ou abc.jpg) → prepend image.tmdb.org
 *   - null / undefined / string vazia → null
 *
 * Este módulo é seguro para uso tanto no servidor quanto no cliente.
 * Pode ser importado por componentes React ("use client"), route handlers, etc.
 *
 * @example
 *   resolveCatalogImage("/abc.jpg", "w500")
 *   // → "https://image.tmdb.org/t/p/w500/abc.jpg"
 *
 *   resolveCatalogImage("https://m.media-amazon.com/images/xxx.jpg")
 *   // → "https://m.media-amazon.com/images/xxx.jpg"  (passthrough)
 *
 *   resolveCatalogImage(null)
 *   // → null
 */

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/**
 * Tamanhos convenientes para uso direto sem passar o mapa de sizes.
 * Para sizes completos, importar de `@/lib/images/sizes`.
 */
export type CatalogImageSize =
  | "w45"
  | "w92"
  | "w185"
  | "w300"
  | "w342"
  | "w500"
  | "w780"
  | "w1280"
  | "original";

/**
 * Resolve o valor de qualquer campo de imagem para uma URL final válida ou null.
 *
 * @param src   - URL completa, path TMDB legado, null, undefined ou string vazia.
 * @param size  - Tamanho para paths TMDB legados (ignorado para URLs completas).
 *               Default: "w500".
 */
export function resolveCatalogImage(
  src: string | null | undefined,
  size: CatalogImageSize | string = "w500",
): string | null {
  if (!src || src.trim() === "") return null;
  const normalizedSource = src.trim();
  // URL completa — Balloonerismm, IMDb, TVDB, CDN próprio
  if (normalizedSource.startsWith("http://") || normalizedSource.startsWith("https://")) return normalizedSource;
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(normalizedSource)) return `https://${normalizedSource}`;
  // Path TMDB legado (com ou sem / inicial)
  const normalized = normalizedSource.startsWith("/") ? normalizedSource : `/${normalizedSource}`;
  return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
}

/**
 * Alias para compatibilidade com o nome usado em CatalogImage.tsx.
 * Preferir `resolveCatalogImage` em código novo.
 */
export const resolveCatalogImageUrl = resolveCatalogImage;
