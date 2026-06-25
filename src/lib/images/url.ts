import { IMAGE_SIZES, type ImageKind } from "./sizes";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

function normalizeAbsoluteImageUrl(path: string): string | null {
  const value = path.trim();
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (/^[a-z0-9.-]+\.[a-z]{2,}\//i.test(value)) return `https://${value}`;
  if (/^\/[a-z0-9.-]+\.[a-z]{2,}\//i.test(value)) return `https://${value.slice(1)}`;
  return null;
}

export function buildTmdbUrlLoose(
  kind: ImageKind,
  size: string,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  // URL completa (Trakt, Balloonerismm, CDN próprio etc.) — passar sem modificar
  const absoluteUrl = normalizeAbsoluteImageUrl(path);
  if (absoluteUrl) return absoluteUrl;
  const sizes = IMAGE_SIZES[kind] as Record<string, string>;
  const sizeValue = sizes[size] ?? size;
  return `${TMDB_IMAGE_BASE}/${sizeValue}${path}`;
}

/**
 * Constrói URL de imagem a partir de um size direto e um path.
 * Aceita tanto paths TMDB (/abc.jpg) quanto URLs completas (passthrough).
 * Alias mantido para compatibilidade com código existente.
 */
export function buildTmdbRawUrl(
  size: string,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const absoluteUrl = normalizeAbsoluteImageUrl(path);
  if (absoluteUrl) return absoluteUrl;
  const normalized = path.trim().startsWith("/") ? path.trim() : `/${path.trim()}`;
  return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
}
