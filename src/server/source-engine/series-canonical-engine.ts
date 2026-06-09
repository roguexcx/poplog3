/**
 * Series Canonical Engine.
 *
 * Trakt-only implementation. The contract is intentionally stable so future
 * cache layers, workers or read replicas can be added without changing callers.
 */

import { traktAdapter } from "./adapters/trakt-adapter";

export type SeriesCanonicalIds = {
  imdb?: string;
  tvdb?: number;
  trakt?: number | string;
  tmdb?: number;
  slug?: string;
};

export type SeriesSourceEntry = {
  source: "trakt";
  sourceId: string | number;
  confidence: number;
  ids: SeriesCanonicalIds;
  title?: string;
  year?: number;
  hasEpisodes: boolean;
  hasImages: boolean;
  hasTrailer: boolean;
  hasMetadata: boolean;
};

export type SeriesCanonicalMeta = {
  title?: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  status?: string;
  language?: string;
  ids: SeriesCanonicalIds;
  poster?: string;
  backdrop?: string;
  thumbnail?: string;
  logo?: string;
  imagePool: string[];
  trailerUrl?: string;
  homepage?: string;
  tagline?: string;
  runtime?: number;
  rating?: number;
  votes?: number;
  network?: string;
  networks: string[];
  genres: string[];
  companies: string[];
  availableTranslations: string[];
  lastAirDate?: string;
  airedEpisodes?: number;
  numberOfEpisodes?: number;
  numberOfSeasons?: number;
  sources: SeriesSourceEntry[];
  sourceCount: number;
  mergeConfidence: number;
  debug?: {
    fieldSources?: Record<string, string>;
  };
};

function imagePool(...urls: Array<string | null | undefined>): string[] {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

export async function resolveCanonicalSeriesMeta(input: {
  imdbId?: string | null;
  tvdbId?: number | null;
  traktId?: number | string | null;
  tmdbId?: number | null;
  title?: string | null;
  year?: number | null;
}): Promise<SeriesCanonicalMeta | null> {
  const numericTraktId =
    typeof input.traktId === "number"
      ? input.traktId
      : typeof input.traktId === "string" && /^\d+$/.test(input.traktId)
        ? Number(input.traktId)
        : undefined;

  const show = await traktAdapter.getShow({
    imdbId: input.imdbId ?? undefined,
    traktId: numericTraktId,
    traktSlug: typeof input.traktId === "string" && !/^\d+$/.test(input.traktId) ? input.traktId : undefined,
  }).catch(() => null);

  if (!show) return null;

  const ids: SeriesCanonicalIds = {
    imdb: show.ids.imdbId ?? input.imdbId ?? undefined,
    tvdb: show.ids.tvdbId ?? input.tvdbId ?? undefined,
    trakt: show.ids.traktId ?? input.traktId ?? undefined,
    tmdb: show.ids.tmdbId ?? input.tmdbId ?? undefined,
    slug: show.ids.traktSlug ?? show.ids.slug,
  };

  const source: SeriesSourceEntry = {
    source: "trakt",
    sourceId: ids.imdb ?? ids.trakt ?? ids.slug ?? show.title,
    confidence: 0.92,
    ids,
    title: show.title,
    year: show.year,
    hasEpisodes: Boolean(show.numberOfEpisodes || show.airedEpisodes),
    hasImages: Boolean(show.posterPath || show.backdropPath || show.logoUrl),
    hasTrailer: Boolean(show.trailerUrl),
    hasMetadata: true,
  };

  return {
    title: show.title,
    originalTitle: show.originalTitle,
    year: show.year,
    overview: show.overview,
    status: show.status,
    language: show.language,
    ids,
    poster: show.posterPath,
    backdrop: show.backdropPath,
    logo: show.logoUrl ?? undefined,
    imagePool: imagePool(show.posterPath, show.backdropPath, show.logoUrl),
    trailerUrl: show.trailerUrl ?? undefined,
    homepage: show.homepage ?? undefined,
    tagline: show.tagline,
    runtime: show.runtime,
    rating: show.rating,
    votes: show.votes,
    network: show.network ?? undefined,
    networks: show.network ? [show.network] : [],
    genres: show.genres ?? [],
    companies: (show.productionCompanies ?? []).map((company) => company.name),
    availableTranslations: show.availableTranslations ?? [],
    airedEpisodes: show.airedEpisodes ?? undefined,
    numberOfEpisodes: show.numberOfEpisodes ?? undefined,
    numberOfSeasons: show.numberOfSeasons ?? undefined,
    sources: [source],
    sourceCount: 1,
    mergeConfidence: 0.92,
    debug: { fieldSources: { all: "trakt" } },
  };
}
