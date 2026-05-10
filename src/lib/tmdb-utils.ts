// src/lib/tmdb-utils.ts

import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

// ─── Texto ────────────────────────────────────────────────────────────────────

export function getTitle(item: TMDBItem): string {
  return item.title ?? item.name ?? "Título desconhecido";
}

export function getOriginalTitle(item: TMDBItem): string | null {
  return item.original_title ?? item.original_name ?? null;
}

export function getReleaseYear(item: TMDBItem): string {
  const date = item.release_date ?? item.first_air_date;
  return date ? date.slice(0, 4) : "----";
}

export function getRating(item: TMDBItem): string | null {
  if (typeof item.vote_average !== "number") return null;
  return item.vote_average.toFixed(1);
}

export function getVoteAverage(item: TMDBItem): number {
  return item.vote_average ?? 0;
}

// ─── Tipo de mídia ────────────────────────────────────────────────────────────

export function getMediaType(item: TMDBItem): TMDBMediaType {
  return item.media_type ?? "movie";
}

export function getMediaLabel(item: TMDBItem): string {
  return getMediaType(item) === "movie" ? "Filme" : "Série";
}

// ─── Imagens ──────────────────────────────────────────────────────────────────

/**
 * URL genérica para qualquer path de imagem TMDB.
 * Use getPosterUrl/getBackdropUrl quando o tipo for conhecido.
 */
export function getImageUrl(path?: string | null, size = "w780"): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function getPosterUrl(
  path?: string | null,
  size: "w342" | "w500" | "w780" = "w500",
): string | null {
  return getImageUrl(path, size);
}

export function getBackdropUrl(
  path?: string | null,
  size: "w780" | "w1280" | "original" = "w1280",
): string | null {
  return getImageUrl(path, size);
}
