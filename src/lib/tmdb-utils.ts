import type { TMDBItem, TMDBMediaType } from "@/types/tmdb";

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
