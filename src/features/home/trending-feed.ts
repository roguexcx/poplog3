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
import {
  getPoplogDailyTrendingIndex,
  HOME_TRENDING_CACHE_KEY,
  HOME_TRENDING_LIGHT_CACHE_KEY,
  HOME_TRENDING_LOCAL_CACHE_KEY,
  HOME_TRENDING_LOCAL_LIGHT_CACHE_KEY,
} from "@/lib/trakt-index/canonical";
import type { TraktIndexItem } from "@/lib/trakt-index/types";
import { isExcludedFormat } from "@/lib/content-format/excluded-formats";
import {
  computeCatalogLanguageStats,
  resolveCatalogLocalization,
  type CatalogLanguageStats,
} from "@/lib/i18n/catalog-localization";
import { getCatalogLocalizationsByPoplogId } from "@/server/catalog/catalog-localization-store";
import type { TrendingRealness } from "@/lib/trending/trending-contract";

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

// Chaves do trending REAL (termômetro vivo) — fonte de verdade compartilhada.
const TRENDING_SECTION_KEY = HOME_TRENDING_CACHE_KEY;
const TRENDING_LIGHT_SECTION_KEY = HOME_TRENDING_LIGHT_CACHE_KEY;
// Chaves do FALLBACK local (popularidade) — SEPARADAS do trending real para
// nunca apresentar popularidade local como se fosse trending.
const TRENDING_LOCAL_SECTION_KEY = HOME_TRENDING_LOCAL_CACHE_KEY;
const TRENDING_LOCAL_LIGHT_SECTION_KEY = HOME_TRENDING_LOCAL_LIGHT_CACHE_KEY;
const TRENDING_REGION = "BR";
const TRENDING_LANGUAGE = "pt-BR";
// TTL próprio e previsível por fonte: trending real dura mais; fallback local
// dura pouco para ser substituído rapidamente pelo trending real.
const TRENDING_LOCAL_CACHE_TTL_MS = 10 * 60_000;

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
  /** Termômetro real vs. contingência local — nunca apresentar um como o outro. */
  realness: TrendingRealness;
  /** Status usado nos logs de perf (`persistent_hit`, `trakt_index_primary`, ...). */
  cacheStatus: string;
  /** `true` quando os itens vieram do cache de continuidade. */
  fromCache: boolean;
  cacheReadStatus?: "hit" | "stale";
  /** Idioma de catálogo efetivamente resolvido. */
  language: string;
  region: string;
  /** Cobertura de idioma da lista retornada (métricas pt-BR/en-US). */
  languageStats: CatalogLanguageStats;
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
    localized: item.localized,
    recency: item.recency,
  };
}

async function fetchLocalTrending(language?: string | null): Promise<PoplogTitle[]> {
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

    const localizationEntries = await Promise.all(
      rows.map(async (row) => ({
        poplogId: row.id,
        rows: await getCatalogLocalizationsByPoplogId(row.id).catch(() => []),
      })),
    );
    const localizationsByPoplogId = new Map(localizationEntries.map((entry) => [entry.poplogId, entry.rows]));

    return rows
      .filter((row) => !isExcludedFormat(row.genres))
      .map((row) => {
        const resolved = resolveCatalogLocalization(
          {
            title: row.title,
            originalTitle: row.originalTitle,
            overview: row.overview,
            localizations: localizationsByPoplogId.get(row.id) ?? [],
          },
          language,
        );
        return {
          tmdb_id: row.tmdbId,
          media_type: row.mediaType as "movie" | "tv",
          title: resolved.title ?? row.title ?? row.originalTitle ?? "",
          original_title: row.originalTitle ?? null,
          overview: resolved.overview ?? row.overview ?? null,
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
          localized: {
            [resolved.language]: {
              title: resolved.title,
              overview: resolved.overview,
              tagline: resolved.tagline,
            },
          },
          externalIds: { tmdbId: row.tmdbId, ...(row.imdbId ? { imdbId: row.imdbId } : {}) },
          ...resolveCatalogIdentityFields({
            tmdb_id: row.tmdbId,
            imdb_id: row.imdbId,
            media_type: row.mediaType as "movie" | "tv",
            poplogId: row.id,
          }, "legacy"),
          normalizedFrom: "legacy" as const,
        };
      });
  } catch {
    return [];
  }
}

/**
 * Resolve a identidade POPLOG de cada item contra `poplog3Title` (IMDb-first),
 * preenchendo `poplogId`/`hasPoplogId` quando há vínculo no banco. Garante que
 * todo item de Trending passe por identidade canônica antes de ir para a UI.
 *
 * Ordem de casamento: imdbId (principal) → tmdbId+mediaType (alias de suporte).
 */
async function resolvePoplogIdentity<
  T extends {
    tmdb_id: number;
    media_type: "movie" | "tv";
    poplogId?: string | number | null;
    hasPoplogId?: boolean;
    identityUsed?: string;
    externalIds?: { imdbId?: string; tmdbId?: number };
    imdb_id?: string | null;
  },
>(items: T[]): Promise<T[]> {
  if (items.length === 0) return items;

  const imdbIds = Array.from(
    new Set(
      items
        .map((t) => t.externalIds?.imdbId ?? t.imdb_id ?? null)
        .filter((v): v is string => Boolean(v)),
    ),
  );
  const tmdbIds = Array.from(
    new Set(items.map((t) => t.tmdb_id).filter((id) => Number.isFinite(id) && id > 0)),
  );

  if (imdbIds.length === 0 && tmdbIds.length === 0) return items;

  try {
    const rows = await db.poplog3Title.findMany({
      where: {
        OR: [
          ...(imdbIds.length ? [{ imdbId: { in: imdbIds } }] : []),
          ...(tmdbIds.length ? [{ tmdbId: { in: tmdbIds } }] : []),
        ],
      },
      select: { id: true, imdbId: true, tmdbId: true, mediaType: true },
    });

    const byImdb = new Map<string, string>();
    const byTmdb = new Map<string, string>();
    for (const row of rows) {
      if (row.imdbId) byImdb.set(row.imdbId, row.id);
      byTmdb.set(`${row.tmdbId}:${row.mediaType}`, row.id);
    }

    return items.map((item) => {
      if (item.poplogId) return item;
      const imdb = item.externalIds?.imdbId ?? item.imdb_id ?? null;
      const poplogId =
        (imdb ? byImdb.get(imdb) : undefined) ??
        byTmdb.get(`${item.tmdb_id}:${item.media_type}`);
      if (!poplogId) return item;
      return {
        ...item,
        poplogId,
        hasPoplogId: true,
        identityUsed: "poplog_id",
      };
    });
  } catch (error) {
    console.warn(
      "[trending] poplog_identity_resolution_failed",
      error instanceof Error ? error.message : error,
    );
    return items;
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

  // Resolução de identidade POPLOG (IMDb-first) contra o banco para todos os
  // itens — inclusive os do Trakt Index, que chegam sem poplogId.
  const identified = await withTimeout(
    resolvePoplogIdentity(enriched),
    TRENDING_DB_TIMEOUT_MS,
    enriched,
  );

  if (options.includeProviders === false) {
    return identified.map((title) => ({
      ...title,
      best_provider_name: null,
      best_provider_type: null,
      best_provider_logo: null,
    }));
  }

  return attachBestProvider(identified, {
    block: "trending",
    getMediaType: (t) => t.media_type,
    getTmdbId: (t) => t.tmdb_id,
    getImdbId: (t) => t.externalIds?.imdbId,
    region: options.region,
    language: options.language,
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

// Versão do payload do feed cacheado. Incrementar invalida proativamente os
// payloads antigos: payloads PRÉ-migração (sem `localized`, com título pt-BR
// "queimado") são tratados como miss e reconstruídos no idioma correto.
const TRENDING_PAYLOAD_VERSION = "v2-localized";

type TrendingCachePayload = {
  results: EnrichedTrendingTitle[];
  generatedAt: string;
  payloadVersion?: string;
};

/** Payload do cache é da versão atual? (payloads antigos sem versão → false). */
function isCurrentPayload(payload: TrendingCachePayload | undefined | null): boolean {
  return payload?.payloadVersion === TRENDING_PAYLOAD_VERSION;
}

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
  // Dedup por seção + idioma + região: cada locale tem seu próprio refresh,
  // senão um refresh pt-BR bloquearia o refresh en-US (mesma sectionKey).
  const inFlightKey = `${options.sectionKey}:${options.language}:${options.region}`;
  if (TRENDING_REFRESH_IN_FLIGHT.has(inFlightKey)) return;

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
      TRENDING_REFRESH_IN_FLIGHT.delete(inFlightKey);
    });

  TRENDING_REFRESH_IN_FLIGHT.set(inFlightKey, promise);
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
  // Trending REAL e FALLBACK local vivem em chaves separadas: o fallback nunca
  // sobrescreve o termômetro real e cada um tem TTL próprio e previsível.
  const sectionKey = includeProviders ? TRENDING_SECTION_KEY : TRENDING_LIGHT_SECTION_KEY;
  const localSectionKey = includeProviders
    ? TRENDING_LOCAL_SECTION_KEY
    : TRENDING_LOCAL_LIGHT_SECTION_KEY;

  /**
   * Centraliza o preenchimento de `realness`/`languageStats` e a telemetria de
   * fonte+idioma, garantindo que todo retorno carregue o mesmo contrato.
   */
  const finalize = (partial: {
    items: EnrichedTrendingTitle[];
    source: TrendingFeedSource;
    cacheStatus: string;
    fromCache: boolean;
    cacheReadStatus?: "hit" | "stale";
    debugSource: Record<string, unknown>;
  }): TrendingFeedResult => {
    const realness: TrendingRealness =
      partial.source === "local_db" ? "fallback_local" : "trending";
    const languageStats = computeCatalogLanguageStats(
      partial.items.map((item) => item.localized ?? null),
      language,
    );
    console.log("[trending/telemetry]", {
      source: partial.source,
      realness,
      cacheStatus: partial.cacheStatus,
      count: partial.items.length,
      requestedLanguage: language,
      resolvedLanguage: languageStats.resolvedLanguage,
      region,
      hasPtBrData: languageStats.hasPtBrData,
      hasEnUsData: languageStats.hasEnUsData,
      usedFallbackLanguage: languageStats.usedFallbackLanguage,
      incompleteInRequested: languageStats.incompleteInRequested,
      withPoplogId: partial.items.filter((i) => i.poplogId).length,
    });
    return {
      ...partial,
      realness,
      language,
      region,
      languageStats,
      debugSource: { ...partial.debugSource, realness, languageStats },
    };
  };

  if (!options.skipCache) {
    // Lê apenas a chave do trending REAL — nunca serve fallback como se fosse real.
    const cached = await readContinuitySectionCache<TrendingCachePayload>(sectionKey, {
      region,
      language,
    });
    recordStage("cache_read");

    // Só serve payloads da versão atual. Payloads PRÉ-migração (sem `localized`,
    // título pt-BR queimado) são ignorados e reconstruídos no idioma correto.
    const usable =
      cached?.payload.results?.length &&
      isCurrentPayload(cached.payload) &&
      (cached.status === "hit" || cached.status === "stale");

    if (usable) {
      // Stale não pode ser servido indefinidamente: agenda refresh em background
      // para que a próxima request receba a versão fresca (self-heal).
      if (cached!.status === "stale") {
        scheduleTrendingRefresh({ includeProviders, sectionKey, region, language });
      }
      return finalize({
        items: cached!.payload.results,
        source: "cache",
        cacheStatus: cached!.status === "hit" ? "persistent_hit" : "persistent_stale",
        fromCache: true,
        cacheReadStatus: cached!.status,
        debugSource: {
          source: "cache",
          realnessOfCachedBase: "trending",
          fallbackUsed: false,
          usedTmdbApi: false,
          usedLegacy: false,
          normalizedFrom: "continuity_section_cache",
          identityUsed: "cached_payload",
          legacyCompatibilityUsed: true,
          cacheStatus: cached!.status,
          includeProviders,
        },
      });
    }

    if (cached?.payload.results?.length && !isCurrentPayload(cached.payload)) {
      console.log("[trending] stale_payload_version_ignored key=%s lang=%s", sectionKey, language);
    }
  } else {
    recordStage("cache_skip");
  }

  if (options.fast) {
    // 1) Antes de qualquer fallback local (pt-BR-only), tenta o índice Trakt
    //    BILÍNGUE já cacheado, projetado para o idioma pedido. Isso garante que
    //    "Em alta agora" respeite `catalogLanguage` (en-US mostra inglês) sem
    //    bloquear o caminho crítico: `peek` só lê cache, nunca reconstrói.
    if (isTraktIndexEnabled()) {
      const peeked = await withTimeout(
        getPoplogDailyTrendingIndex({ language, peek: true }),
        TRENDING_DB_TIMEOUT_MS,
        [] as TraktIndexItem[],
      );
      recordStage("index_peek");

      if (peeked.length >= TRENDING_MIN_RESULTS) {
        const titles = peeked.map(traktIndexToPoplogTitle);
        const withRuntime = await enrichWithRuntime(titles, { includeProviders, region, language });

        void writeContinuitySectionCache({
          sectionKey,
          region,
          language,
          ttlMs: TRENDING_CACHE_TTL_MS,
          payload: { results: withRuntime, generatedAt: new Date().toISOString(), payloadVersion: TRENDING_PAYLOAD_VERSION } satisfies TrendingCachePayload,
        });
        if (options.backgroundRefresh) {
          scheduleTrendingRefresh({ includeProviders, sectionKey, region, language });
        }
        logProtectedTrendingFeed("home-trending", withRuntime, { region, language });

        return finalize({
          items: withRuntime,
          source: "trakt_index",
          cacheStatus: "trakt_index_fast_peek",
          fromCache: false,
          debugSource: {
            source: "trakt_index",
            period: "daily",
            fallbackUsed: false,
            fastPeek: true,
            includeProviders,
            language,
            region,
          },
        });
      }
    }

    // 2) Sem índice quente: caminho de baixa latência por fallback local.
    //    SEMPRE marcado como `local_db`/`fallback_local` — o usuário não vê
    //    popularidade local apresentada como trending real. Refresh real em BG.
    const localCached = !options.skipCache
      ? await readContinuitySectionCache<TrendingCachePayload>(localSectionKey, { region, language })
      : null;

    if (localCached?.payload.results?.length && isCurrentPayload(localCached.payload)) {
      if (options.backgroundRefresh) {
        scheduleTrendingRefresh({ includeProviders, sectionKey, region, language });
      }
      return finalize({
        items: localCached.payload.results,
        source: "local_db",
        cacheStatus: "local_db_fast_cache",
        fromCache: false,
        debugSource: {
          source: "local_db",
          fallbackUsed: true,
          fallbackReason: "fast_home_local_cache",
          usedTmdbApi: false,
          normalizedFrom: "local_cache",
          identityUsed: "poplog_id",
          legacyCompatibilityUsed: true,
          includeProviders,
          language,
          region,
        },
      });
    }

    const localTitles = await withTimeout(
      fetchLocalTrending(language),
      TRENDING_DB_TIMEOUT_MS,
      [],
    );
    const localValid = filterValidTitles(localTitles);
    recordStage("local_fallback");

    if (localValid.length > 0) {
      const withRuntime = await enrichWithRuntime(localValid, { includeProviders, region, language });

      // Grava na chave do FALLBACK local (TTL curto), não na do trending real.
      void writeContinuitySectionCache({
        sectionKey: localSectionKey,
        region,
        language,
        ttlMs: TRENDING_LOCAL_CACHE_TTL_MS,
        payload: { results: withRuntime, generatedAt: new Date().toISOString(), payloadVersion: TRENDING_PAYLOAD_VERSION } satisfies TrendingCachePayload,
      });

      if (options.backgroundRefresh) {
        scheduleTrendingRefresh({ includeProviders, sectionKey, region, language });
      }
      logProtectedTrendingFeed("home-trending", withRuntime, { region, language });

      return finalize({
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
      });
    }

    if (options.backgroundRefresh) {
      scheduleTrendingRefresh({ includeProviders, sectionKey, region, language });
    }

    return finalize({
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
    });
  }

  // ── Trakt Index (fonte primária, projetado para o idioma pedido) ───────────
  if (isTraktIndexEnabled()) {
    try {
      const traktItems = await withTimeout(
        getPoplogDailyTrendingIndex({ language }),
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
          payload: { results: withRuntime, generatedAt: new Date().toISOString(), payloadVersion: TRENDING_PAYLOAD_VERSION } satisfies TrendingCachePayload,
        });
        logProtectedTrendingFeed("home-trending", withRuntime, { region, language });

        return finalize({
          items: withRuntime,
          source: "trakt_index",
          cacheStatus: "trakt_index_primary",
          fromCache: false,
          debugSource: { source: "trakt_index", period: "daily", fallbackUsed: false, includeProviders, language, region },
        });
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
      catalogGetTrending({
        mediaType: "movie",
        limit: TRENDING_TRAKT_LIMIT,
        language,
        region,
      }),
      catalogGetTrending({
        mediaType: "show",
        limit: TRENDING_TRAKT_LIMIT,
        language,
        region,
      }),
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
        payload: { results: withRuntime, generatedAt: new Date().toISOString(), payloadVersion: TRENDING_PAYLOAD_VERSION } satisfies TrendingCachePayload,
      });
      logProtectedTrendingFeed("home-trending", withRuntime, { region, language });

      return finalize({
        items: withRuntime,
        source: "trakt",
        cacheStatus: "trakt_primary",
        fromCache: false,
        debugSource: traktDebug,
      });
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
    fetchLocalTrending(language),
    TRENDING_DB_TIMEOUT_MS,
    [],
  );
  const localValid = filterValidTitles(localTitles);
  recordStage("local_fallback");

  if (localValid.length > 0) {
    const withRuntime = await enrichWithRuntime(localValid, { includeProviders, region, language });
    logProtectedTrendingFeed("home-trending", withRuntime, { region, language });

    // Aquece a chave do FALLBACK local (TTL curto) — separada do trending real.
    void writeContinuitySectionCache({
      sectionKey: localSectionKey,
      region,
      language,
      ttlMs: TRENDING_LOCAL_CACHE_TTL_MS,
      payload: { results: withRuntime, generatedAt: new Date().toISOString() } satisfies TrendingCachePayload,
    });

    return finalize({
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
    });
  }

  return finalize({
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
  });
}
