/**
 * get-title-page-data.ts
 *
 * Lógica central para montar o TitlePageData de um título.
 * Usada tanto pela page.tsx (diretamente, sem fetch HTTP)
 * quanto pela route handler /api/poplog3/titles/[mediaType]/[id].
 */

import type { AvailabilityProvider } from "@/server/streaming/availability-service";
import {
  availabilityStateFromTitle,
  isValidSeason,
  type TitleAvailabilityState,
} from "@/lib/series";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getExternalIds } from "@/server/cache/external-ids-cache";
import { computeUserSeriesProgress } from "@/server/episodes/episode-progress-service";
import {
  getUserKnownTitleIds,
  readTitleState,
} from "@/server/state/user-title-state";
import { getUserTitleStatus } from "@/server/library/library-service";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";
import { getAvailabilityForDisplay } from "@/server/streaming/title-availability";
import { withOrigin } from "@/server/engine-logger";
import type { TmdbPayloadWithWatch } from "@/server/sync/sync-availability";
import { syncOmdbRatings } from "@/server/sync/sync-omdb-ratings";
import { findOfficialTrailerOnYouTube } from "@/server/trailers/youtube-trailer";
import { getSeriesEpisodeRuntimes } from "@/server/runtime/series-episode-runtimes";
import { rankRecommendationsByEditorialOrigin } from "@/server/recommendations/editorial-origin-ranker";
import { getGeneralIndex } from "@/lib/ratings/general-index";
import { getTitleFeedbackState, getUserFeedbackMap, type UserFeedbackMap } from "@/lib/personalization/feedback";
import type { PoplogTitleDetails } from "@/server/types/title-details";
import type { TitlePageData, TitleProvider, TitleSeasonInfo, TitleMetadataBlock } from "@/features/title/types";
import type { UserRatingData } from "@/types/user";
import { getUserRating } from "@/server/ratings/user-rating-service";
import { getPublicRating } from "@/server/ratings/rating-aggregate-service";
import { buildTmdbRawUrl } from "@/lib/images/url";
import {
  getPoplogTitleDetails,
  getPoplogTitleDetailsDebugSource,
  type PoplogTitleDetailsResult,
} from "@/server/titles/poplog-title-details";
import type { PoplogTitleSourceHint } from "@/server/titles/poplog-title-identity";
import { catalogGetRelated } from "@/server/source-engine/engine";
import type { TitleRecommendation } from "@/features/title/types";
import { db } from "@/server/db/client";
import { syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import { upsertCachedTitleRow } from "@/server/repositories";

type MediaType = "movie" | "tv";

function tmdbImage(path: string | null | undefined, size: string) {
  return buildTmdbRawUrl(size, path);
}

function hasDetailFields(
  title: PoplogTitleDetails | Record<string, unknown>,
): title is PoplogTitleDetails {
  return (
    typeof title === "object" &&
    title !== null &&
    ("cast" in title || "recommendations" in title || "runtime" in title)
  );
}

function uniqueNames(names: Array<string | null | undefined>, limit = 4) {
  return Array.from(
    new Set(
      names
        .map((name) => name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ).slice(0, limit);
}

function filterValidSeasons(
  seasons: PoplogTitleDetails["seasons"] | undefined,
) {
  if (!seasons || seasons.length === 0) return [];
  return seasons
    .filter(isValidSeason)
    .sort((a, b) => a.season_number - b.season_number);
}

async function getProvidersFromCache(
  mediaType: MediaType,
  tmdbId: number | undefined,
  imdbId: string | undefined,
  country: string,
): Promise<TitleProvider[]> {
  try {
    // Prefer tmdbId path (uses existing getAvailability with BigInt conversion)
    if (tmdbId) {
      const { getAvailability } = await import("@/server/cache/availability-cache");
      const rows = await getAvailability(mediaType, tmdbId, country);
      return rows.map((row) => ({
        name: row.provider_name,
        logoUrl: null,
        type: (row.availability_type === "streaming" ? "streaming" : row.availability_type) as TitleProvider["type"],
        source: row.source,
        country: row.country,
        deepLink: row.deep_link,
        quality: row.quality,
      }));
    }
    // Fallback: imdbId path via local service
    if (imdbId) {
      const local = await import("@/server/local-services/catalog-availability-local.service");
      const rows = await local.listAvailability({
        imdbId,
        mediaType: mediaType as "movie" | "tv",
        providerRegion: country,
      });
      return rows.map((row) => ({
        name: row.provider_name,
        logoUrl: row.provider_logo_url ?? null,
        type: (row.provider_type === "subscription" ? "streaming" : row.provider_type) as TitleProvider["type"],
        source: row.source,
        country: row.provider_region,
      }));
    }
    return [];
  } catch {
    return [];
  }
}

async function getSeasonSummariesFromDb(
  seriesTmdbId: number,
): Promise<TitleSeasonInfo[]> {
  try {
    const rows = await db.titleSeason.findMany({
      where: { seriesTmdbId, seasonNumber: { gt: 0 } },
      orderBy: { seasonNumber: "asc" },
      select: { seasonNumber: true, name: true, airDate: true, episodeCount: true, posterPath: true },
    });
    return rows.map((row) => ({
      seasonNumber: row.seasonNumber,
      name: row.name ?? null,
      airDate: row.airDate ? row.airDate.toISOString().slice(0, 10) : null,
      episodeCount: row.episodeCount ?? null,
      posterUrl: buildTmdbRawUrl("w185", row.posterPath),
    }));
  } catch {
    return [];
  }
}

type MetadataInput = {
  crew?: PoplogTitleDetailsResult["crew"];
  budget?: number | null;
  revenue?: number | null;
  domesticGross?: number | null;
  metacriticScore?: number | null;
  productionCompanies?: Array<{ name: string }>;
  productionCountries?: Array<{ code: string; name: string }>;
  spokenLanguages?: Array<{ code: string; name: string }>;
  inProduction?: boolean | null;
  seriesType?: string | null;
};

/**
 * Constrói um TitleMetadataBlock a partir do crew + dados estruturais do título.
 * Retorna null quando não há dados suficientes para exibir o bloco.
 */
function buildMetadataFromDetails(input: MetadataInput): TitleMetadataBlock | null {
  const crewList = input.crew ?? [];

  const directors = uniqueNames(
    crewList
      .filter((c) => c.job?.toLowerCase() === "director")
      .map((c) => c.name),
    3,
  );

  const writers = uniqueNames(
    crewList
      .filter((c) => {
        const j = c.job?.toLowerCase() ?? "";
        return (
          j === "writer" ||
          j === "screenplay" ||
          j === "screenwriter" ||
          j === "story" ||
          j === "story by" ||
          j === "written by"
        );
      })
      .map((c) => c.name),
    3,
  );

  const composers = uniqueNames(
    crewList
      .filter((c) => {
        const j = c.job?.toLowerCase() ?? "";
        return (
          j.includes("compos") ||
          j === "original music composer" ||
          j === "original score" ||
          j === "music"
        );
      })
      .map((c) => c.name),
    2,
  );

  const creators = uniqueNames(
    crewList
      .filter((c) => {
        const j = c.job?.toLowerCase() ?? "";
        return (
          j === "creator" ||
          j === "created by" ||
          j === "series creator" ||
          j === "co-creator" ||
          j === "show creator"
        );
      })
      .map((c) => c.name),
    3,
  );

  // Production companies: normaliza para TitleCompany[]
  const productionCompanies = (input.productionCompanies ?? [])
    .slice(0, 5)
    .map((c) => ({ id: 0 as number, name: c.name }));

  // Countries & languages
  const productionCountries = (input.productionCountries ?? [])
    .slice(0, 4)
    .map((c) => ({ code: c.code, name: c.name }));

  const spokenLanguages = (input.spokenLanguages ?? [])
    .slice(0, 4)
    .map((l) => ({ code: l.code, name: l.name }));

  const hasBudget = typeof input.budget === "number" && input.budget > 0;
  const hasRevenue = typeof input.revenue === "number" && input.revenue > 0;
  const hasCreativeData =
    directors.length > 0 ||
    writers.length > 0 ||
    composers.length > 0 ||
    creators.length > 0;
  const hasStructuralData =
    productionCompanies.length > 0 ||
    productionCountries.length > 0 ||
    spokenLanguages.length > 0;

  if (!hasCreativeData && !hasBudget && !hasRevenue && !hasStructuralData) return null;

  return {
    ...(directors.length > 0 && { directors }),
    ...(writers.length > 0 && { writers }),
    ...(composers.length > 0 && { composers }),
    ...(creators.length > 0 && { creators }),
    ...(hasBudget && { budget: input.budget! }),
    ...(hasRevenue && { revenue: input.revenue! }),
    ...(productionCompanies.length > 0 && { productionCompanies }),
    ...(productionCountries.length > 0 && { productionCountries }),
    ...(spokenLanguages.length > 0 && { spokenLanguages }),
    ...(input.seriesType != null && { seriesType: input.seriesType }),
    ...(input.inProduction != null && { inProduction: input.inProduction }),
  };
}

function buildSeasonStubs(numberOfSeasons: number): TitleSeasonInfo[] {
  return Array.from({ length: numberOfSeasons }, (_, i) => ({
    seasonNumber: i + 1,
    name: null,
    airDate: null,
    episodeCount: null,
  }));
}

export type GetTitlePageDataOptions = {
  mediaType: MediaType;
  id: number | string;
  sourceHint?: PoplogTitleSourceHint;
  force?: boolean;
  country?: string;
  debugSource?: boolean;
};

function toEmbedUrl(url: string): string {
  if (!url) return url;
  // youtube.com/watch?v=ID → youtube.com/embed/ID
  const watchMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (watchMatch) return `https://www.youtube.com/embed/${watchMatch[1]}`;
  return url;
}

function poplogDetailsToTitlePageData(
  details: PoplogTitleDetailsResult,
  country: string,
): TitlePageData {
  const trailerVideo = details.videos?.find((video) => video.type === "trailer") ?? details.videos?.[0];
  const legacyCompatibleId =
    details.externalIds.tmdbId ??
    (details.externalIds.imdbId ? syntheticTmdbFromImdbId(details.externalIds.imdbId) : null) ??
    details.poplogId ??
    details.externalIds.imdbId ??
    details.externalIds.balloonerismmId ??
    details.title;
  const linkIdUsed =
    details.poplogId ??
    details.externalIds.imdbId ??
    details.externalIds.balloonerismmId ??
    details.externalIds.slug ??
    details.externalIds.tmdbId ??
    legacyCompatibleId;

  return {
    id: legacyCompatibleId,
    poplogId: details.poplogId ?? null,
    externalIds: details.externalIds,
    identityUsed: details.poplogId
      ? "poplog_id"
      : details.externalIds.imdbId
        ? "imdb_id"
        : details.externalIds.tmdbId
          ? "tmdb_id_alias"
          : "temporary_catalog_candidate",
    linkIdUsed,
    legacyCompatibilityUsed: Boolean(details.externalIds.tmdbId && linkIdUsed !== details.externalIds.tmdbId),
    mediaType: details.mediaType,
    title: details.title,
    originalTitle: details.originalTitle ?? null,
    tagline: null,
    year: details.year ?? null,
    releaseDate: details.mediaType === "movie" ? details.releaseDate ?? null : null,
    firstAirDate: details.mediaType === "tv" ? details.releaseDate ?? null : null,
    lastAirDate: details.lastAirDate ?? null,
    numberOfSeasons: details.numberOfSeasons ?? null,
    numberOfEpisodes: details.numberOfEpisodes ?? null,
    overview: details.overview ?? null,
    posterUrl: details.posterUrl ?? null,
    backdropUrl: details.backdropUrl ?? null,
    runtime: details.mediaType === "movie" ? details.runtime ?? null : null,
    episodeRunTimeMinutes: details.mediaType === "tv" ? details.runtime ?? null : null,
    runtimeEstimated: false,
    totalRuntimeMinutes: null,
    totalRuntimeEstimated: false,
    voteAverage: details.voteAverage ?? null,
    genres: details.genres ?? [],
    status: details.status ?? null,
    availabilityState: "unknown",
    certification: null,
    trailer: trailerVideo
      ? {
          key: String(trailerVideo.id),
          name: trailerVideo.title,
          url: trailerVideo.url,
          embedUrl: toEmbedUrl(trailerVideo.url),
          thumbnailUrl: trailerVideo.thumbnailUrl ?? null,
        }
      : null,
    nextEpisode: null,
    seasons: [],
    ratings: details.voteAverage
      ? {
          imdbRating: details.voteAverage,
          imdbVotes: details.voteCount ?? null,
          rottenTomatoesScore: null,
          metacriticScore: details.metacriticScore ?? null,
          tmdbRating: null,
          poplogScore: null,
        }
      : null,
    generalIndex: details.voteAverage ?? null,
    userState: { isAuthenticated: false },
    communityRating: null,
    userSeriesProgress: null,
    providers: [],
    country,
    cast: details.cast ?? [],
    crew: details.crew ?? [],
    recommendations: [],
    metadata: buildMetadataFromDetails({
      crew: details.crew,
      budget: details.budget,
      revenue: details.revenue,
      domesticGross: details.domesticGross,
      metacriticScore: details.metacriticScore,
      productionCompanies: details.productionCompanies,
      productionCountries: details.productionCountries,
      spokenLanguages: details.spokenLanguages,
      inProduction: details.inProduction,
      seriesType: details.seriesType,
    }),
    lastSyncedAt: null,
    cacheInfo: {
      title: {
        source: details.sourceMeta.primarySource,
        status: details.sourceMeta.fallbackUsed ? "legacy_fallback_needed" : "fresh",
      },
      ratings: null,
      availability: null,
    },
  };
}

function buildTmdbFallbackBlockedPageData({
  details,
  country,
  debugSource,
  mediaType,
  requestedId,
}: {
  details: PoplogTitleDetailsResult | null;
  country: string;
  debugSource: boolean;
  mediaType: MediaType;
  requestedId: string;
}): TitlePageData | null {
  if (!details) return null;

  console.warn("[getTitlePageData] legacy TMDB fallback blocked", {
    mediaType,
    requestedId,
    tmdbId: details.externalIds.tmdbId,
    resolvedFrom: details.sourceMeta.resolvedFrom,
    fallbackReason: details.sourceMeta.fallbackReason ?? "legacy_tmdb_fallback",
  });

  const fallbackBlockedPayload = poplogDetailsToTitlePageData(details, country);

  return {
    ...fallbackBlockedPayload,
    cacheInfo: {
      ...fallbackBlockedPayload.cacheInfo,
      title: {
        source: details.sourceMeta.primarySource,
        status: "tmdb_fallback_blocked",
      },
    },
    ...(debugSource
      ? {
          debugSource: getPoplogTitleDetailsDebugSource(details, {
            usedLegacy: false,
            usedTmdbApi: false,
            fallbackReason: "tmdb_fallback_blocked",
          }),
        }
      : {}),
  } as TitlePageData;
}

/**
 * Monta o TitlePageData completo para um título.
 * Retorna null se o id/mediaType for inválido ou o sync falhar.
 */
export async function getTitlePageData(
  options: GetTitlePageDataOptions,
): Promise<TitlePageData | null> {
  const { mediaType, id, sourceHint = "auto", force = false, country = "BR", debugSource = false } = options;

  if (mediaType !== "movie" && mediaType !== "tv") return null;
  const requestedId = String(id).trim();
  if (!requestedId) return null;

  return withOrigin("title", async () => {
    try {
      const poplogDetails = await getPoplogTitleDetails({
        mediaType,
        id: requestedId,
        sourceHint,
      });

      const legacyTmdbId = poplogDetails?.externalIds.tmdbId;

      if (poplogDetails && poplogDetails.sourceMeta.primarySource !== "legacy") {
        const base = poplogDetailsToTitlePageData(poplogDetails, country);

        const tmdbId = poplogDetails.externalIds.tmdbId;
        const imdbId = poplogDetails.externalIds.imdbId;
        const catalogMediaType = mediaType === "tv" ? "show" : "movie";

        const [currentUser, providers, relatedRaw] = await Promise.all([
          getCurrentUser().catch(() => null),
          getProvidersFromCache(mediaType, tmdbId, imdbId, country),
          imdbId
            ? catalogGetRelated({ mediaType: catalogMediaType, imdbId }).catch(() => [])
            : Promise.resolve([]),
        ]);

        const isAuthenticated = Boolean(currentUser?.id);

        // Seasons: DB stubs (tmdbId) → count stubs (numberOfSeasons) → empty
        let seasons: TitleSeasonInfo[] = [];
        if (mediaType === "tv") {
          if (tmdbId) {
            seasons = await getSeasonSummariesFromDb(tmdbId);
          }
          if (seasons.length === 0 && (base.numberOfSeasons ?? 0) > 0) {
            seasons = buildSeasonStubs(base.numberOfSeasons!);
          }
        }

        // User state: usar tmdbId real ou sintético (imdbId-based) para lookup.
        // Títulos IMDb-first sem mapeamento TMDB usam o ID sintético negativo.
        const ratingKeyId =
          tmdbId ?? (imdbId ? syntheticTmdbFromImdbId(imdbId) : null);

        let userState = { ...base.userState, isAuthenticated };
        let userSeriesProgress = base.userSeriesProgress ?? null;
        if (isAuthenticated && currentUser && ratingKeyId) {
          const [titleState, userRating] = await Promise.all([
            readTitleState(currentUser.id, ratingKeyId, mediaType).catch(() => null),
            getUserRating(currentUser.id, mediaType as "movie" | "tv", ratingKeyId).catch(() => null),
          ]);
          if (titleState) {
            userState = {
              isAuthenticated: true,
              status: titleState.status ?? null,
              watched: Boolean(titleState.status === "watched"),
              watching: Boolean(titleState.status === "watching" || titleState.status === "in_progress"),
              inWatchlist: titleState.status === "watchlist",
              favorite: Boolean(titleState.favorite),
              liked: Boolean(titleState.liked),
              computedState: titleState.computed_state ?? null,
              userRating: userRating ?? null,
            };
            if (mediaType === "tv" && titleState.watched_episodes != null) {
              userSeriesProgress = {
                watchedCount: titleState.watched_episodes,
                totalEpisodes: titleState.total_episodes ?? null,
                airedEpisodes: titleState.aired_episodes ?? undefined,
                lastWatchedAt: titleState.last_watched_at
                  ? new Date(titleState.last_watched_at).toISOString()
                  : null,
                watchedKeys: titleState.watched_keys ?? [],
                nextEpisode:
                  titleState.next_season != null && titleState.next_episode != null
                    ? { seasonNumber: titleState.next_season, episodeNumber: titleState.next_episode }
                    : null,
              };
            }
          }
        }

        // Community rating + OMDb ratings (cache-first; external refresh quando OMDB_API_KEY disponível)
        // ratingKeyId já declarado acima (tmdbId real ou sintético negativo).
        const [communityRating, cachedExternalRatings] = await Promise.all([
          ratingKeyId
            ? getPublicRating(mediaType as "movie" | "tv", ratingKeyId).catch(() => null)
            : Promise.resolve(null),
          ratingKeyId && imdbId
            ? syncOmdbRatings({
                tmdbId: ratingKeyId,
                mediaType: mediaType as "movie" | "tv",
                imdbId,
                tmdbRating: base.voteAverage ?? null,
                allowExternalRefresh: Boolean(process.env.OMDB_API_KEY),
                origin: { endpoint: requestedId, action: "title_page_data" },
              }).then((r) => r.ratings).catch(() => null)
            : Promise.resolve(null),
        ]);

        // Enrich ratings block with cached RT/Metacritic/poplog scores when available
        const enrichedRatings = cachedExternalRatings
          ? {
              ...(base.ratings ?? {}),
              imdbRating: cachedExternalRatings.imdb_rating ?? base.ratings?.imdbRating ?? null,
              imdbVotes: cachedExternalRatings.imdb_votes ?? base.ratings?.imdbVotes ?? null,
              rottenTomatoesScore: cachedExternalRatings.rotten_tomatoes_score ?? base.ratings?.rottenTomatoesScore ?? null,
              metacriticScore: cachedExternalRatings.metacritic_score ?? base.ratings?.metacriticScore ?? null,
              tmdbRating: cachedExternalRatings.tmdb_rating ?? base.ratings?.tmdbRating ?? null,
              poplogScore: cachedExternalRatings.poplog_score ?? base.ratings?.poplogScore ?? null,
            }
          : base.ratings;

        const recommendations: TitleRecommendation[] = relatedRaw.slice(0, 12).map((r) => ({
          id: r.ids.imdbId ?? r.ids.tmdbId ?? r.title,
          mediaType: r.mediaType === "show" ? "tv" : "movie",
          title: r.title,
          originalTitle: r.originalTitle ?? null,
          year: r.year ?? null,
          posterPath: r.posterPath ?? null,
        }));

        // Write-through cache para IDs sintéticos (IMDb-first sem TMDB real).
        // Primeira visita à página já popula poplog3Title, então biblioteca/acompanhando
        // encontram os dados localmente sem nova chamada Balloonerismm.
        if (!tmdbId && ratingKeyId) {
          void upsertCachedTitleRow({
            tmdbId: ratingKeyId,
            mediaType,
            title: base.title ?? null,
            originalTitle: base.originalTitle ?? null,
            overview: base.overview ?? null,
            posterPath: base.posterUrl ?? null,
            backdropPath: base.backdropUrl ?? null,
            year: typeof base.year === "number" ? base.year : null,
            runtime: base.runtime ?? base.episodeRunTimeMinutes ?? null,
            voteAverage: base.voteAverage ?? null,
            voteCount: null,
            numberOfSeasons: base.numberOfSeasons ?? null,
            numberOfEpisodes: base.numberOfEpisodes ?? null,
            releaseDate: base.releaseDate ?? null,
            firstAirDate: base.firstAirDate ?? null,
            lastAirDate: base.lastAirDate ?? null,
          }).catch(() => {});
        }

        return {
          ...base,
          providers,
          seasons,
          userState,
          userSeriesProgress,
          communityRating,
          ratings: enrichedRatings,
          generalIndex: enrichedRatings ? base.generalIndex : null,
          recommendations,
          ...(debugSource
            ? { debugSource: getPoplogTitleDetailsDebugSource(poplogDetails) }
            : {}),
        } as TitlePageData;
      }

      const fallbackBlockedPageData = buildTmdbFallbackBlockedPageData({
        details: poplogDetails,
        country,
        debugSource,
        mediaType,
        requestedId,
      });
      if (fallbackBlockedPageData) {
        return fallbackBlockedPageData;
      }
      if (!legacyTmdbId) {
        return null;
      }

      const id = legacyTmdbId;
      return null; // TMDB legacy fallback removed
    } catch (error) {
      console.error("[getTitlePageData] erro:", error);
      return null;
    }
  });
}
