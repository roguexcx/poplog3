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
import type { TitlePageData } from "@/features/title/types";
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

export type GetTitlePageDataOptions = {
  mediaType: MediaType;
  id: number | string;
  sourceHint?: PoplogTitleSourceHint;
  force?: boolean;
  country?: string;
  debugSource?: boolean;
};

function poplogDetailsToTitlePageData(
  details: PoplogTitleDetailsResult,
  country: string,
): TitlePageData {
  const trailerVideo = details.videos?.find((video) => video.type === "trailer") ?? details.videos?.[0];
  const legacyCompatibleId =
    details.externalIds.tmdbId ??
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
    lastAirDate: null,
    numberOfSeasons: null,
    numberOfEpisodes: null,
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
    status: null,
    availabilityState: "unknown",
    certification: null,
    trailer: trailerVideo
      ? {
          key: String(trailerVideo.id),
          name: trailerVideo.title,
          url: trailerVideo.url,
          embedUrl: trailerVideo.url,
        }
      : null,
    nextEpisode: null,
    seasons: [],
    ratings: details.voteAverage
      ? {
          imdbRating: details.voteAverage,
          imdbVotes: details.voteCount ?? null,
          rottenTomatoesScore: null,
          metacriticScore: null,
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
    metadata: null,
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

        const currentUser = await getCurrentUser().catch(() => null);
        const isAuthenticated = Boolean(currentUser?.id);

        const imdbId = poplogDetails.externalIds.imdbId;
        const catalogMediaType = mediaType === "tv" ? "show" : "movie";
        const relatedRaw = imdbId
          ? await catalogGetRelated({ mediaType: catalogMediaType, imdbId }).catch(() => [])
          : [];
        const recommendations: TitleRecommendation[] = relatedRaw.slice(0, 12).map((r) => ({
          id: r.ids.imdbId ?? r.ids.tmdbId ?? r.title,
          mediaType: r.mediaType === "show" ? "tv" : "movie",
          title: r.title,
          originalTitle: r.originalTitle ?? null,
          year: r.year ?? null,
          posterPath: r.posterPath ?? null,
        }));

        return {
          ...base,
          userState: { ...base.userState, isAuthenticated },
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
