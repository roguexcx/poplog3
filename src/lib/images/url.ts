import { IMAGE_SIZES, type ImageKind, type ImageSizeOf } from "./sizes";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

export function buildTmdbUrl<K extends ImageKind>(
  kind: K,
  size: ImageSizeOf<K>,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const sizeValue = (IMAGE_SIZES[kind] as Record<string, string>)[size as string];
  if (!sizeValue) return null;
  return `${TMDB_IMAGE_BASE}/${sizeValue}${path}`;
}

export function buildTmdbUrlLoose(
  kind: ImageKind,
  size: string,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  // URL completa (Trakt, TheTVDB, etc.) — passar sem modificar
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
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
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
}