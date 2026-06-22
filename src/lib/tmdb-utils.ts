import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";
import { resolveDisplayTitle } from "@/lib/titles/display-title";

export function getTitle(item: TMDBItem): string {
  return resolveDisplayTitle({
    title: item.title,
    name: item.name,
    originalTitle: item.original_title,
    originalName: item.original_name,
    tmdbId: item.externalIds?.tmdbId ?? item.id,
    imdbId: item.externalIds?.imdbId,
    traktId: item.externalIds?.traktId,
    tvdbId: item.externalIds?.tvdbId,
    poplogId: item.poplogId,
    slug: item.externalIds?.slug,
    mediaType: item.media_type,
  });
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
