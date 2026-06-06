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
import { getUserLibrary } from "@/server/library/library-service";
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
import { traktAdapter, getTraktShowEnrichment, getTraktMovieEnrichment } from "@/server/source-engine/adapters/trakt-adapter";
import { traktGet } from "@/server/api-clients/trakt/client";
import type { TraktTranslation } from "@/server/api-clients/trakt/types";
import type { CatalogSearchResult } from "@/server/source-engine/types/catalog.types";
import type { TitleRecommendation } from "@/features/title/types";
import { db } from "@/server/db/client";
import { syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import { upsertCachedTitleRow } from "@/server/repositories";
import {
  resolveCanonicalSeriesMeta,
  type SeriesCanonicalMeta,
} from "@/server/source-engine/series-canonical-engine";
import {
  resolveSeriesSeasonList,
  buildSeasonStubsFromCount,
} from "@/server/source-engine/series-season-list-resolver";
import { persistSeriesCanonicalMeta } from "@/server/source-engine/persist-series-canonical";
import { hydrateSeriesEpisodesFromSources } from "@/server/source-engine/series-episode-hydrator";

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

function mergeSeasonSummariesWithCount(
  seasons: TitleSeasonInfo[],
  numberOfSeasons: number | null | undefined,
): TitleSeasonInfo[] {
  const byNumber = new Map<number, TitleSeasonInfo>();

  for (const season of seasons) {
    if (season.seasonNumber <= 0) continue;
    byNumber.set(season.seasonNumber, season);
  }

  const total = Number.isFinite(numberOfSeasons)
    ? Math.max(0, Math.floor(numberOfSeasons ?? 0))
    : 0;

  for (let seasonNumber = 1; seasonNumber <= total; seasonNumber += 1) {
    if (!byNumber.has(seasonNumber)) {
      byNumber.set(seasonNumber, {
        seasonNumber,
        name: null,
        airDate: null,
        episodeCount: null,
      });
    }
  }

  return Array.from(byNumber.values()).sort((a, b) => a.seasonNumber - b.seasonNumber);
}

export type GetTitlePageDataOptions = {
  mediaType: MediaType;
  id: number | string;
  sourceHint?: PoplogTitleSourceHint;
  force?: boolean;
  country?: string;
  debugSource?: boolean;
};

/**
 * Mescla metadados ricos da SeriesCanonicalMeta no TitlePageData base.
 *
 * Regras:
 *   - Campos do base têm precedência quando não-nulos (evita regressões)
 *   - Campos novos (tagline, trailer, homepage, logo, networks, etc.)
 *     são preenchidos pela engine canônica quando o base está vazio
 *   - Metadados operacionais (companies, availableTranslations, airedEpisodes)
 *     são sempre incluídos via metadata block
 */
function buildSeriesEnrichment(
  base: TitlePageData,
  canonical: SeriesCanonicalMeta,
): Partial<TitlePageData> {
  const enrichment: Partial<TitlePageData> = {};

  // Campos textuais — canonical preenche quando base está vazio
  if (!base.tagline && canonical.tagline) enrichment.tagline = canonical.tagline;
  if (!base.overview && canonical.overview) enrichment.overview = canonical.overview;
  if (!base.status && canonical.status) enrichment.status = canonical.status;
  if (!base.posterUrl && canonical.poster) enrichment.posterUrl = canonical.poster;
  if (!base.backdropUrl && canonical.backdrop) enrichment.backdropUrl = canonical.backdrop;
  if (!base.lastAirDate && canonical.lastAirDate) enrichment.lastAirDate = canonical.lastAirDate;
  if (!base.numberOfSeasons && canonical.numberOfSeasons) enrichment.numberOfSeasons = canonical.numberOfSeasons;
  if (!base.numberOfEpisodes && canonical.numberOfEpisodes) enrichment.numberOfEpisodes = canonical.numberOfEpisodes;
  if (!base.genres?.length && canonical.genres.length > 0) enrichment.genres = canonical.genres;

  // Trailer: enriquecer se o base não tem trailer
  if (!base.trailer && canonical.trailerUrl) {
    enrichment.trailer = {
      key: canonical.trailerUrl,
      name: "Trailer",
      url: canonical.trailerUrl,
      embedUrl: canonical.trailerUrl.includes("youtube") ? toEmbedUrl(canonical.trailerUrl) : canonical.trailerUrl,
      thumbnailUrl: null,
    };
  }

  // Metadados complementares (metadata block)
  const existingMeta = base.metadata ?? {};
  const canonicalNetworks = canonical.networks.length > 0
    ? canonical.networks.map((n) => ({ id: 0 as number, name: n }))
    : (canonical.network ? [{ id: 0 as number, name: canonical.network }] : undefined);

  const canonicalCompanies = canonical.companies.length > 0
    ? canonical.companies.map((c) => ({ id: 0 as number, name: c }))
    : undefined;

  const enrichedMeta: TitleMetadataBlock = {
    ...existingMeta,
    homepage: existingMeta.homepage ?? canonical.homepage ?? null,
    ...(canonicalNetworks?.length && !existingMeta.networks?.length
      ? { networks: canonicalNetworks }
      : {}),
    ...(canonicalCompanies?.length && !existingMeta.productionCompanies?.length
      ? { productionCompanies: canonicalCompanies }
      : {}),
  };

  // Só substituir metadata se tivermos algo novo para adicionar
  const hasNewMeta =
    Boolean(enrichedMeta.homepage && !existingMeta.homepage) ||
    Boolean(enrichedMeta.networks?.length && !existingMeta.networks?.length) ||
    Boolean(enrichedMeta.productionCompanies?.length && !existingMeta.productionCompanies?.length);

  if (hasNewMeta || Object.keys(existingMeta).length > 0) {
    enrichment.metadata = enrichedMeta;
  }

  // airedEpisodes para cálculo correto de progresso
  if (canonical.airedEpisodes != null) {
    // Injetado via userSeriesProgress se existir, mas também via base para
    // que o componente de progresso tenha o denominador correto
    enrichment.numberOfEpisodes = enrichment.numberOfEpisodes ?? canonical.numberOfEpisodes ?? base.numberOfEpisodes;
  }

  return enrichment;
}

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
    tagline: details.tagline ?? null,
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

async function getTraktRelatedWithFallback({
  mediaType,
  imdbId,
  traktId,
  traktSlug,
}: {
  mediaType: "movie" | "show";
  imdbId?: string | null;
  traktId?: number | string | null;
  traktSlug?: string | null;
}): Promise<CatalogSearchResult[]> {
  const numericTraktId =
    typeof traktId === "number"
      ? traktId
      : typeof traktId === "string" && /^\d+$/.test(traktId)
        ? Number(traktId)
        : undefined;

  if (imdbId || numericTraktId || traktSlug) {
    const traktRelated = await traktAdapter.getRelated({
      mediaType,
      imdbId: imdbId ?? undefined,
      traktId: numericTraktId,
      traktSlug: traktSlug ?? undefined,
    }).catch((err) => {
      console.warn("[getTitlePageData] Trakt related erro:", (err as Error)?.message);
      return [] as CatalogSearchResult[];
    });
    if (traktRelated.length > 0) return traktRelated;
  }

  return imdbId
    ? catalogGetRelated({ mediaType, imdbId }).catch(() => [])
    : [];
}

function recommendationFromCatalogResult(result: CatalogSearchResult): TitleRecommendation {
  const imdbId = result.ids.imdbId ?? null;
  const tmdbId = result.ids.tmdbId ?? (imdbId ? syntheticTmdbFromImdbId(imdbId) : null);
  const linkId =
    imdbId ??
    result.ids.traktSlug ??
    result.ids.slug ??
    result.ids.traktId ??
    result.ids.tmdbId ??
    result.title;

  return {
    id: linkId,
    tmdbId,
    poplogId: result.ids.balloonerismmId ?? null,
    imdbId,
    slug: result.ids.traktSlug ?? result.ids.slug ?? null,
    traktId: result.ids.traktId ?? null,
    mediaType: result.mediaType === "show" ? "tv" : "movie",
    title: result.title,
    originalTitle: result.originalTitle ?? null,
    year: result.year ?? null,
    posterPath: result.posterPath ?? null,
  };
}

function bestPtBrTitle(translations: TraktTranslation[] | null | undefined): string | null {
  if (!Array.isArray(translations)) return null;
  return (
    translations.find((t) => t.language === "pt" && t.country === "br" && t.title)?.title ??
    translations.find((t) => t.language === "pt" && t.title)?.title ??
    null
  );
}

async function enrichRelatedWithPtBrTitles(
  related: CatalogSearchResult[],
): Promise<CatalogSearchResult[]> {
  if (related.length === 0) return related;

  const translated = await Promise.all(
    related.map(async (item) => {
      const id =
        item.ids.imdbId ??
        item.ids.traktSlug ??
        (item.ids.traktId ? String(item.ids.traktId) : null);
      if (!id) return item;

      const type = item.mediaType === "movie" ? "movies" : "shows";
      const translations = await traktGet<TraktTranslation[]>(
        `/${type}/${encodeURIComponent(id)}/translations/pt`,
        { ttlSeconds: 86400 },
      ).catch(() => null);
      const ptBrTitle = bestPtBrTitle(translations);
      if (!ptBrTitle || ptBrTitle === item.title) return item;

      return {
        ...item,
        title: ptBrTitle,
        originalTitle: item.originalTitle ?? item.title,
      };
    }),
  );

  return translated;
}

async function enrichRelatedWithLocalImages(
  related: CatalogSearchResult[],
): Promise<CatalogSearchResult[]> {
  const lookups = related
    .map((item) => ({
      tmdbId: item.ids.tmdbId,
      mediaType: item.mediaType === "show" ? "tv" as const : "movie" as const,
    }))
    .filter((item): item is { tmdbId: number; mediaType: "movie" | "tv" } =>
      typeof item.tmdbId === "number" && Number.isInteger(item.tmdbId) && item.tmdbId > 0,
    );

  if (lookups.length === 0) return related;

  const rows = await db.poplog3Title.findMany({
    where: { OR: lookups },
    select: {
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      posterPath: true,
      backdropPath: true,
    },
  }).catch((err) => {
    console.warn("[getTitlePageData] local related image enrichment erro:", (err as Error)?.message);
    return [];
  });

  const imageByKey = new Map(
    rows.map((row) => [
      `${row.mediaType}:${row.tmdbId}`,
      {
        title: row.title,
        originalTitle: row.originalTitle,
        posterPath: row.posterPath,
        backdropPath: row.backdropPath,
      },
    ]),
  );

  return related.map((item) => {
    const tmdbId = item.ids.tmdbId;
    if (!tmdbId) return item;
    const mediaType = item.mediaType === "show" ? "tv" : "movie";
    const local = imageByKey.get(`${mediaType}:${tmdbId}`);
    if (!local) return item;
    const title = item.originalTitle ? item.title : local.title ?? item.title;

    return {
      ...item,
      title,
      originalTitle: item.originalTitle ?? local.originalTitle ?? undefined,
      posterPath: item.posterPath ?? local.posterPath ?? undefined,
      backdropPath: item.backdropPath ?? local.backdropPath ?? null,
    };
  });
}

async function filterRelatedOutsideUserLibrary(
  related: CatalogSearchResult[],
  userId: string | null | undefined,
): Promise<CatalogSearchResult[]> {
  if (!userId || related.length === 0) return related;

  const library = await getUserLibrary(userId).catch((err) => {
    console.warn("[getTitlePageData] user library recommendation filter erro:", (err as Error)?.message);
    return [];
  });
  if (library.length === 0) return related;

  const known = new Set(
    library.map((item) => `${item.media_type}:${item.tmdb_id}`),
  );

  return related.filter((item) => {
    const mediaType = item.mediaType === "show" ? "tv" : "movie";
    const tmdbId = item.ids.tmdbId ?? null;
    const syntheticId = item.ids.imdbId ? syntheticTmdbFromImdbId(item.ids.imdbId) : null;

    return !(
      (tmdbId && known.has(`${mediaType}:${tmdbId}`)) ||
      (syntheticId && known.has(`${mediaType}:${syntheticId}`))
    );
  });
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
        const resolvedMediaType = base.mediaType;
        if (resolvedMediaType !== mediaType) {
          console.log(
            `[SERIES-DIAG] title page media resolved | requested=${mediaType} resolved=${resolvedMediaType} id=${requestedId} imdb=${base.externalIds?.imdbId ?? "-"} poplog=${base.poplogId ?? "-"}`,
          );
        }

        const tmdbId = poplogDetails.externalIds.tmdbId;
        const imdbId = poplogDetails.externalIds.imdbId;
        const catalogMediaType = resolvedMediaType === "tv" ? "show" : "movie";

        const tvdbId = poplogDetails.externalIds.tvdbId;
        const traktId = poplogDetails.externalIds.traktId;

        const [currentUser, providers, relatedRaw, seriesCanonical, traktEnrichment] = await Promise.all([
          getCurrentUser().catch(() => null),
          getProvidersFromCache(resolvedMediaType, tmdbId, imdbId, country),
          getTraktRelatedWithFallback({
            mediaType: catalogMediaType,
            imdbId,
            traktId,
            traktSlug: poplogDetails.externalIds.slug ?? null,
          }),
          // Para séries TV: buscar metadados canônicos de todas as fontes em paralelo
          resolvedMediaType === "tv" && (imdbId || tvdbId || traktId)
            ? resolveCanonicalSeriesMeta({
                imdbId: imdbId ?? null,
                tvdbId: tvdbId ?? null,
                traktId: traktId ?? null,
                tmdbId: tmdbId ?? null,
              }).catch((err) => {
                console.warn("[getTitlePageData] resolveCanonicalSeriesMeta erro:", (err as Error)?.message);
                return null as SeriesCanonicalMeta | null;
              })
            : Promise.resolve(null as SeriesCanonicalMeta | null),
          // Enriquecimento Trakt: studios, certifications, next/last episode
          imdbId
            ? (resolvedMediaType === "tv"
                ? getTraktShowEnrichment(imdbId).catch(() => null)
                : getTraktMovieEnrichment(imdbId).catch(() => null))
            : Promise.resolve(null),
        ]);

        const isAuthenticated = Boolean(currentUser?.id);

        // Computed once — used for user state, community ratings, AND season DB lookup.
        // Includes synthetic negative ID for IMDb-only shows without a real TMDB mapping.
        const ratingKeyId =
          tmdbId ?? (imdbId ? syntheticTmdbFromImdbId(imdbId) : null);

        // Seasons: DB summaries + count stubs. A partial season cache (only T01,
        // for example) must not hide known later seasons from the UI.
        // Use ratingKeyId so that seasons cached under the synthetic key are found.
        let seasons: TitleSeasonInfo[] = [];
        if (resolvedMediaType === "tv") {
          let hadSeasonCache = false;
          if (ratingKeyId) {
            seasons = await getSeasonSummariesFromDb(ratingKeyId);
            hadSeasonCache = seasons.length > 0;
          }

          // Número de temporadas: priorizar resultado canônico (TVDB > Trakt > Balloonerismm)
          const canonicalSeasonCount = seriesCanonical?.numberOfSeasons ?? null;
          const effectiveSeasonCount = canonicalSeasonCount ?? base.numberOfSeasons;

          seasons = mergeSeasonSummariesWithCount(seasons, effectiveSeasonCount);

          // Se o DB está vazio E não temos contagem, buscar lista live de TVDB/Trakt
          if (seasons.length === 0 && (tvdbId || imdbId)) {
            const liveSeasonsResult = await resolveSeriesSeasonList({
              tvdbId: tvdbId ?? null,
              imdbId: imdbId ?? null,
            }).catch(() => []);

            if (liveSeasonsResult.length > 0) {
              seasons = liveSeasonsResult.map((s) => ({
                seasonNumber: s.seasonNumber,
                name: s.name ?? null,
                airDate: s.airDate ?? null,
                episodeCount: s.episodeCount ?? null,
                posterUrl: s.posterUrl ?? null,
              }));
            } else if (effectiveSeasonCount && effectiveSeasonCount > 0) {
              // Fallback final: stubs a partir da contagem
              seasons = buildSeasonStubsFromCount(effectiveSeasonCount).map((s) => ({
                seasonNumber: s.seasonNumber,
                name: null,
                airDate: null,
                episodeCount: null,
                posterUrl: null,
              }));
            }
          }

          // Se a página conseguiu resolver IDs mas o cache local ainda está vazio,
          // hidrata e persiste temporadas/episódios agora. Assim progresso, agenda e
          // "próximo episódio" não dependem do usuário abrir uma temporada manualmente.
          if (!hadSeasonCache && ratingKeyId && (imdbId || tvdbId || base.title)) {
            const hydrated = await hydrateSeriesEpisodesFromSources({
              seriesTmdbId: ratingKeyId,
              imdbId: imdbId ?? null,
              tvdbId: tvdbId ?? null,
              traktId: traktId ?? null,
              title: base.title,
              year: typeof base.year === "number" ? base.year : null,
              numberOfSeasons: effectiveSeasonCount ?? null,
            }).catch((err) => {
              console.warn("[getTitlePageData] hydrateSeriesEpisodesFromSources erro:", (err as Error)?.message);
              return null;
            });

            if (hydrated?.seasonsSaved) {
              const persistedSeasons = await getSeasonSummariesFromDb(ratingKeyId);
              seasons = mergeSeasonSummariesWithCount(persistedSeasons, effectiveSeasonCount);
            }
          }
        }

        // Persistir metadados ricos da engine canônica — fire-and-forget
        if (resolvedMediaType === "tv" && seriesCanonical && ratingKeyId) {
          void persistSeriesCanonicalMeta(ratingKeyId, resolvedMediaType, seriesCanonical).catch(() => {});
        }

        let userState = { ...base.userState, isAuthenticated };
        let userSeriesProgress = base.userSeriesProgress ?? null;
        if (isAuthenticated && currentUser && ratingKeyId) {
          const [titleState, userRating] = await Promise.all([
            readTitleState(currentUser.id, ratingKeyId, resolvedMediaType).catch(() => null),
            getUserRating(currentUser.id, resolvedMediaType as "movie" | "tv", ratingKeyId).catch(() => null),
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
            if (resolvedMediaType === "tv" && titleState.watched_episodes != null) {
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

          if (resolvedMediaType === "tv" && !userSeriesProgress) {
            userSeriesProgress = await computeUserSeriesProgress(currentUser.id, ratingKeyId)
              .catch(() => null);
          }
        }

        // Community rating + OMDb ratings (cache-first; external refresh quando OMDB_API_KEY disponível)
        // ratingKeyId já declarado acima (tmdbId real ou sintético negativo).
        const [communityRating, cachedExternalRatings] = await Promise.all([
          ratingKeyId
            ? getPublicRating(resolvedMediaType as "movie" | "tv", ratingKeyId).catch(() => null)
            : Promise.resolve(null),
          ratingKeyId && imdbId
            ? syncOmdbRatings({
                tmdbId: ratingKeyId,
                mediaType: resolvedMediaType as "movie" | "tv",
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

        const relatedOutsideLibrary = await filterRelatedOutsideUserLibrary(
          relatedRaw,
          currentUser?.id,
        );
        const relatedWithPtBrTitles = await enrichRelatedWithPtBrTitles(relatedOutsideLibrary);
        const relatedWithImages = await enrichRelatedWithLocalImages(relatedWithPtBrTitles);

        const recommendations: TitleRecommendation[] = relatedWithImages
          .slice(0, 12)
          .map(recommendationFromCatalogResult);

        // Write-through cache para IDs sintéticos (IMDb-first sem TMDB real).
        // Primeira visita à página já popula poplog3Title, então biblioteca/acompanhando
        // encontram os dados localmente sem nova chamada Balloonerismm.
        if (!tmdbId && ratingKeyId) {
          void upsertCachedTitleRow({
            tmdbId: ratingKeyId,
            mediaType: resolvedMediaType,
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

        // Mesclar metadados ricos da engine canônica de séries no resultado final
        const seriesEnrichment = resolvedMediaType === "tv" && seriesCanonical
          ? buildSeriesEnrichment(base, seriesCanonical)
          : {};

        // Enriquecimento Trakt: studios, certifications, next/last episode
        const traktEnrichmentPatch: Partial<TitlePageData> = {};
        if (traktEnrichment) {
          // studios → productionCompanies se vazio
          const studios = traktEnrichment.studios;
          if (studios?.length) {
            const existingMeta = (seriesEnrichment.metadata ?? base.metadata) ?? {};
            if (!existingMeta.productionCompanies?.length) {
              traktEnrichmentPatch.metadata = {
                ...existingMeta,
                productionCompanies: studios.map((s) => ({ id: 0 as number, name: s.name })),
              };
            }
          }

          // certification: pick country-specific or fallback to US
          if ("certifications" in traktEnrichment && traktEnrichment.certifications && !base.certification) {
            const certs = traktEnrichment.certifications as Record<string, string>;
            const cert =
              certs[country.toLowerCase()] ??
              certs["us"] ??
              Object.values(certs)[0] ??
              null;
            if (cert) traktEnrichmentPatch.certification = cert;
          }

          // nextEpisode (TV only)
          if (resolvedMediaType === "tv" && "nextEpisode" in traktEnrichment && (traktEnrichment as { nextEpisode?: unknown }).nextEpisode && !base.nextEpisode) {
            const ne = (traktEnrichment as { nextEpisode: { season: number; number: number; title?: string | null; firstAired?: string | null; episodeType?: string | null } }).nextEpisode;
            traktEnrichmentPatch.nextEpisode = {
              season_number: ne.season,
              episode_number: ne.number,
              name: ne.title ?? null,
              air_date: ne.firstAired ? ne.firstAired.slice(0, 10) : null,
              episode_type: ne.episodeType ?? null,
            };
          }
        }

        return {
          ...base,
          ...seriesEnrichment,
          ...traktEnrichmentPatch,
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
