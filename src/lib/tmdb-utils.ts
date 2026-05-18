import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";
import { buildTmdbUrlLoose } from "@/lib/images/url";

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

export function getMediaType(item: TMDBItem): TMDBMediaType {
  return item.media_type ?? "movie";
}

export function getMediaLabel(item: TMDBItem): string {
  return getMediaType(item) === "movie" ? "Filme" : "Série";
}

/** @deprecated Use buildTmdbUrl de @/lib/images ou o componente TmdbImage. */
export function getImageUrl(path?: string | null, size = "w780"): string | null {
  const kind = size.startsWith("h") ? "profile" : "backdrop";
  return buildTmdbUrlLoose(kind, size, path);
}

/** @deprecated Use buildTmdbUrl("poster", ..., path). */
export function getPosterUrl(
  path?: string | null,
  size: "w342" | "w500" | "w780" = "w500",
): string | null {
  return buildTmdbUrlLoose("poster", size, path);
}

/** @deprecated Use buildTmdbUrl("backdrop", ..., path). */
export function getBackdropUrl(
  path?: string | null,
  size: "w780" | "w1280" | "original" = "w1280",
): string | null {
  return buildTmdbUrlLoose("backdrop", size, path);
}
