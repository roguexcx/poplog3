import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
} from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getSeriesEpisodeRuntimesMap } from "@/server/runtime/series-episode-runtimes";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";
import { catalogGetTrending } from "@/server/source-engine/engine";
import {
  hydrateCatalogResultsWithDebug,
  resolveCatalogIdentityFields,
} from "@/server/source-engine/hydrate-catalog-results";
import { attachBestProvider } from "@/server/availability/attach-best-provider";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import type { PoplogTitle } from "@/server/types/title";
import { db } from "@/server/db/client";
import { sourceEngineLog } from "@/server/source-engine/source-log";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
} from "@/server/source-engine/locale";
import { isTraktIndexEnabled } from "@/lib/trakt-index/engine";
import { getPoplogDailyTrendingIndex } from "@/lib/trakt-index/canonical";
import type { TraktIndexItem } from "@/lib/trakt-index/types";
import { isExcludedFormat } from "@/lib/content-format/excluded-formats";

/**
 * Pipeline canônico de "Em alta agora" (trending).
 *
 * Esta é a ÚNICA fonte de verdade do trending no POPLOG. Tanto a rota
 * `/api/trending` (bloco "Em alta agora — O que todo mundo está assistindo")
 * quanto o Hero rotativo da Home consomem este mesmo pipeline, garantindo
 * que as duas superfícies usem exatamente a mesma base, exclusões,
 * região/disponibilidade e tratamento de fallback. As regras de exibição
 * próprias do Hero (rotação a cada F5, imagem/tradução/metadata mínima)
 * permanecem na camada da Home.
 */

export const TRENDING_CACHE_TTL_MS = 30 * 60_000;
export const TRENDING_DB_TIMEOUT_MS = 1_500;
export const TRENDING_TRAKT_LIMIT = 15;
export const TRENDING_MIN_RESULTS = 5;
export const TRENDING_LOCAL_FALLBACK_LIMIT = 20;
export const TRAKT_INDEX_TIMEOUT_MS = 14_000;

const TRENDING_SECTION_KEY = "home_trending";
const TRENDING_LIGHT_SECTION_KEY = "home_trending_light";
const TRENDING_REGION = "BR";
const TRENDING_LANGUAGE = "pt-BR";
const TRENDING_LIGHT_CACHE_TTL_MS = 10 * 60_000;

/** Item de trending já enriquecido (runtime_label + disponibilidade). */
export type EnrichedTrendingTitle = Awaited<
  ReturnType<typeof enrichWithRuntime>
>[number];

export type TrendingFeedSource =
  | "cache"
  | "trakt_index"
  | "trakt"
  | "local_db"
  | "unavailable";

export interface TrendingFeedResult {
  /** Lista canônica enriquecida (NÃO pontuada por feedback — o caller aplica). */
  items: EnrichedTrendingTitle[];
  source: TrendingFeedSource;
  /** Status usado nos logs de perf (`persistent_hit`, `trakt_index_primary`, ...). */
  cacheStatus: string;
  /** `true` quando os itens vieram do cache de continuidade. */
  fromCache: boolean;
  cacheReadStatus?: "hit" | "stale";
  /** Objeto pronto para spread em `debugSource` na resposta da rota. */
  debugSource: Record<string, unknown>;
}

export interface GetTrendingFeedOptions {
  /** Callback opcional para marcação de estágios de performance. */
  recordStage?: (stage: string) => void;
  /** Quando falso, evita availability/providers no payload e no cache desta superfície. */
  includeProviders?: boolean;
  /** Caminho de baixa latência para a Home: cache/local DB, sem esperar fonte externa. */
  fast?: boolean;
  /** Usado por refresh em background para recalcular mesmo com cache existente. */
  skipCache?: boolean;
  /** Se `fast` usar fallback local, agenda refresh externo fora do caminho crítico. */
  backgroundRefresh?: boolean;
  /** Idioma do catálogo usado para cache/logs e consultas localizadas. */
  language?: string | null;
  /** Região de disponibilidade usada para providers/cache. */
  region?: string | null;
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

/** Converte TraktIndexItem para o formato PoplogTitle esperado pela UI. */
function traktIndexToPoplogTitle(item: TraktIndexItem): PoplogTitle {
  return {
    tmdb_id: item.tmdb_id,
    media_type: item.media_type,
    poplogId: null,
    externalIds: item.externalIds,
    identityUsed: item.identityUsed,
    linkIdUsed: item.linkIdUsed,
    hasPoplogId: false,
    normalizedFrom: item.normalizedFrom,
    legacyCompatibilityUsed: true,
    title: item.title,
    original_title: item.original_title,
    overview: item.overview,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path,
    release_date: item.release_date,
    first_air_date: item.first_air_date,
    year: item.year,
    runtime: item.runtime,
    genres: [],
    popularity: item.popularity,
    vote_average: item.vote_average,
    vote_count: item.vote_count,
  };
}

async function fetchLocalTrending(): Promise<PoplogTitle[]> {
  try {
    const rows = await db.poplog3Title.findMany({
      where: { posterPath: { not: null } },
      orderBy: { popularity: "desc" },
      take: TRENDING_LOCAL_FALLBACK_LIMIT,
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
        runtime: true,
        episodeRunTime: true,
        genres: true,
        popularity: true,
        voteAverage: true,
        voteCount: true,
        originalLanguage: true,
        imdbId: true,
      },
    });

    return rows
      .filter((row) => !isExcludedFormat(row.genres))
      .map((row) => ({
        tmdb_id: row.tmdbId,
        media_type: row.mediaType as "movie" | "tv",
        title: row.title ?? row.originalTitle ?? "",
        original_title: row.originalTitle ?? null,
        overview: row.overview ?? null,
        poster_path: row.posterPath ?? null,
        backdrop_path: row.backdropPath ?? null,
        release_date: row.mediaType === "movie" ? (row.releaseDate?.toISOString().slice(0, 10) ?? null) : null,
        first_air_date: row.mediaType === "tv" ? (row.firstAirDate?.toISOString().slice(0, 10) ?? null) : null,
        last_air_date: row.mediaType === "tv" ? (row.lastAirDate?.toISOString().slice(0, 10) ?? null) : null,
        year: row.year ?? null,
        runtime: row.mediaType === "movie" ? row.runtime ?? null : null,
        episode_run_time: row.mediaType === "tv" ? (Array.isArray(row.episodeRunTime) ? row.episodeRunTime as number[] : null) : null,
        genres: Array.isArray(row.genres) ? (row.genres as number[]) : [],
        popularity: row.popularity != null ? Number(row.popularity) : null,
        vote_average: row.voteAverage != null ? Number(row.voteAverage) : null,
        vote_count: row.voteCount ?? null,
        original_language: row.originalLanguage ?? null,
        imdb_id: row.imdbId ?? undefined,
        poplogId: row.id,
        externalIds: { tmdbId: row.tmdbId, ...(row.imdbId ? { imdbId: row.imdbId } : {}) },
        ...resolveCatalogIdentityFields({
          tmdb_id: row.tmdbId,
          imdb_id: row.imdbId,
          media_type: row.mediaType as "movie" | "tv",
          poplogId: row.id,
        }, "legacy"),
        normalizedFrom: "legacy" as const,
      }));
  } catch {
    return [];
  }
}

/**
 * Enriquece PoplogTitle[] com runtime_label e disponibilidade (best_provider_*).
 * Mesmo contrato do card da Watchlist e do bloco "Em alta agora".
 */
async function enrichWithRuntime(
  titles: PoplogTitle[],
  options: { includeProviders?: boolean; region?: string; language?: string } = {},
) {
  const tvIds = titles
    .filter((t) => t.media_type === "tv")
    .map((t) => t.tmdb_id);

  const episodeRuntimesBySeries =
    tvIds.length > 0
      ? await withTimeout(
          getSeriesEpisodeRuntimesMap(tvIds),
          TRENDING_DB_TIMEOUT_MS,
          new Map(),
        )
      : new Map();

  const enriched = titles.map((title) => {
    const runtimeResolution = resolveRuntimeByMediaType({
      mediaType: title.media_type,
      runtimeMinutes: title.runtime ?? null,
      episodeRunTime: title.episode_run_time ?? null,
      episodes: episodeRuntimesBySeries.get(title.tmdb_id) ?? null,
    });
    const runtimeLabel =
      title.media_type === "tv"
        ? formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
            estimated: runtimeResolution.estimated,
          })
        : formatRuntimeLabel(runtimeResolution.minutes, {
            estimated: runtimeResolution.estimated,
          });

    // Itens do Trakt Index já têm identity resolvida — não sobrescrever.
    const identityOverride = title.normalizedFrom === "trakt_index"
      ? {}
      : resolveCatalogIdentityFields(title, title.normalizedFrom === "cache-fuzzy" ? "cache-fuzzy" : "trakt");

    return {
      ...title,
      id: title.tmdb_id,
      ...identityOverride,
      runtime: runtimeResolution.minutes,
      runtime_label: runtimeLabel,
    };
  });

  if (options.includeProviders === false) {
    return enriched.map((title) => ({
      ...title,
      best_provider_name: null,
      best_provider_type: null,
      best_provider_logo: null,
    }));
  }

  return attachBestProvider(enriched, {
    block: "trending",
    getMediaType: (t) => t.media_type,
    getTmdbId: (t) => t.tmdb_id,
    getImdbId: (t) => t.externalIds?.imdbId,
    region: options.region,
  });
}

/**
 * Interleave movies and tv results: [movie1, tv1, movie2, tv2, ...]
 * Preserves Trakt popularity order within each type.
 */
function interleaveTrending(movies: PoplogTitle[], tv: PoplogTitle[]): PoplogTitle[] {
  const result: PoplogTitle[] = [];
  const len = Math.max(movies.length, tv.length);
  for (let i = 0; i < len; i++) {
    if (i < movies.length) result.push(movies[i]);
    if (i < tv.length) result.push(tv[i]);
  }
  return result;
}

type TrendingCachePayload = {
  results: EnrichedTrendingTitle[];
  generatedAt: string;
};

const TRENDING_REFRESH_IN_FLIGHT = new Map<string, Promise<void>>();

function logProtectedTrendingFeed(
  area: string,
  items: Array<{ externalIds?: { imdbId?: string | null }; imdb_id?: string | null }>,
  scope: { language: string; region: string },
) {
  sourceEngineLog("protected_feed_preserved", {
    area,
    providers: "trakt+balloonerismm",
    locale: scope.language,
    region: scope.region,
  });

  for (const item of items.slice(0, 3)) {
    const imdb = item.externalIds?.imdbId ?? item.imdb_id ?? null;
    if (!imdb) continue;
    sourceEngineLog("protected_feed_item_normalized", {
      imdb,
      source: "trakt+balloonerismm",
      locale: scope.language,
      region: scope.region,
    }, "debug");
  }
}

function scheduleTrendingRefresh(options: {
  includeProviders: boolean;
  sectionKey: string;
  language: string;
  region: string;
}) {
  if (TRENDING_REFRESH_IN_FLIGHT.has(options.sectionKey)) return;

  const promise = getTrendingFeed({
    includeProviders: options.includeProviders,
    skipCache: true,
    fast: false,
    language: options.language,
    region: options.region,
  })
    .then(() => undefined)
    .catch((error) => {
      console.warn(
        "[trending] background_refresh_failed",
        error instanceof Error ? error.message : error,
      );
    })
    .finally(() => {
      TRENDING_REFRESH_IN_FLIGHT.delete(options.sectionKey);
    });

  TRENDING_REFRESH_IN_FLIGHT.set(options.sectionKey, promise);
}

/**
 * Resolve a lista canônica de trending seguindo a cadeia de fontes:
 * cache de continuidade → Trakt Index → Trakt adapter → DB local.
 *
 * Os itens retornados NÃO são pontuados por feedback do usuário; o caller
 * (rota ou Hero) aplica `applyUserFeedbackScoring` com seu próprio contexto,
 * mantendo um único ponto de scoring compartilhado.
 */
export async function getTrendingFeed(
  options: GetTrendingFeedOptions = {},
): Promise<TrendingFeedResult> {
  const recordStage = options.recordStage ?? (() => {});
  const includeProviders = options.includeProviders ?? true;
  const language = normalizeCatalogLanguage(options.language ?? TRENDING_LANGUAGE);
  const region = normalizeCatalogRegion(options.region ?? TRENDING_REGION);
  const sectionKey = includeProviders ? TRENDING_SECTION_KEY : TRENDING_LIGHT_SECTION_KEY;

  if (!options.skipCache) {
    const cached = await readContinuitySectionCache<TrendingCachePayload>(sectionKey, {
      region,
      language,
    });
    recordStage("cache_read");

    if (cached?.payload.results?.length && (cached.status === "hit" || cached.status === "stale")) {
      return {
        items: cached.payload.results,
        source: "cache",
        cacheStatus: cached.status === "hit" ? "persistent_hit" : "persistent_stale",
        fromCache: true,
        cacheReadStatus: cached.status,
        debugSource: {
          source: "cache",
          fallbackUsed: false,
          usedTmdbApi: false,
          usedLegacy: false,
          normalizedFrom: "continuity_section_cache",
          identityUsed: "cached_payload",
          legacyCompatibilityUsed: true,
          cacheStatus: cached.status,
          includeProviders,
        },
      };
    }
  } else {
    recordStage("cache_skip");
  }

  if (options.fast) {
    const localTitles = await withTimeout(
      fetchLocalTrending(),
      TRENDING_DB_TIMEOUT_MS,
      [],
    );
    const localValid = filterValidTitles(localTitles);
    recordStage("local_fallback");

    if (localValid.length > 0) {
      const withRuntime = await enrichWithRuntime(localValid, { includeProviders, region, language });

      void writeContinuitySectionCache({
        sectionKey,
        region,
        language,
        ttlMs: TRENDING_LIGHT_CACHE_TTL_MS,
        payload: { results: withRuntime, generatedAt: new Date().toISOString() } satisfies TrendingCachePayload,
      });

      if (options.backgroundRefresh) {
        scheduleTrendingRefresh({ includeProviders, sectionKey, region, language });
      }
      logProtectedTrendingFeed("home-trending", withRuntime, { region, language });

      return {
        items: withRuntime,
        source: "local_db",
        cacheStatus: "local_db_fast",
        fromCache: false,
        debugSource: {
          source: "local_db",
          fallbackUsed: true,
          fallbackReason: "fast_home_cache_miss",
          usedTmdbApi: false,
          usedLegacy: false,
          normalizedFrom: "local_cache",
          identityUsed: "poplog_id",
          legacyCompatibilityUsed: true,
          includeProviders,
          language,
          region,
        },
      };
    }

    if (options.backgroundRefresh) {
      scheduleTrendingRefresh({ includeProviders, sectionKey, region, language });
    }

    return {
      items: [],
      source: "unavailable",
      cacheStatus: "fast_empty",
      fromCache: false,
      debugSource: {
        source: "unavailable",
        fallbackUsed: true,
        fallbackReason: "fast_home_no_local_results",
        includeProviders,
        language,
        region,
      },
    };
  }

  // ── Trakt Index (fonte primária) ──────────────────────────────────────────
  if (isTraktIndexEnabled()) {
    try {
      const traktItems = await withTimeout(
        getPoplogDailyTrendingIndex(),
        TRAKT_INDEX_TIMEOUT_MS,
        [] as TraktIndexItem[],
      );
      recordStage("external_fetch");

      if (traktItems.length >= TRENDING_MIN_RESULTS) {
        const titles = traktItems.map(traktIndexToPoplogTitle);
        const withRuntime = await enrichWithRuntime(titles, { includeProviders, region, language });
        recordStage("cache_tables_read");

        void writeContinuitySectionCache({
          sectionKey,
          region,
          language,
          ttlMs: TRENDING_CACHE_TTL_MS,
          payload: { results: withRuntime, generatedAt: new Date().toISOString() } satisfies TrendingCachePayload,
        });
        logProtectedTrendingFeed("home-trending", withRuntime, { region, language });

        return {
          items: withRuntime,
          source: "trakt_index",
          cacheStatus: "trakt_index_primary",
          fromCache: false,
          debugSource: { source: "trakt_index", period: "daily", fallbackUsed: false, includeProviders, language, region },
        };
      }

      console.log("[trending] source=trakt_index_fallback reason=%s",
        traktItems.length === 0 ? "empty" : "insufficient");
    } catch (err) {
      console.warn("[trending] source=trakt_index_fallback reason=error",
        err instanceof Error ? err.message : err);
      recordStage("external_fetch");
    }
  }

  // ── Trakt adapter ──────────────────────────────────────────────────────────
  try {
    const [movieResults, tvResults] = await Promise.all([
      catalogGetTrending({ mediaType: "movie", limit: TRENDING_TRAKT_LIMIT }),
      catalogGetTrending({ mediaType: "show", limit: TRENDING_TRAKT_LIMIT }),
    ]);
    recordStage("external_fetch");

    const [movieHydrated, tvHydrated] = await Promise.all([
      hydrateCatalogResultsWithDebug(movieResults),
      hydrateCatalogResultsWithDebug(tvResults),
    ]);
    const merged = interleaveTrending(movieHydrated.titles, tvHydrated.titles);
    const traktDebug: Record<string, unknown> = {
      source: "trakt",
      rawCount: movieHydrated.debug.rawCount + tvHydrated.debug.rawCount,
      normalizedCount:
        movieHydrated.debug.normalizedCount + tvHydrated.debug.normalizedCount,
      poplogResolvedCount:
        movieHydrated.debug.poplogResolvedCount + tvHydrated.debug.poplogResolvedCount,
      searchCompatibleCount:
        movieHydrated.debug.searchCompatibleCount + tvHydrated.debug.searchCompatibleCount,
      fallbackUsed: false,
      fallbackReason: null as string | null,
      usedTmdbApi: false,
      normalizedFrom: "trakt",
      identityUsed: "poplog_id_or_best_alias",
      legacyCompatibilityUsed: true,
      externalIdStats: {
        imdbId:
          movieHydrated.debug.externalIdStats.imdbId + tvHydrated.debug.externalIdStats.imdbId,
        tmdbId:
          movieHydrated.debug.externalIdStats.tmdbId + tvHydrated.debug.externalIdStats.tmdbId,
        tvdbId:
          movieHydrated.debug.externalIdStats.tvdbId + tvHydrated.debug.externalIdStats.tvdbId,
        traktId:
          movieHydrated.debug.externalIdStats.traktId + tvHydrated.debug.externalIdStats.traktId,
        slug:
          movieHydrated.debug.externalIdStats.slug + tvHydrated.debug.externalIdStats.slug,
        poplogResolved:
          movieHydrated.debug.externalIdStats.poplogResolved +
          tvHydrated.debug.externalIdStats.poplogResolved,
        temporaryCandidates:
          movieHydrated.debug.externalIdStats.temporaryCandidates +
          tvHydrated.debug.externalIdStats.temporaryCandidates,
      },
    };
    recordStage("normalization");

    const validTitles = filterValidTitles(merged);

    if (validTitles.length >= TRENDING_MIN_RESULTS) {
      const withRuntime = await enrichWithRuntime(validTitles, { includeProviders, region, language });
      recordStage("cache_tables_read");

      void writeContinuitySectionCache({
        sectionKey,
        region,
        language,
        ttlMs: TRENDING_CACHE_TTL_MS,
        payload: { results: withRuntime, generatedAt: new Date().toISOString() } satisfies TrendingCachePayload,
      });
      logProtectedTrendingFeed("home-trending", withRuntime, { region, language });

      return {
        items: withRuntime,
        source: "trakt",
        cacheStatus: "trakt_primary",
        fromCache: false,
        debugSource: traktDebug,
      };
    }

    console.log(
      `[trending] source=trakt_fallback reason=${validTitles.length < TRENDING_MIN_RESULTS ? "insufficient" : "empty"}`,
    );
  } catch (err) {
    console.warn(
      "[trending] source=trakt_fallback reason=error",
      err instanceof Error ? err.message : err,
    );
    recordStage("external_fetch");
  }

  // ── DB local (fallback) ────────────────────────────────────────────────────
  const localTitles = await withTimeout(
    fetchLocalTrending(),
    TRENDING_DB_TIMEOUT_MS,
    [],
  );
  const localValid = filterValidTitles(localTitles);
  recordStage("local_fallback");

  if (localValid.length > 0) {
    const withRuntime = await enrichWithRuntime(localValid, { includeProviders, region, language });
    logProtectedTrendingFeed("home-trending", withRuntime, { region, language });
    return {
      items: withRuntime,
      source: "local_db",
      cacheStatus: "local_db_fallback",
      fromCache: false,
      debugSource: {
        source: "local_db",
        fallbackUsed: true,
        fallbackReason: "trakt_insufficient_or_failed",
        usedTmdbApi: false,
        usedLegacy: false,
        normalizedFrom: "local_cache",
        identityUsed: "poplog_id",
        legacyCompatibilityUsed: true,
        language,
        region,
      },
    };
  }

  return {
    items: [],
    source: "unavailable",
    cacheStatus: "all_sources_empty",
    fromCache: false,
    debugSource: {
      source: "unavailable",
      fallbackUsed: true,
      fallbackReason: "all_sources_empty",
      usedTmdbApi: false,
      usedLegacy: false,
      normalizedFrom: "none",
      identityUsed: "none",
      legacyCompatibilityUsed: true,
      language,
      region,
    },
  };
}
