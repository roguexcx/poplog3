/**
 * Genre/mood filter logic for the Trakt Index.
 *
 * Mirrors the filtering rules from the Trakt Discovery Lab HTML reference,
 * applied against TraktIndexItem.genres (Trakt genre slugs).
 */

import type { TraktIndexItem } from "@/lib/trakt-index/types";
import type { DiscoveryFilter } from "./shortcuts-config";

export function normSlug(s: string): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function itemTextHay(item: TraktIndexItem): string {
  return [
    item.title,
    item.original_title,
    item.overview,
    (item.genres || []).join(" "),
  ]
    .join(" ")
    .toLowerCase();
}

function textMatch(item: TraktIndexItem, filter: DiscoveryFilter): boolean {
  const keys = (filter.keywords || []).map((k) => k.toLowerCase());
  if (!keys.length) return false;
  const hay = itemTextHay(item);
  return keys.some((k) => hay.includes(k));
}

function hasExcludedSlug(genres: string[], filter: DiscoveryFilter): boolean {
  const excluded = (filter.excludeSlugs || []).map(normSlug);
  return excluded.length > 0 && excluded.some((s) => genres.includes(s));
}

function baseGenreMatch(genres: string[], filter: DiscoveryFilter): boolean {
  const wanted = filter.slugs.map(normSlug);
  if (filter.mode === "all") return wanted.every((s) => genres.includes(s));
  return wanted.some((s) => genres.includes(s));
}

export function matchesFilter(item: TraktIndexItem, filter: DiscoveryFilter): boolean {
  const genres = (item.genres || []).map(normSlug);

  if (hasExcludedSlug(genres, filter)) return false;

  const genreOk = baseGenreMatch(genres, filter);
  const textOk = textMatch(item, filter);

  if (filter.strict) {
    return (genreOk || textOk) && !hasExcludedSlug(genres, filter);
  }
  return genreOk || textOk;
}

export function filterTraktItems(
  items: TraktIndexItem[],
  filter: DiscoveryFilter,
  mediaType: "movie" | "tv" | "all" = "all",
): TraktIndexItem[] {
  let result = items.filter((item) => matchesFilter(item, filter));
  if (mediaType !== "all") {
    result = result.filter((item) => item.media_type === mediaType);
  }
  return result;
}

/** Build the genre query string for popular-by-genre Trakt calls. */
export function popularFallbackGenreQuery(filter: DiscoveryFilter): string {
  const skip = new Set(["news", "children", "donghua", "suspense"]);
  const preferred = filter.slugs.map(normSlug).filter((s) => !skip.has(s));
  const slugs = preferred.length ? preferred : filter.slugs.map(normSlug);
  return [...new Set(slugs)].slice(0, 4).join(",");
}
