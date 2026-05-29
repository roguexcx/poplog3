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
  const sizes = IMAGE_SIZES[kind] as Record<string, string>;
  const sizeValue = sizes[size] ?? size;
  return `${TMDB_IMAGE_BASE}/${sizeValue}${path}`;
}