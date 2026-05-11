// src/lib/images/url.ts

import { IMAGE_SIZES, type ImageKind, type ImageSizeOf } from "./sizes";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/**
 * Builder semântico de URLs de imagem do TMDB.
 *
 * Exemplos:
 *   buildTmdbUrl("poster",   "card",   "/abc.jpg") → ".../t/p/w342/abc.jpg"
 *   buildTmdbUrl("backdrop", "hero",   "/abc.jpg") → ".../t/p/w1280/abc.jpg"
 *   buildTmdbUrl("backdrop", "full",   "/abc.jpg") → ".../t/p/original/abc.jpg"
 *
 * Quando `path` é null/undefined, retorna `null` (sem throws).
 */
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

/**
 * Variante "frouxa" do builder — aceita o `size` como string livre.
 * Útil para migração progressiva de código legado que ainda usa
 * códigos TMDB diretos ("w342", "w780", "original").
 *
 * Prefira `buildTmdbUrl` em código novo.
 */
export function buildTmdbUrlLoose(
  kind: ImageKind,
  size: string,
  path: string | null | undefined,
): string | null {
  if (!path) return null;
  const sizes = IMAGE_SIZES[kind] as Record<string, string>;
  const sizeValue = sizes[size] ?? size; // permite passar "w342" direto
  return `${TMDB_IMAGE_BASE}/${sizeValue}${path}`;
}
