import { IMAGE_SIZES, type ImageKind } from "./sizes";

/** @internal Fallback legado para paths relativos no formato TMDB. Não é fonte ativa. */
const LEGACY_TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/** @internal Normaliza uma string para URL absoluta se possível, senão retorna null. */
function normalizeAbsoluteImageUrl(path: string): string | null {
  const value = path.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(value)) return `https://${value}`;
  if (/^\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(value)) return `https://${value.slice(1)}`;
  return null;
}

/**
 * Resolve a URL de imagem de catálogo a partir de um kind semântico e um size nomeado.
 *
 * URLs absolutas vindas de Trakt CDN, Balloonerismm, proxy interno ou outras fontes
 * normalizadas pelo pipeline upstream são retornadas sem modificação.
 *
 * Paths relativos no formato legado TMDB (/abc.jpg) são suportados apenas como
 * fallback de compatibilidade. TMDB não é fonte ativa/canônica na arquitetura atual.
 *
 * @param kind  - Categoria semântica da imagem (poster, backdrop, etc.)
 * @param size  - Nome do size (ex: "hero", "card", "detail") — resolvido via IMAGE_SIZES.
 * @param path  - URL absoluta ou path relativo legado.
 */
export function resolveCatalogImageByKind(
  kind: ImageKind,
  size: string,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const absoluteUrl = normalizeAbsoluteImageUrl(path);
  if (absoluteUrl) return absoluteUrl;
  const sizes = IMAGE_SIZES[kind] as Record<string, string>;
  const sizeValue = sizes[size] ?? size;
  return `${LEGACY_TMDB_IMAGE_BASE}/${sizeValue}${path}`;
}

/**
 * @deprecated Use `resolveCatalogImageByKind` instead.
 * Mantido apenas para compatibilidade transitória com imports legados.
 */
export const buildTmdbUrlLoose = resolveCatalogImageByKind;

/**
 * Resolve a URL de imagem a partir de um size direto e um path.
 *
 * URLs absolutas (Trakt CDN, Balloonerismm, proxy interno) são retornadas sem modificação.
 * Paths relativos no formato legado TMDB são suportados apenas como fallback de compatibilidade.
 * TMDB não é fonte ativa/canônica na arquitetura atual.
 *
 * @deprecated Para código novo, prefira `resolveCatalogImage` de `@/lib/images/resolve`.
 */
export function buildTmdbRawUrl(
  size: string,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const absoluteUrl = normalizeAbsoluteImageUrl(path);
  if (absoluteUrl) return absoluteUrl;
  const normalized = path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`;
  return `${LEGACY_TMDB_IMAGE_BASE}/${size}${normalized}`;
}
