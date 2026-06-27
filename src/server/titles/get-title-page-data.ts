/**
 * get-title-page-data.ts
 *
 * Lógica central para montar o TitlePageData de um título.
 * Usada tanto pela page.tsx (diretamente, sem fetch HTTP)
 * quanto pela route handler /api/title/[mediaType]/[id] (poplog3/titles delega para ela).
 */

import { getCurrentUser } from "@/server/auth/get-current-user";
import { cache } from "react";
import { computeUserSeriesProgress } from "@/server/episodes/episode-progress-service";
import { readTitleState } from "@/server/state/user-title-state";
import {
  getUserLibraryIdentityIndex,
  hasTitleIdentity,
} from "@/server/library/library-identity-index";
import { withOrigin } from "@/server/engine-logger";
import type { TitlePageData, TitleProvider, TitleSeasonInfo, TitleMetadataBlock } from "@/features/title/types";
import { availabilityStateFromTitle, seriesStateFromTitle } from "@/lib/series";
import { attachBestProvider } from "@/server/availability/attach-best-provider";
import { getUserRating } from "@/server/ratings/user-rating-service";
import { getPublicRating } from "@/server/ratings/rating-aggregate-service";
import { buildTmdbRawUrl } from "@/lib/images/url";
import {
  getPoplogTitleDetails,
  getPoplogTitleDetailsDebugSource,
  type PoplogTitleDetailsResult,
} from "@/server/titles/poplog-title-details";
import type { PoplogTitleSourceHint } from "@/server/titles/poplog-title-identity";
import { getTraktShowEnrichment, getTraktMovieEnrichment } from "@/server/source-engine/adapters/trakt-adapter";
import {
  fetchBalloonerismForSeed,
  mergeBalloonCandidates,
} from "@/server/recommendations/balloon-engine";
import { traktGet } from "@/server/api-clients/trakt/client";
import type { TraktTranslation } from "@/server/api-clients/trakt/types";
import type { CatalogSearchResult } from "@/server/source-engine/types/catalog.types";
import type { TitleRecommendation } from "@/features/title/types";
import { db } from "@/server/db/client";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";
import { syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import { normalizeNetworkSlug } from "@/lib/networks/normalize";
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
import { enqueueSeriesEpisodeHydrationJob } from "@/server/workers/series-prehydration";
import { getMovieFinancials } from "@/server/titles/title-financials";
import { resolveDirectFranchiseForTitle } from "@/server/franchises/direct-franchise-service";
import { resolveTitleUniverseForTitle } from "@/server/franchises/title-universe-service";
import { normalizeCatalogLanguage } from "@/server/source-engine/locale";

type MediaType = "movie" | "tv";

const TITLE_RELATED_CACHE_TTL_MS = 6 * 60 * 60_000;
const TITLE_COLD_SEASON_LIST_SYNC = process.env.POPLOG_TITLE_COLD_SEASON_LIST_SYNC === "true";
const TITLE_COLD_SERIES_SYNC = process.env.POPLOG_TITLE_COLD_SERIES_SYNC === "true";

type RelatedMediaType = "movie" | "show";
type TitleRelatedCachePayload = {
  items: CatalogSearchResult[];
  generatedAt: string;
};

function uniqueNames(names: Array<string | null | undefined>, limit = 4) {
  return Array.from(
    new Set(
      names
        .map((name) => name?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ).slice(0, limit);
}

/**
 * Providers para a title page — delega à camada GLOBAL de disponibilidade.
 * Mantém UMA única fonte de verdade (Balloonerismm → cache persistente → local legado),
 * a mesma usada pela Biblioteca, Home, Busca e demais grids.
 */
async function getProvidersFromCache(
  mediaType: MediaType,
  tmdbId: number | undefined,
  imdbId: string | undefined,
  country: string,
  language: string,
  releaseDate?: string | null,
  firstAirDate?: string | null,
): Promise<TitleProvider[]> {
  const { resolveTitleProviders } = await import("@/server/availability");
  const { providers } = await resolveTitleProviders({
    mediaType: mediaType as "movie" | "tv",
    imdbId: imdbId ?? null,
    tmdbId: tmdbId ?? null,
    region: country.toUpperCase() || "BR",
    language,
    releaseDate: releaseDate ?? null,
    firstAirDate: firstAirDate ?? null,
  });
  return providers;
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
  language?: string | null;
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
    ? canonical.networks.map((n) => ({ id: 0 as number, name: n, slug: normalizeNetworkSlug(n) }))
    : (canonical.network
        ? [{ id: 0 as number, name: canonical.network, slug: normalizeNetworkSlug(canonical.network) }]
        : undefined);

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
    // P6: deriva o estado de lançamento REAL (filme: released/coming-soon; série:
    // finished/in-season/episode-available/awaiting-next-season/coming-soon) a partir de
    // mediaType + datas + status de produção — em vez do "unknown" hard-coded.
    availabilityState: availabilityStateFromTitle({
      media_type: details.mediaType,
      first_air_date: details.mediaType === "tv" ? details.releaseDate ?? null : null,
      last_air_date: details.lastAirDate ?? null,
      release_date: details.mediaType === "movie" ? details.releaseDate ?? null : null,
      status: details.status ?? null,
    }),
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
    catalogLocalization: details.catalogLocalization,
  };
}

/**
 * Fetches "Mais como este" recommendations via Balloonerismm (primary).
 * Trakt is no longer used for recommendation ranking — only for pt-BR enrichment
 * (handled downstream by enrichRelatedWithPtBrTitles) and local DB for images.
 *
 * Strategy:
 *   1. Fetch /recommendations + /similar from Balloonerismm for the seed imdbId
 *   2. Merge and score via mergeBalloonCandidates (recs > sim, internal ordering)
 *   3. Resolve tmdbId from local DB by imdbId (enables enrichRelatedWithLocalImages)
 *   4. Return CatalogSearchResult[] compatible with the existing enrichment pipeline
 */
async function getUnifiedRelated({
  mediaType,
  imdbId,
  locale,
}: {
  mediaType: RelatedMediaType;
  imdbId?: string | null;
  locale?: string | null;
  region?: string | null;
  traktId?: number | string | null;  // kept for call-site compat, unused
  traktSlug?: string | null;         // kept for call-site compat, unused
}): Promise<CatalogSearchResult[]> {
  if (!imdbId) return [];

  const apiMediaType = mediaType === "movie" ? "movie" as const : "tv" as const;

  const balloonFetch = await fetchBalloonerismForSeed(imdbId, apiMediaType, "title-related", locale);
  if (!balloonFetch.items.length) return [];

  // mergeBalloonCandidates expects BalloonSeedResult[]; single-seed call here.
  const merged = mergeBalloonCandidates([{
    seedImdbId:    imdbId,
    seedMediaType: apiMediaType,
    seedWeight:    100,
    seedTitle:     "",
    seedReason:    "",
    items:         balloonFetch.items,
  }]);

  console.log(
    `[title-related:balloon] context=title-related imdbId=${imdbId} ` +
    `candidates=${merged.length} ` +
    `recs=${merged.filter(c => c.balloonSource !== "similar").length} ` +
    `sim=${merged.filter(c => c.balloonSource !== "recommendations").length}`,
  );

  // Resolve tmdbIds from local DB so enrichRelatedWithLocalImages can find images
  const imdbIds = merged.map(c => c.imdbId).filter(Boolean);
  const imdbToTmdb = new Map<string, { tmdbId: number; mediaType: string }>();
  if (imdbIds.length > 0) {
    try {
      const rows = await db.titleExternalId.findMany({
        where:  { imdbId: { in: imdbIds }, tmdbId: { gt: 0 } },
        select: { imdbId: true, tmdbId: true, mediaType: true },
      });
      for (const r of rows) {
        if (r.imdbId) imdbToTmdb.set(r.imdbId, { tmdbId: r.tmdbId, mediaType: r.mediaType });
      }
    } catch { /* non-fatal, enrichment will skip */ }
  }

  return merged.map((c): CatalogSearchResult => {
    const resolved = imdbToTmdb.get(c.imdbId);
    // mediaType POR CANDIDATO: confia no registro local (resolvido por imdbId) quando
    // existir, não no mediaType da seed. Um candidato TV não pode herdar "movie" da seed,
    // senão o link da recomendação aponta para /title/movie/<id> e a página não resolve.
    const resolvedMediaType: "movie" | "show" =
      resolved?.mediaType === "tv"
        ? "show"
        : resolved?.mediaType === "movie"
          ? "movie"
          : mediaType;
    return {
      ids: {
        imdbId:  c.imdbId,
        tmdbId:  resolved?.tmdbId ?? undefined,
      },
      mediaType: resolvedMediaType,
      title:       c.title,
      year:        c.year ? (parseInt(c.year, 10) || undefined) : undefined,
      overview:    c.overview   ?? undefined,
      posterPath:  c.posterUrl  ?? undefined,
      genreIds:    c.genreIds   ?? [],
      voteAverage: c.voteAverage ?? undefined,
      voteCount:   c.voteCount   ?? undefined,
      source: { primary: "balloonerismm", confidence: "high", usedFallback: false },
    };
  });
}

function recommendationFromCatalogResult(result: CatalogSearchResult): TitleRecommendation {
  const localPoplogId = (result as CatalogSearchResult & { poplogId?: string | number | null }).poplogId ?? null;
  const imdbId = result.ids.imdbId ?? null;
  const tmdbId = result.ids.tmdbId ?? (imdbId ? syntheticTmdbFromImdbId(imdbId) : null);
  const linkId =
    localPoplogId ??
    result.ids.tmdbId ??
    imdbId ??
    result.ids.traktSlug ??
    result.ids.slug ??
    result.ids.traktId ??
    result.title;

  return {
    id: linkId,
    tmdbId,
    poplogId: localPoplogId,
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
  locale: string,
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
      id: true,
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
        poplogId: row.id,
        originalTitle: row.originalTitle,
        posterPath: row.posterPath,
        backdropPath: row.backdropPath,
      },
    ]),
  );

  const useLocalTitle = normalizeCatalogLanguage(locale) !== "en-US";

  return related.map((item) => {
    const tmdbId = item.ids.tmdbId;
    if (!tmdbId) return item;
    const mediaType = item.mediaType === "show" ? "tv" : "movie";
    const local = imageByKey.get(`${mediaType}:${tmdbId}`);
    if (!local) return item;
    const title = useLocalTitle && !item.originalTitle ? local.title ?? item.title : item.title;

    return {
      ...item,
      title,
      poplogId: local.poplogId,
      originalTitle: item.originalTitle ?? (useLocalTitle ? local.originalTitle ?? undefined : undefined),
      posterPath: item.posterPath ?? local.posterPath ?? undefined,
      backdropPath: item.backdropPath ?? local.backdropPath ?? null,
    };
  });
}

function normalizeRelatedCachePart(value: string | null | undefined, fallback: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLowerCase() : fallback;
}

function titleRelatedSectionKey(mediaType: RelatedMediaType, imdbId: string) {
  return `title_related:${mediaType}:${imdbId}`;
}

async function buildTitleRelatedCandidates(input: {
  mediaType: RelatedMediaType;
  imdbId: string;
  locale: string;
  region?: string;
}): Promise<CatalogSearchResult[]> {
  const relatedRaw = await getUnifiedRelated({
    mediaType: input.mediaType,
    imdbId: input.imdbId,
    locale: input.locale,
    region: input.region,
  });
  const relatedLocalized =
    normalizeCatalogLanguage(input.locale) === "en-US"
      ? relatedRaw
      : await enrichRelatedWithPtBrTitles(relatedRaw);
  return enrichRelatedWithLocalImages(relatedLocalized, input.locale);
}

const titleRelatedRefreshes = new Set<string>();

function refreshTitleRelatedInBackground(input: {
  mediaType: RelatedMediaType;
  imdbId: string;
  region: string;
  locale: string;
}) {
  const sectionKey = titleRelatedSectionKey(input.mediaType, input.imdbId);
  const refreshKey = `${sectionKey}:${input.region}:${input.locale}`;
  if (titleRelatedRefreshes.has(refreshKey)) return;
  titleRelatedRefreshes.add(refreshKey);

  void buildTitleRelatedCandidates(input)
    .then((items) =>
      writeContinuitySectionCache({
        sectionKey,
        region: input.region,
        language: input.locale,
        ttlMs: TITLE_RELATED_CACHE_TTL_MS,
        payload: {
          items,
          generatedAt: new Date().toISOString(),
        } satisfies TitleRelatedCachePayload,
      }),
    )
    .catch((err) => {
      console.warn("[title-related] background refresh failed", {
        imdbId: input.imdbId,
        mediaType: input.mediaType,
        error: err instanceof Error ? err.message : String(err),
      });
    })
    .finally(() => {
      titleRelatedRefreshes.delete(refreshKey);
    });
}

async function getTitleRelatedCandidatesUncached(input: {
  mediaType: RelatedMediaType;
  imdbId: string;
  region: string;
  locale: string;
}): Promise<CatalogSearchResult[]> {
  const sectionKey = titleRelatedSectionKey(input.mediaType, input.imdbId);
  const cached = await readContinuitySectionCache<TitleRelatedCachePayload>(sectionKey, {
    region: input.region,
    language: input.locale,
  });

  if (Array.isArray(cached?.payload.items) && (cached.status === "hit" || cached.status === "stale")) {
    if (cached.status === "stale") refreshTitleRelatedInBackground(input);
    console.log(
      `[title-related] cache=${cached.status} imdbId=${input.imdbId} mediaType=${input.mediaType} items=${cached.payload.items.length}`,
    );
    return cached.payload.items;
  }

  const items = await buildTitleRelatedCandidates(input);
  void writeContinuitySectionCache({
    sectionKey,
    region: input.region,
    language: input.locale,
    ttlMs: TITLE_RELATED_CACHE_TTL_MS,
    payload: {
      items,
      generatedAt: new Date().toISOString(),
    } satisfies TitleRelatedCachePayload,
  });

  return items;
}

const getTitleRelatedCandidatesCached = cache(
  async (
    mediaType: RelatedMediaType,
    imdbId: string,
    region: string,
    locale: string,
  ) =>
    getTitleRelatedCandidatesUncached({
      mediaType,
      imdbId,
      region,
      locale,
    }),
);

async function getTitleRelatedCandidates(input: {
  mediaType: RelatedMediaType;
  imdbId?: string | null;
  region: string;
  locale: string;
}) {
  if (!input.imdbId) return [];
  return getTitleRelatedCandidatesCached(
    input.mediaType,
    normalizeRelatedCachePart(input.imdbId, ""),
    normalizeRelatedCachePart(input.region, "br"),
    normalizeRelatedCachePart(input.locale, "pt-br"),
  );
}

async function filterRelatedOutsideUserLibrary(
  related: CatalogSearchResult[],
  userId: string | null | undefined,
): Promise<CatalogSearchResult[]> {
  if (!userId || related.length === 0) return related;

  // Leitura mínima de identificadores — NÃO hidrata disponibilidade nem busca
  // títulos faltantes em APIs externas. Evita disparar a hidratação em lote da
  // biblioteca inteira (e o cooldown do Balloonerismm) a cada página de título.
  const libraryIdentities = await getUserLibraryIdentityIndex(userId).catch((err) => {
    console.warn("[getTitlePageData] user library recommendation filter erro:", (err as Error)?.message);
    return null;
  });
  // Recommendation surfaces fail closed when authoritative library state cannot
  // be read; returning no rail is preferable to leaking already-saved titles.
  if (!libraryIdentities) return [];
  if (libraryIdentities.size === 0) return related;

  let removed = 0;
  const filtered = related.filter((item) => {
    const mediaType = item.mediaType === "show" ? "tv" : "movie";
    const inLibrary = hasTitleIdentity(libraryIdentities, {
      mediaType,
      tmdbId: item.ids.tmdbId ?? (item.ids.imdbId ? syntheticTmdbFromImdbId(item.ids.imdbId) : null),
      imdbId: item.ids.imdbId,
      traktId: item.ids.traktId,
      slug: item.ids.traktSlug,
    });

    if (inLibrary) removed++;
    return !inLibrary;
  });

  if (removed > 0) {
    console.log(`[title-related] library-filter removed=${removed} remaining=${filtered.length}`);
  }

  return filtered;
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
  const { mediaType, id, sourceHint = "auto", country = "BR", debugSource = false } = options;
  const language = normalizeCatalogLanguage(options.language);

  if (mediaType !== "movie" && mediaType !== "tv") return null;
  const requestedId = String(id).trim();
  if (!requestedId) return null;

  return withOrigin("title", async () => {
    try {
      const poplogDetails = await getPoplogTitleDetails({
        mediaType,
        id: requestedId,
        sourceHint,
        region: country,
        locale: language,
      });

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

        const [currentUser, providers, relatedRaw, seriesCanonical, traktEnrichment, movieFinancials, directFranchise] = await Promise.all([
          getCurrentUser().catch(() => null),
          getProvidersFromCache(
            resolvedMediaType,
            tmdbId,
            imdbId,
            country,
            language,
            base.releaseDate,
            base.firstAirDate,
          ),
          getTitleRelatedCandidates({
            mediaType: catalogMediaType,
            imdbId,
            region: country,
            locale: language,
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
          // Enriquecimento financeiro (filmes): orçamento/bilheteria via Wikidata
          // com fallback de infobox da Wikipedia. Só busca quando falta algum dos
          // dois; valores já completos da fonte primária são reaproveitados.
          resolvedMediaType === "movie" && imdbId
            ? getMovieFinancials({
                imdbId,
                poplogId: base.poplogId != null ? String(base.poplogId) : null,
                existingBudget: base.metadata?.budget ?? null,
                existingRevenue: base.metadata?.revenue ?? null,
              }).catch(() => null)
            : Promise.resolve(null),
          imdbId
            ? resolveDirectFranchiseForTitle({
                mediaType: resolvedMediaType,
                imdbId,
                tmdbId,
                poplogId: base.poplogId ?? null,
                title: base.title,
              }).catch(() => null)
            : Promise.resolve(null),
        ]);

        const isAuthenticated = Boolean(currentUser?.id);
        const titleUniverse = imdbId
          ? await resolveTitleUniverseForTitle({
              imdbId,
              directFranchise,
            }).catch(() => null)
          : null;

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

          if (seasons.length === 0 && effectiveSeasonCount && effectiveSeasonCount > 0) {
            seasons = buildSeasonStubsFromCount(effectiveSeasonCount).map((s) => ({
              seasonNumber: s.seasonNumber,
              name: null,
              airDate: null,
              episodeCount: null,
              posterUrl: null,
            }));
          }

          // Hidratação síncrona da lista externa fica atrás de flag. No fluxo
          // padrão local, a primeira visita fria agenda worker e retorna rápido.
          if (seasons.length === 0 && TITLE_COLD_SEASON_LIST_SYNC && (tvdbId || imdbId)) {
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
            }
          }

          // Se a página conseguiu resolver IDs mas o cache local ainda está vazio,
          // agenda hidratação por worker. Isso reduz a primeira visita fria; o
          // comportamento síncrono antigo só roda com POPLOG_TITLE_COLD_SERIES_SYNC.
          if (!hadSeasonCache && ratingKeyId && (imdbId || tvdbId || base.title)) {
            if (TITLE_COLD_SERIES_SYNC) {
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
            } else {
              await enqueueSeriesEpisodeHydrationJob({
                seriesTmdbId: ratingKeyId,
                imdbId: imdbId ?? null,
                traktId: traktId ?? null,
                priority: 35,
              }).catch((err) => {
                console.warn("[getTitlePageData] enqueueSeriesEpisodeHydrationJob erro:", (err as Error)?.message);
              });
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

        // Community rating + Trakt/base ratings. No external ratings API is called.
        // ratingKeyId já declarado acima (tmdbId real ou sintético negativo).
        const communityRating = ratingKeyId
          ? await getPublicRating(resolvedMediaType as "movie" | "tv", ratingKeyId).catch(() => null)
          : null;
        const enrichedRatings = base.ratings;

        const relatedOutsideLibrary = await filterRelatedOutsideUserLibrary(
          relatedRaw,
          currentUser?.id,
        );

        // P7: badge de disponibilidade nas recomendações ("Mais como este") via fluxo
        // canônico (cacheOnly — não atrasa o load da title page; aquece os frios).
        const recommendations: TitleRecommendation[] = await attachBestProvider(
          relatedOutsideLibrary.slice(0, 12).map(recommendationFromCatalogResult),
          {
            block: "title-related",
            getMediaType: (r) => r.mediaType,
            getTmdbId: (r) => r.tmdbId ?? null,
            getImdbId: (r) => r.imdbId ?? null,
            region: country,
            language,
          },
        );

        // Log de entrega: breakdown por fonte nos itens finais
        const recTraktOnly   = recommendations.filter((r) => r.tmdbId && r.tmdbId > 0 && !r.imdbId).length;
        const recBalloonOnly = recommendations.filter((r) => !r.tmdbId || r.tmdbId < 0).length;
        const recBoth        = recommendations.length - recTraktOnly - recBalloonOnly;
        console.log(
          `[title-related] delivered=${recommendations.length}` +
          ` trakt=${recTraktOnly + recBoth} balloon=${recBalloonOnly + recBoth} both=${recBoth}`,
        );

        // Write-through cache para IDs sintéticos (IMDb-first sem TMDB real).
        // Primeira visita à página já popula poplog3Title, então biblioteca/acompanhando
        // encontram os dados localmente sem nova chamada externa.
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

        // Enriquecimento Trakt: studios, certifications, network, next/last episode
        const traktEnrichmentPatch: Partial<TitlePageData> = {};
        if (traktEnrichment) {
          const existingMetaForStudios = (seriesEnrichment.metadata ?? base.metadata) ?? {};

          // studios → productionCompanies se vazio
          const studios = traktEnrichment.studios;
          if (studios?.length && !existingMetaForStudios.productionCompanies?.length) {
            traktEnrichmentPatch.metadata = {
              ...existingMetaForStudios,
              productionCompanies: studios.map((s) => ({ id: 0 as number, name: s.name })),
            };
          }

          // network: substitui/complementa os networks da engine canônica se houver slug
          if ("network" in traktEnrichment && traktEnrichment.network) {
            const tn = (traktEnrichment as { network: { name: string; slug: string; country?: string } }).network;
            const patchedMeta = traktEnrichmentPatch.metadata ?? existingMetaForStudios;
            const hasSluggedNetwork = patchedMeta.networks?.some((n) => n.slug);
            if (!hasSluggedNetwork) {
              traktEnrichmentPatch.metadata = {
                ...patchedMeta,
                networks: [{ id: 0, name: tn.name, slug: tn.slug, originCountry: tn.country ?? null }],
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

        // Enriquecimento financeiro: dobra orçamento/bilheteria no metadata final.
        // Reaproveita o canal traktEnrichmentPatch.metadata (que vence no spread
        // final), preservando o que já foi acumulado por base/series/trakt.
        if (resolvedMediaType === "movie" && (movieFinancials?.budget || movieFinancials?.revenue)) {
          const currentMeta =
            traktEnrichmentPatch.metadata ?? seriesEnrichment.metadata ?? base.metadata ?? {};
          traktEnrichmentPatch.metadata = {
            ...currentMeta,
            ...(movieFinancials.budget ? { budget: movieFinancials.budget } : {}),
            ...(movieFinancials.revenue ? { revenue: movieFinancials.revenue } : {}),
          };
        }

        if (directFranchise) {
          const currentMeta =
            traktEnrichmentPatch.metadata ?? seriesEnrichment.metadata ?? base.metadata ?? {};
          traktEnrichmentPatch.metadata = {
            ...currentMeta,
            collection: directFranchise,
          };
        }

        // Recalcula o estado da série com TODOS os sinais já conhecidos: o
        // próximo episódio (enriquecido via Trakt) e as temporadas. O estado em
        // `base.availabilityState` foi calculado cedo, antes do enriquecimento e
        // sem sinais de episódio — por isso séries com temporada no ar caíam em
        // "Aguardando temporada". Aqui passa a refletir in-season/episode-available.
        const resolvedAvailabilityState =
          resolvedMediaType === "tv"
            ? seriesStateFromTitle({
                media_type: "tv",
                first_air_date: base.firstAirDate ?? null,
                last_air_date: base.lastAirDate ?? null,
                status: base.status ?? null,
                next_episode_to_air: traktEnrichmentPatch.nextEpisode
                  ? { air_date: traktEnrichmentPatch.nextEpisode.air_date ?? null }
                  : base.nextEpisode
                    ? { air_date: base.nextEpisode.air_date ?? null }
                    : null,
                seasons: seasons.map((s) => ({
                  season_number: s.seasonNumber,
                  air_date: s.airDate ?? null,
                })),
              })
            : base.availabilityState;

        return {
          ...base,
          ...seriesEnrichment,
          ...traktEnrichmentPatch,
          availabilityState: resolvedAvailabilityState,
          providers,
          seasons,
          userState,
          userSeriesProgress,
          communityRating,
          ratings: enrichedRatings,
          generalIndex: enrichedRatings ? base.generalIndex : null,
          recommendations,
          universe: titleUniverse,
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
      // TMDB legacy fallback removido — sem id legado resolvível, não há página.
      return null;
    } catch (error) {
      console.error("[getTitlePageData] erro:", error);
      return null;

    }
  });
}
