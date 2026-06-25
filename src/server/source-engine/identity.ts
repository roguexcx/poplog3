import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";

export type CanonicalIdentityInput = {
  imdbId?: string | null;
  traktId?: string | number | null;
  tmdbId?: string | number | null;
  wikidataId?: string | null;
  slug?: string | null;
  title?: string | null;
  year?: string | number | null;
};

export function normalizeImdbId(value?: string | null): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized && /^tt\d+$/.test(normalized) ? normalized : null;
}

export function canonicalIdentityKey(input: CanonicalIdentityInput): string {
  const imdbId = normalizeImdbId(input.imdbId);
  if (imdbId) return `imdb:${imdbId}`;
  if (input.traktId) return `trakt:${input.traktId}`;
  if (input.tmdbId) return `tmdb:${input.tmdbId}`;
  if (input.wikidataId) return `wikidata:${input.wikidataId}`;
  if (input.slug) return `slug:${input.slug}`;
  return `title:${normalizeSearchTerm(input.title ?? "")}:${input.year ?? ""}`;
}

export function stablePublicSlug(input: {
  title: string;
  year?: string | number | null;
  collision?: boolean;
}): string {
  const base = normalizeSearchTerm(input.title)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const suffix = input.collision && input.year ? `-${input.year}` : "";
  return `${base || "titulo"}${suffix}`;
}

