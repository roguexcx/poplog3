import type { TMDBItem, TMDBDetails } from "@/types/tmdb";
import { catalogGetMovie, catalogGetShow } from "@/server/source-engine/engine";
import { filterOutLibraryItems } from "@/lib/discovery/library-filter";
import { db } from "@/server/db/client";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";
import {
  getTrendingFeed,
  type EnrichedTrendingTitle,
} from "@/features/home/trending-feed";

export type { TMDBDetails };

async function localPopularQuery(mediaType: "movie" | "tv", limit: number): Promise<TMDBItem[]> {
  const rows = await db.poplog3Title.findMany({
    where: { mediaType, posterPath: { not: null } },
    orderBy: { popularity: "desc" },
    take: limit,
    select: {
      id: true,
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      overview: true,
      posterPath: true,
      backdropPath: true,
      releaseDate: true,
      firstAirDate: true,
      lastAirDate: true,
      year: true,
      voteAverage: true,
      popularity: true,
      imdbId: true,
    },
  });

  return rows
    .filter((row) => row.title ?? row.originalTitle)
    .map((row): TMDBItem => {
      const imdbId = row.imdbId ?? undefined;
      return {
        id: row.tmdbId,
        media_type: row.mediaType as "movie" | "tv",
        title: row.title ?? row.originalTitle ?? "",
        original_title: row.originalTitle ?? undefined,
        overview: row.overview ?? undefined,
        poster_path: row.posterPath,
        backdrop_path: row.backdropPath ?? undefined,
        release_date: row.mediaType === "movie" ? (row.releaseDate?.toISOString().slice(0, 10) ?? undefined) : undefined,
        first_air_date: row.mediaType === "tv" ? (row.firstAirDate?.toISOString().slice(0, 10) ?? undefined) : undefined,
        last_air_date: row.mediaType === "tv" ? (row.lastAirDate?.toISOString().slice(0, 10) ?? undefined) : undefined,
        vote_average: row.voteAverage != null ? Number(row.voteAverage) : undefined,
        popularity: row.popularity != null ? Number(row.popularity) : undefined,
        poplogId: row.id,
        externalIds: { tmdbId: row.tmdbId, ...(imdbId ? { imdbId } : {}) },
        identityUsed: "poplog_id",
        linkIdUsed: row.id,
        hasPoplogId: true,
        normalizedFrom: "legacy",
        legacyCompatibilityUsed: false,
      };
    });
}

/**
 * Converte um item canônico de trending (já enriquecido) para o TMDBItem
 * consumido pelo Hero. Os gêneros numéricos vão para `genre_ids`; o Hero
 * resolve gêneros legíveis via `getFeaturedDetails`.
 */
function trendingTitleToTMDBItem(t: EnrichedTrendingTitle): TMDBItem {
  return {
    id: t.id ?? t.tmdb_id,
    poplogId: t.poplogId,
    externalIds: t.externalIds,
    identityUsed: t.identityUsed,
    linkIdUsed: t.linkIdUsed,
    hasPoplogId: t.hasPoplogId,
    normalizedFrom: t.normalizedFrom,
    legacyCompatibilityUsed: t.legacyCompatibilityUsed,
    media_type: t.media_type,
    title: t.title,
    original_title: t.original_title ?? undefined,
    overview: t.overview ?? undefined,
    poster_path: t.poster_path ?? null,
    backdrop_path: t.backdrop_path ?? undefined,
    release_date: t.release_date ?? undefined,
    first_air_date: t.first_air_date ?? undefined,
    last_air_date: t.last_air_date ?? undefined,
    vote_average: t.vote_average ?? undefined,
    popularity: t.popularity ?? undefined,
    genre_ids: Array.isArray(t.genres) ? (t.genres as number[]) : undefined,
  };
}

/**
 * Alimenta o Hero rotativo com a MESMA base do bloco "Em alta agora":
 * fonte, exclusões, região/disponibilidade, fallback e scoring de feedback
 * são compartilhados via `getTrendingFeed`. O Hero não mantém fonte paralela,
 * lista independente, deduplicação própria nem critérios de validade distintos.
 * As regras de exibição do Hero (rotação a cada F5) permanecem na Home.
 */
export async function getTrending(userId?: string | null): Promise<TMDBItem[]> {
  const feed = await getTrendingFeed();

  const feedbackMap = userId
    ? await getUserFeedbackMap(userId).catch(() => undefined)
    : undefined;

  const scored = applyUserFeedbackScoring(feed.items, {
    userId,
    feedbackMap,
    context: "trending",
  });

  return scored.map(trendingTitleToTMDBItem);
}

export async function getPopularMovies(userId?: string | null): Promise<TMDBItem[]> {
  try {
    const results = await localPopularQuery("movie", 20);
    return filterOutLibraryItems(userId, results);
  } catch {
    return [];
  }
}

export async function getPopularTV(userId?: string | null): Promise<TMDBItem[]> {
  try {
    const results = await localPopularQuery("tv", 20);
    return filterOutLibraryItems(userId, results);
  } catch {
    return [];
  }
}

export async function getFeaturedDetails(
  mediaType: "movie" | "tv",
  item: TMDBItem,
): Promise<TMDBDetails | null> {
  const imdbId = item.externalIds?.imdbId;
  const traktId = typeof item.externalIds?.traktId === "number" ? item.externalIds.traktId : undefined;
  const traktSlug = item.externalIds?.slug;
  if (!imdbId && !traktId && !traktSlug) return null;

  try {
    const data = mediaType === "tv"
      ? await catalogGetShow({ imdbId, traktId, traktSlug }).catch(() => null)
      : await catalogGetMovie({ imdbId, traktId, traktSlug }).catch(() => null);

    if (!data) return null;

    const genres = data.genres?.length
      ? data.genres.map((name, i): { id: number; name: string } => ({ id: -(i + 1), name }))
      : undefined;

    return {
      id: item.id,
      overview: data.overview ?? undefined,
      genres,
      number_of_seasons: data.numberOfSeasons ?? undefined,
      runtime: data.runtime ?? undefined,
      episode_run_time: data.runtime ? [data.runtime] : undefined,
      release_date: item.release_date,
      first_air_date: item.first_air_date,
    };
  } catch {
    return null;
  }
}
