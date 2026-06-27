/**
 * availability-service.ts — camada GLOBAL de disponibilidade (Onde Assistir).
 *
 * Ponto único para consultar, cachear e normalizar disponibilidade de QUALQUER
 * título do site. Substitui a lógica antes acoplada à title page
 * (`getProvidersFromCache`) e à rota `/api/providers`.
 *
 * Pipeline de resolução (POPLOG-first):
 *   1. Cache persistente `catalog_availability` (por imdbId+região, fresco)
 *   2. JustWatch (live) — fonte protagonista de providers e canais
 *   3. Balloonerismm — fallback residual IMDb-first quando JustWatch falha/vem vazio
 *   4. Fallback local legado (TMDB/Watchmode/MOTN por tmdbId/imdbId)
 *   5. Status "nos cinemas"/futuro via /release_dates (apenas filmes sem streaming)
 *
 * Garantias:
 *   - Nunca lança — falha de um título nunca derruba a lista/grade.
 *   - Hidratação em lote com limite de concorrência + Promise.allSettled.
 *   - Salva também estado negativo ("sem providers encontrados") com TTL próprio.
 */

import type { ProviderType, CatalogAvailabilitySource, SourceConfidence } from "@prisma/client";
import type { TitleProvider, TitleProviderType } from "@/features/title/types";
import { db } from "@/server/db/client";
import { traktGet } from "@/server/api-clients/trakt/client";
import {
  listAvailability,
  replaceAvailability,
} from "@/server/local-services/catalog-availability-local.service";
import {
  detectReleaseStatus,
  getBalloonerismReleaseDates,
  releaseAgeDays,
  type ReleaseStatus,
} from "./release-status";
import {
  getBalloonerismWatchProvidersDetailed,
  type WatchProvidersOutcome,
} from "@/server/titles/balloonerismm-providers";
import {
  isSyntheticTmdbId,
  imdbIdFromSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";
import {
  countProviders,
  deriveStatus,
  groupProviders,
  pickBestProvider,
} from "./normalize-providers";
import {
  normalizeTitleProvider,
  rankTitleProviders,
} from "@/server/streaming/provider-normalization";
import {
  DEFAULT_STREAMING_REGION,
  normalizeStreamingRegion,
} from "@/server/streaming/region";
import { normalizeCatalogLanguage } from "@/server/source-engine/locale";
import { getUserProviderDisplayPreferences } from "@/server/streaming/user-provider-preferences";
import {
  getJustWatchUnofficialProviders,
  isJustWatchPrimaryEnabled,
  isJustWatchUnofficialEnabled,
  isJustWatchChannelEnrichmentEnabled,
} from "@/server/streaming/justwatch-graphql-unofficial-source";
import {
  hasChannelHostGeneric,
  mergeChannelOffers,
} from "@/server/streaming/provider-channel-enrichment";
import { ensureDiscoveredStreamingProviders } from "@/server/streaming/provider-catalog";
import {
  EMPTY_GROUPED_PROVIDERS,
  UNAVAILABLE_STATUS,
  type AvailabilityIdInput,
  type AvailabilitySource,
  type AvailabilityState,
  type TitleAvailabilitySummary,
} from "./availability-types";

const DEFAULT_REGION = DEFAULT_STREAMING_REGION;

function scheduleAvailabilityRefresh(input: {
  imdbId: string;
  mediaType: "movie" | "tv";
  region: string;
  language: string;
  priority?: number;
  reason: string;
}) {
  void import("@/server/workers/refresh-queue")
    .then(({ enqueueRefreshJob }) =>
      enqueueRefreshJob({
        kind: "availability",
        cacheKey: [
          "availability",
          input.mediaType,
          input.imdbId,
          input.region,
          input.language,
        ].join(":"),
        mediaType: input.mediaType,
        imdbId: input.imdbId,
        priority: input.priority ?? 60,
      }),
    )
    .then((job) => {
      console.log(
        `[availability] refreshQueued imdb=${input.imdbId} region=${input.region} language=${input.language} reason=${input.reason} job=${job.id.toString()}`,
      );
    })
    .catch((error) => {
      console.warn("[availability] refreshQueueSkipped", {
        imdbId: input.imdbId,
        region: input.region,
        language: input.language,
        reason: input.reason,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

// Sentinela de estado negativo persistido (sem providers encontrados).
const NONE_PROVIDER_NAME = "__none__";

// TTLs (dias): POPLOG lê banco primeiro e renova JustWatch gradualmente.
const TTL_PROVIDERS_DEFAULT = 1;       // 24h
const TTL_NONE_FOUND = 0.5;            // 12h
const TTL_CRITICAL = 0.25;             // 6h
const TTL_RECENT = 0.25;               // lançamentos/quentes: 6h
const TTL_STABLE_OLD = 7;              // catálogo frio: até 7d
const TTL_JUSTWATCH = 1;               // fonte protagonista: 24h fresco
const TTL_BALLOON_FALLBACK = 0.5;      // fallback residual: 6-12h
const STALE_WINDOW_DAYS = 3;           // retorno stale imediato + refresh background
const STABLE_AGE_DAYS = 180;
const THEATRICAL_GATE_DAYS = 120;

// ─── Mapeamento de tipos provider ↔ enum Prisma ──────────────────────────────

function titleTypeToProviderType(type: TitleProviderType): ProviderType {
  if (type === "streaming") return "subscription";
  if (type === "rent" || type === "buy" || type === "free" || type === "ads") return type;
  return "unknown";
}

function providerTypeToTitleType(type: ProviderType): TitleProviderType {
  if (type === "subscription") return "streaming";
  if (type === "rent" || type === "buy" || type === "free" || type === "ads") return type;
  return "streaming";
}

// ─── Cache persistente ────────────────────────────────────────────────────────

type CachedRead = {
  providers: TitleProvider[];
  /** Houve cache fresco (mesmo que negativo) — evita nova chamada externa. */
  hit: boolean;
  /** Cache expirado, mas ainda aceitável para retorno imediato enquanto renova. */
  stale: boolean;
  /** O cache fresco estava marcado como "sem providers". */
  negative: boolean;
  /**
   * A sentinela negativa é REVALIDÁVEL (não definitiva): foi gravada SEM a checagem
   * completa do pipeline atual (legado/anterior ao fallback JustWatch). Sinalizada pela
   * confiança != "low". Negativos "low" foram checados incluindo o fallback e são
   * considerados confiáveis até o TTL. Revalidáveis devem disparar revalidação live.
   */
  negativeRevalidable: boolean;
  /** Expiração da linha mais próxima (debug). */
  expiresAt: string | null;
  /** Fonte predominante das linhas frescas. */
  source: CatalogAvailabilitySource | null;
};

async function readProvidersFromCache(
  imdbId: string,
  mediaType: "movie" | "tv",
  region: string,
  language: string,
): Promise<CachedRead> {
  try {
    const rows = await listAvailability({
      imdbId,
      mediaType,
      providerRegion: region,
      providerLanguage: language,
      includeExpired: true,
    });
    if (rows.length === 0)
      return { providers: [], hit: false, stale: false, negative: false, negativeRevalidable: false, expiresAt: null, source: null };

    const now = Date.now();
    const freshRows = rows.filter((row) => new Date(row.expires_at).getTime() > now);
    const staleRows = rows.filter((row) =>
      new Date(row.expires_at).getTime() <= now &&
      row.stale_until &&
      new Date(row.stale_until).getTime() > now,
    );
    const usableRows = freshRows.length > 0 ? freshRows : staleRows;
    if (usableRows.length === 0) {
      return { providers: [], hit: false, stale: false, negative: false, negativeRevalidable: false, expiresAt: null, source: null };
    }
    const stale = freshRows.length === 0;

    const expiresAt =
      usableRows
        .map((r) => r.expires_at)
        .filter((v): v is string => Boolean(v))
        .sort()[0] ?? null;

    // Sentinela negativa. "low" = checado incluindo o fallback JustWatch (confiável até TTL);
    // qualquer outra confiança = legado/incompleto → REVALIDÁVEL.
    if (usableRows.length === 1 && usableRows[0].provider_name === NONE_PROVIDER_NAME) {
      const negativeRevalidable = usableRows[0].source_confidence !== "low";
      return { providers: [], hit: true, stale, negative: true, negativeRevalidable, expiresAt, source: usableRows[0].source };
    }

    const providers: TitleProvider[] = usableRows
      .filter((r) => r.provider_name !== NONE_PROVIDER_NAME)
      .map((r) => ({
        name: r.provider_name,
        logoUrl: r.provider_logo_url ?? null,
        type: providerTypeToTitleType(r.provider_type),
        deepLink: r.provider_url ?? null,
        source: r.source,
        country: r.provider_region,
      }));

    return {
      providers,
      hit: providers.length > 0,
      stale,
      negative: false,
      negativeRevalidable: false,
      expiresAt,
      source: usableRows.find((r) => r.provider_name !== NONE_PROVIDER_NAME)?.source ?? null,
    };
  } catch {
    return { providers: [], hit: false, stale: false, negative: false, negativeRevalidable: false, expiresAt: null, source: null };
  }
}

function computeTtlDays(input: {
  hasProviders: boolean;
  isInTheaters: boolean;
  isFutureRelease: boolean;
  releaseAge: number | null;
  expectedVodDate?: string | null;
  releaseDate?: string | null;
}): number {
  const criticalOffsets = [input.releaseDate, input.expectedVodDate]
    .filter((date): date is string => Boolean(date))
    .map((date) => (new Date(date).getTime() - Date.now()) / 86_400_000)
    .filter(Number.isFinite);
  const nextCritical = criticalOffsets
    .filter((days) => days > 0 && days <= TTL_RECENT)
    .sort((a, b) => a - b)[0];
  // Expira exatamente na data crítica quando ela cair antes das 48h normais.
  if (nextCritical !== undefined) return Math.max(1 / 24, nextCritical);
  if (criticalOffsets.some((days) => days <= 0 && days >= -1)) return TTL_CRITICAL;
  if (!input.hasProviders) {
    if (input.releaseAge !== null && input.releaseAge > THEATRICAL_GATE_DAYS) return TTL_STABLE_OLD;
    return TTL_NONE_FOUND;
  }
  if (input.isInTheaters || input.isFutureRelease) return TTL_RECENT;
  if (input.releaseAge !== null && input.releaseAge > STABLE_AGE_DAYS) return TTL_STABLE_OLD;
  return TTL_PROVIDERS_DEFAULT;
}

function compactProviderRawPayload(provider: TitleProvider) {
  return {
    source: provider.source ?? null,
    providerId: provider.providerId ?? provider.tmdbProviderId ?? null,
    name: provider.name,
    originalName: provider.originalName ?? provider.providerName ?? provider.name,
    type: provider.type,
    normalizedType: provider.normalizedType ?? null,
    accessKind: provider.accessKind ?? null,
    rootKey: provider.rootKey ?? null,
    rootName: provider.rootName ?? null,
    familyKey: provider.familyKey ?? null,
    familyName: provider.familyName ?? null,
    variantKey: provider.variantKey ?? null,
    variantName: provider.variantName ?? null,
    isOfficial: provider.isOfficial ?? null,
    deepLink: provider.deepLink ?? provider.deeplink ?? null,
    logoUrl: provider.logoUrl ?? provider.logoPath ?? null,
  };
}

async function writeProvidersToCache(input: {
  imdbId: string;
  /** tmdbId (real ou sintético) do título, quando conhecido — persistido na linha
   *  para que leitores keyed-by-tmdbId encontrem a disponibilidade global. */
  tmdbId?: number | null;
  mediaType: "movie" | "tv";
  region: string;
  language: string;
  providers: TitleProvider[];
  ttlDays: number;
  /** Origem dos providers positivos (default balloonerismm). A sentinela negativa
   *  permanece sempre balloonerismm — representa "primária checada, nada encontrado". */
  source?: CatalogAvailabilitySource;
  sourceConfidence?: SourceConfidence;
}): Promise<void> {
  const { imdbId, tmdbId, mediaType, region, providers, ttlDays } = input;
  const language = normalizeCatalogLanguage(input.language);
  const source: CatalogAvailabilitySource = input.source ?? "balloonerismm";
  const sourceConfidence: SourceConfidence = input.sourceConfidence ?? "high";
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000);
  const staleUntil = new Date(expiresAt.getTime() + STALE_WINDOW_DAYS * 86_400_000);
  const tmdbIdForRow = tmdbId ?? null;

  const rows =
    providers.length > 0
      ? providers.map((p) => {
          const rowSource: CatalogAvailabilitySource =
            p.source === "justwatch_graphql_unofficial" ? "justwatch" : source;
          return {
            imdbId,
            tmdbId: tmdbIdForRow,
            mediaType,
            // Rastreabilidade: o cache persiste o nome da fonte, nunca o rótulo da UI.
            providerName: p.originalName ?? p.name,
            providerRegion: region,
            providerLanguage: language,
            providerType: titleTypeToProviderType(p.type),
            providerUrl: p.deepLink ?? p.deeplink ?? null,
            providerLogoUrl: p.logoUrl ?? null,
            source: rowSource,
            sourceConfidence,
            checkedAt: now,
            expiresAt,
            staleUntil,
            rawPayloadJson: compactProviderRawPayload(p),
          };
        })
      : [
          // Sentinela negativa: registra "checado, nada encontrado".
          // Confiança "low" = checagem completa (incl. JustWatch) → confiável até o TTL;
          // "unverified" = checagem incompleta/legada → permanece REVALIDÁVEL.
          {
            imdbId,
            tmdbId: tmdbIdForRow,
            mediaType,
            providerName: NONE_PROVIDER_NAME,
            providerRegion: region,
            providerLanguage: language,
            providerType: "unknown" as const,
            source: "balloonerismm" as const,
            sourceConfidence,
            checkedAt: now,
            expiresAt,
            staleUntil,
          },
        ];

  await replaceAvailability({
    imdbId,
    mediaType,
    providerRegion: region,
    providerLanguage: language,
    rows,
  }).catch(() => false);
}

// ─── Fallback local legado ────────────────────────────────────────────────────

async function readLegacyLocalProviders(
  input: AvailabilityIdInput,
  region: string,
): Promise<TitleProvider[]> {
  const { mediaType, tmdbId, imdbId } = input;
  try {
    if (tmdbId) {
      const { getAvailability } = await import("@/server/cache/availability-cache");
      const rows = await getAvailability(mediaType, tmdbId, region).catch(() => []);
      // CRÍTICO: filtra a sentinela __none__ do cache legado. Sem isso, um negativo
      // legado virava um "provider" chamado __none__ → falso "available" e, pior,
      // retornava cedo (source:"local") ANTES do fallback JustWatch rodar.
      const real = rows.filter((row) => row.provider_name !== NONE_PROVIDER_NAME);
      if (real.length > 0) {
        return real.map((row) => ({
          name: row.provider_name,
          logoUrl: null,
          type: (row.availability_type === "streaming"
            ? "streaming"
            : row.availability_type) as TitleProviderType,
          source: row.source,
          country: row.country,
          deepLink: row.deep_link,
          quality: row.quality,
        }));
      }
    }
    if (imdbId) {
      const rows = await listAvailability({ imdbId, mediaType, providerRegion: region });
      return rows
        .filter((r) => r.provider_name !== NONE_PROVIDER_NAME)
        .map((row) => ({
          name: row.provider_name,
          logoUrl: row.provider_logo_url ?? null,
          type: providerTypeToTitleType(row.provider_type),
          source: row.source,
          country: row.provider_region,
        }));
    }
  } catch {
    /* ignora — retorna vazio */
  }
  return [];
}

// ─── API pública ──────────────────────────────────────────────────────────────

function buildSummary(input: {
  region: string;
  providers: TitleProvider[];
  source: AvailabilitySource;
  state: AvailabilityState;
  isInTheaters?: boolean;
  isFutureRelease?: boolean;
  release?: ReleaseStatus;
  providerPreferences?: AvailabilityIdInput["providerPreferences"];
}): TitleAvailabilitySummary {
  const rankedProviders = rankTitleProviders(input.providers, input.providerPreferences ?? []);
  const grouped = groupProviders(rankedProviders);
  const status = deriveStatus({
    grouped,
    isInTheaters: input.isInTheaters,
    isFutureRelease: input.isFutureRelease,
  });
  return {
    region: input.region,
    providers: grouped,
    status,
    state: input.state,
    bestProvider: pickBestProvider(grouped, Boolean(input.providerPreferences?.length)),
    source: input.source,
    checkedAt: new Date().toISOString(),
    release: {
      kind: input.release?.releaseKind ?? "unknown",
      theatricalDate: input.release?.theatricalDate ?? null,
      expectedVodDate: input.release?.expectedVodDate ?? null,
      earliestRelevantDate: input.release?.earliestRelevantDate ?? null,
      theatricalWindowEndsAt: input.release?.theatricalWindowEndsAt ?? null,
    },
  };
}

export function emptyAvailabilitySummary(region = DEFAULT_REGION): TitleAvailabilitySummary {
  return {
    region,
    providers: { ...EMPTY_GROUPED_PROVIDERS },
    status: { ...UNAVAILABLE_STATUS },
    state: "unresolved",
    bestProvider: null,
    source: "none",
    checkedAt: new Date().toISOString(),
    release: {
      kind: "unknown",
      theatricalDate: null,
      expectedVodDate: null,
      earliestRelevantDate: null,
      theatricalWindowEndsAt: null,
    },
  };
}

/** Como o IMDb ID foi resolvido (debug). */
type ImdbResolutionSource =
  | "input"
  | "synthetic_tmdb"
  | "external_ids"
  | "trakt_search"
  | "none";

type ResolvedImdb = { imdbId: string | null; via: ImdbResolutionSource };

/**
 * Resolve tmdbId real → imdbId via Trakt /search/tmdb/{id} e persiste no external-ids
 * cache (one-time). Reaproveita o mesmo mecanismo já usado em fetchAndCacheTitleByTmdbId.
 * Nunca lança — retorna null em qualquer falha.
 */
async function resolveImdbViaTrakt(
  mediaType: "movie" | "tv",
  tmdbId: number,
): Promise<string | null> {
  try {
    const { traktGet, isTraktActive } = await import("@/server/api-clients/trakt/client");
    if (!isTraktActive()) return null;

    const traktType = mediaType === "movie" ? "movie" : "show";
    const results = await traktGet<Array<{
      type?: string;
      movie?: { ids?: { imdb?: string; trakt?: number; slug?: string; tvdb?: number } };
      show?: { ids?: { imdb?: string; trakt?: number; slug?: string; tvdb?: number } };
    }>>(`/search/tmdb/${tmdbId}`, {
      params: { type: traktType, extended: "min" },
      ttlSeconds: 7 * 86400,
    }).catch(() => null);

    const hit = results?.find((r) => r.type === traktType || r[traktType as "movie" | "show"]);
    const ids = (mediaType === "movie" ? hit?.movie : hit?.show)?.ids;
    const imdbId = ids?.imdb ?? null;
    if (!imdbId) return null;

    // Persiste para que próximas cargas resolvam via external-ids (barato).
    try {
      const { upsertExternalIds } = await import("@/server/cache/external-ids-cache");
      await upsertExternalIds({
        tmdbId,
        mediaType,
        imdbId,
        tvdbId: ids?.tvdb != null ? String(ids.tvdb) : null,
        traktId: ids?.trakt != null ? String(ids.trakt) : null,
      });
    } catch {
      /* cache best-effort — segue com o imdbId resolvido */
    }

    return imdbId;
  } catch {
    return null;
  }
}

/**
 * Resolução PADRONIZADA de IMDb ID — único ponto da camada.
 * O endpoint Balloonerismm /watch/providers é IMDb-first (exige tt-id), então todo
 * caminho converge para um imdbId:
 *   1. input.imdbId (já fornecido)
 *   2. tmdbId sintético negativo → deriva imdbId
 *   3. tmdbId real positivo → external-ids cache local
 *   4. tmdbId real positivo sem cache → Trakt /search/tmdb/{id} (e persiste)
 */
async function resolveImdbId(input: AvailabilityIdInput): Promise<ResolvedImdb> {
  if (input.imdbId) return { imdbId: input.imdbId, via: "input" };

  const tmdbId = input.tmdbId ?? null;
  if (tmdbId === null) return { imdbId: null, via: "none" };

  if (isSyntheticTmdbId(tmdbId)) {
    const derived = imdbIdFromSyntheticTmdbId(tmdbId);
    return derived ? { imdbId: derived, via: "synthetic_tmdb" } : { imdbId: null, via: "none" };
  }

  if (tmdbId > 0) {
    try {
      const { getExternalIds } = await import("@/server/cache/external-ids-cache");
      const ext = await getExternalIds(input.mediaType, tmdbId).catch(() => null);
      if (ext?.imdb_id) return { imdbId: ext.imdb_id, via: "external_ids" };
    } catch {
      /* ignora — tenta Trakt abaixo */
    }

    // Fallback controlado: resolve via Trakt e cacheia em external-ids.
    const viaTrakt = await resolveImdbViaTrakt(input.mediaType, tmdbId);
    if (viaTrakt) return { imdbId: viaTrakt, via: "trakt_search" };
  }

  return { imdbId: null, via: "none" };
}

/** Ano a partir das datas conhecidas no input (para refinar o match do JustWatch). */
function yearFromInput(input: AvailabilityIdInput): number | null {
  const d = input.releaseDate ?? input.firstAirDate;
  if (!d) return null;
  const y = new Date(d).getFullYear();
  return Number.isFinite(y) ? y : null;
}

/**
 * Resolve um título (e ano) para alimentar a busca do fallback JustWatch — que é
 * search-based. Prefere o título já fornecido pelo caller; senão, busca barato no
 * cache canônico de títulos (poplog3Title) pelo tmdbId. Nunca lança.
 */
async function resolveTitleForJustWatch(
  input: AvailabilityIdInput,
  mediaType: "movie" | "tv",
): Promise<{ title: string | null; year: number | null }> {
  const fromInput = input.title?.trim();
  if (fromInput) return { title: fromInput, year: input.year ?? yearFromInput(input) };
  const language = normalizeCatalogLanguage(input.language);
  const region = normalizeStreamingRegion(input.region, {
    source: "availability:justwatch-title-region",
    explicit: input.region != null,
  });

  if (input.imdbId) {
    try {
      const translation = await db.titleTranslation.findFirst({
        where: {
          imdbId: input.imdbId,
          language,
          OR: [{ region }, { region: "US" }, { region: "BR" }],
        },
        orderBy: [{ region: "asc" }, { updatedAt: "desc" }],
        select: { title: true },
      });
      if (translation?.title) {
        return { title: translation.title, year: input.year ?? yearFromInput(input) };
      }
    } catch {
      /* best-effort */
    }

    try {
      const localTitle = await db.poplog3Title.findFirst({
        where: { imdbId: input.imdbId, mediaType },
        select: { title: true, originalTitle: true, year: true, tmdbId: true },
      });
      const title = localTitle?.title ?? localTitle?.originalTitle ?? null;
      if (title) {
        return { title, year: input.year ?? yearFromInput(input) ?? localTitle?.year ?? null };
      }
    } catch {
      /* best-effort */
    }

    try {
      const external = await db.titleExternalId.findFirst({
        where: { imdbId: input.imdbId, mediaType },
        select: { tmdbId: true },
      });
      if (external?.tmdbId) {
        const localByExternal = await db.poplog3Title.findUnique({
          where: { tmdbId_mediaType: { tmdbId: external.tmdbId, mediaType } },
          select: { title: true, originalTitle: true, year: true },
        });
        const title = localByExternal?.title ?? localByExternal?.originalTitle ?? null;
        if (title) {
          return { title, year: input.year ?? yearFromInput(input) ?? localByExternal?.year ?? null };
        }
      }
    } catch {
      /* best-effort */
    }

    try {
      type TraktSearchHit = {
        movie?: { title?: string | null; year?: number | null; ids?: { tmdb?: number | null } };
        show?: { title?: string | null; year?: number | null; ids?: { tmdb?: number | null } };
      };
      const type = mediaType === "movie" ? "movie" : "show";
      const hits = await traktGet<TraktSearchHit[]>(`/search/imdb/${input.imdbId}`, {
        params: { type, extended: "full" },
        ttlSeconds: 7 * 86_400,
        staleTtlSeconds: 30 * 86_400,
      }).catch(() => null);
      const hit = hits?.[0]?.movie ?? hits?.[0]?.show ?? null;
      const title = hit?.title?.trim() || null;
      if (title) {
        return { title, year: input.year ?? yearFromInput(input) ?? hit?.year ?? null };
      }
    } catch {
      /* best-effort */
    }
  }

  if (input.tmdbId != null) {
    try {
      const { getCachedTitleRow } = await import("@/server/repositories");
      const row = await getCachedTitleRow(mediaType, input.tmdbId);
      const title = row?.title ?? row?.originalTitle ?? null;
      if (title) return { title, year: input.year ?? yearFromInput(input) ?? row?.year ?? null };
    } catch {
      /* best-effort — sem título o fallback simplesmente não roda */
    }
  }

  return { title: null, year: input.year ?? yearFromInput(input) };
}

/** Trace do fallback experimental JustWatch (exposto no ?debug=1). */
type JustWatchDebug = {
  enabled: boolean;
  attempted: boolean;
  outcome: string | null;
  queryTitle: string | null;
  queryYear: number | null;
  queryMediaType: "movie" | "tv";
  matchedTitle: string | null;
  matchedImdbId: string | null;
  matchedTmdbId: number | null;
  matchReason: string | null;
  offersCount: number | null;
  providersParsed: number | null;
  emptyReason: string | null;
  /** Enriquecimento de canais (roda quando o Balloonerismm já trouxe providers). */
  enrichmentEnabled: boolean;
  enrichmentAttempted: boolean;
  /** Identidades genéricas de host substituídas por canais reais. */
  enrichmentReplaced: string[];
  /** Identidades de canal adicionadas a partir do JustWatch. */
  enrichmentAdded: string[];
};

type ResolvedProviders = {
  providers: TitleProvider[];
  source: AvailabilitySource;
  /** Trace do fallback JustWatch (sempre presente; attempted=false quando não rodou). */
  justwatch: JustWatchDebug;
  /** Veio do Balloonerismm ao vivo (e deve ser persistido pelo caller). NUNCA true em erro. */
  live: boolean;
  /** IMDb ID efetivamente usado para consultar (ou null se não resolveu). */
  resolvedImdbId: string | null;
  imdbVia: ImdbResolutionSource;
  /** Outcome do fetch ao vivo, quando houve. */
  balloonOutcome: WatchProvidersOutcome | null;
  /** Trace do cache para debug. */
  cache: {
    hit: boolean;
    stale: boolean;
    negative: boolean;
    expiresAt: string | null;
    source: CatalogAvailabilitySource | null;
  };
  /**
   * Um negativo REVALIDÁVEL foi encontrado em cacheOnly e devolvido como soft-"unresolved"
   * (em vez de "unavailable") para que o warmCold o reprocesse ao vivo em background.
   */
  negativeRevalidationPending: boolean;
  staleRefreshPending: boolean;
  /** Path chamado (debug). */
  providerPath: string | null;
  errors: string[];
};

/**
 * Resolve a lista plana de providers (cache → Balloon → local). NÃO persiste —
 * quem persiste é getTitleAvailability, com o TTL temporal correto.
 *
 * Distingue vazio-genuíno (outcome "empty" → cacheável) de erro (outcome "error" →
 * `live:false`, jamais cacheia negativo). Resolve o IMDb ID de forma padronizada antes.
 */
async function resolveProviders(input: AvailabilityIdInput): Promise<ResolvedProviders> {
  const region = normalizeStreamingRegion(input.region, {
    source: "availability-core",
    explicit: input.region != null,
  });
  const { mediaType } = input;
  const errors: string[] = [];

  const { imdbId, via: imdbVia } = await resolveImdbId(input);

  // Trace do fallback JustWatch — objeto único mutável compartilhado por todos os
  // returns via `base`; o bloco de fallback abaixo o preenche quando roda.
  const justwatch: JustWatchDebug = {
    enabled: isJustWatchPrimaryEnabled() || isJustWatchUnofficialEnabled(),
    attempted: false,
    outcome: null,
    queryTitle: null,
    queryYear: null,
    queryMediaType: mediaType,
    matchedTitle: null,
    matchedImdbId: null,
    matchedTmdbId: null,
    matchReason: null,
    offersCount: null,
    providersParsed: null,
    emptyReason: null,
    enrichmentEnabled: isJustWatchChannelEnrichmentEnabled(),
    enrichmentAttempted: false,
    enrichmentReplaced: [],
    enrichmentAdded: [],
  };

  const base = {
    resolvedImdbId: imdbId,
    imdbVia,
    justwatch,
    cache: {
      hit: false,
      stale: false,
      negative: false,
      expiresAt: null as string | null,
      source: null as CatalogAvailabilitySource | null,
    },
    negativeRevalidationPending: false,
    staleRefreshPending: false,
    providerPath: null as string | null,
    errors,
  };

  // 1. Cache persistente (fresco) por imdbId.
  //  - Positivo fresco → retorna direto.
  //  - Negativo REVALIDÁVEL (legado/incompleto, confiança != "low"): NUNCA é definitivo.
  //      • live  → cai para o fetch ao vivo (Balloonerismm + fallback) e revalida agora.
  //      • cacheOnly → devolve como soft-"unresolved" (negative:false) p/ o warmCold
  //        reprocessar em background. Assim sentinelas __none__ históricas deixam de
  //        prender títulos disponíveis nas listas.
  //  - Negativo CONFIÁVEL ("low", já checado incl. JustWatch): definitivo até o TTL,
  //    salvo bypassNegativeCache (force_live).
  const language = normalizeCatalogLanguage(input.language);

  if (imdbId && !input.bypassProviderCache) {
    const cached = await readProvidersFromCache(imdbId, mediaType, region, language);
    if (cached.hit) {
      if (!cached.negative) {
        const shouldRevalidateWithJustWatch =
          !input.cacheOnly &&
          isJustWatchPrimaryEnabled() &&
          cached.source !== "justwatch";

        if (cached.stale) {
          console.log(
            `[availability] staleCacheHit imdb=${imdbId} region=${region} language=${language} source=${cached.source ?? "unknown"}`,
          );
          scheduleAvailabilityRefresh({
            imdbId,
            mediaType,
            region,
            language,
            priority: cached.source === "justwatch" ? 30 : 45,
            reason: "stale-cache-hit",
          });
          return {
            ...base,
            cache: { hit: true, stale: true, negative: false, expiresAt: cached.expiresAt, source: cached.source },
            staleRefreshPending: true,
            providers: cached.providers,
            source: "cache",
            live: false,
            balloonOutcome: null,
          };
        }

        if (shouldRevalidateWithJustWatch) {
          console.log(
            `[availability] revalidatingProviderCacheWithJustWatch imdb=${imdbId} region=${region} cachedSource=${cached.source ?? "unknown"}`,
          );
        } else {
        if (
          region === "BR" &&
          !input.cacheOnly &&
          isJustWatchChannelEnrichmentEnabled() &&
          hasChannelHostGeneric(cached.providers)
        ) {
          const { title: searchTitle, year } = await resolveTitleForJustWatch(input, mediaType);
          justwatch.queryTitle = searchTitle;
          justwatch.queryYear = year;
          if (searchTitle || imdbId || input.tmdbId != null) {
            justwatch.enrichmentAttempted = true;
            const jw = await getJustWatchUnofficialProviders({
              title: searchTitle,
              year,
              imdbId,
              tmdbId: input.tmdbId ?? null,
              mediaType,
              region,
            }).catch(() => null);
            if (jw) {
              justwatch.outcome = jw.outcome;
              justwatch.offersCount = jw.offersCount;
              justwatch.providersParsed = jw.providers.length;
              justwatch.emptyReason = jw.emptyReason;
              if (jw.matched) {
                justwatch.matchedTitle = jw.matched.title;
                justwatch.matchedImdbId = jw.matched.imdbId;
                justwatch.matchedTmdbId = jw.matched.tmdbId;
                justwatch.matchReason = jw.matched.matchedVia;
              }
              if (jw.outcome === "ok" && jw.providers.length > 0) {
                const merged = mergeChannelOffers(cached.providers, jw.providers);
                if (merged.changed) {
                  justwatch.enrichmentReplaced = merged.replaced;
                  justwatch.enrichmentAdded = merged.added;
                  console.log(
                    `[availability] channelCacheEnrichment imdb=${imdbId} region=${region} replaced=${merged.replaced.length} added=${merged.added.length}`,
                  );
                  return {
                    ...base,
                    cache: { hit: true, stale: false, negative: false, expiresAt: cached.expiresAt, source: cached.source },
                    providerPath: "cache+justwatch:channel-enrichment",
                    providers: merged.providers,
                    source: "balloonerismm",
                    live: true,
                    balloonOutcome: null,
                  };
                }
              }
            }
          } else {
            justwatch.emptyReason = "missing_title_and_ids";
          }
        }

        return {
          ...base,
          cache: { hit: true, stale: false, negative: false, expiresAt: cached.expiresAt, source: cached.source },
          providers: cached.providers,
          source: "cache",
          live: false,
          balloonOutcome: null,
        };
        }
      }

      // Negativo encontrado.
      console.log(
        `[availability] negativeCacheHit imdb=${imdbId} region=${region} revalidable=${cached.negativeRevalidable} expiresAt=${cached.expiresAt}`,
      );

      const forceLive = Boolean(input.bypassNegativeCache);
      const shouldShortCircuit = !cached.negativeRevalidable && !forceLive;
      if (shouldShortCircuit) {
        // Negativo confiável → definitivo até o TTL.
        return {
          ...base,
          cache: { hit: true, stale: cached.stale, negative: true, expiresAt: cached.expiresAt, source: cached.source },
          providers: [],
          source: "none",
          live: false,
          balloonOutcome: null,
        };
      }

      if (cached.negativeRevalidable && input.cacheOnly) {
        // Não dá pra ir ao vivo agora: devolve soft-"unresolved" p/ o warmCold reprocessar.
        console.log(
          `[availability] negativeCacheRevalidationScheduled imdb=${imdbId} region=${region}`,
        );
        scheduleAvailabilityRefresh({
          imdbId,
          mediaType,
          region,
          language,
          priority: 35,
          reason: "negative-cache-revalidation",
        });
        return {
          ...base,
          cache: { hit: true, stale: false, negative: false, expiresAt: cached.expiresAt, source: cached.source },
          negativeRevalidationPending: true,
          providers: [],
          source: "none",
          live: false,
          balloonOutcome: null,
        };
      }

      // Revalidável em modo live (ou force_live): cai para o fetch ao vivo abaixo.
      if (cached.negativeRevalidable) {
        console.log(`[availability] negativeCacheRevalidating(live) imdb=${imdbId} region=${region}`);
      }
    }
  }

  // 2. JustWatch ao vivo (fonte protagonista) — PULADO em modo cacheOnly.
  if (imdbId && !input.cacheOnly && isJustWatchPrimaryEnabled()) {
    const { title: searchTitle, year } = await resolveTitleForJustWatch(input, mediaType);
    justwatch.queryTitle = searchTitle;
    justwatch.queryYear = year;

    if (searchTitle || imdbId || input.tmdbId != null) {
      justwatch.attempted = true;
      const jw = await getJustWatchUnofficialProviders({
        title: searchTitle,
        year,
        imdbId,
        tmdbId: input.tmdbId ?? null,
        mediaType,
        region,
        language: input.language ?? undefined,
      }).catch(() => null);

      if (jw) {
        justwatch.outcome = jw.outcome;
        justwatch.offersCount = jw.offersCount;
        justwatch.providersParsed = jw.providers.length;
        justwatch.emptyReason = jw.emptyReason;
        if (jw.matched) {
          justwatch.matchedTitle = jw.matched.title;
          justwatch.matchedImdbId = jw.matched.imdbId;
          justwatch.matchedTmdbId = jw.matched.tmdbId;
          justwatch.matchReason = jw.matched.matchedVia;
        }

        if (jw.outcome === "ok" && jw.providers.length > 0) {
          return {
            ...base,
            providerPath: "justwatch:graphql/GetSearchTitles",
            providers: jw.providers,
            source: "justwatch_graphql_unofficial",
            live: true,
            balloonOutcome: null,
          };
        }

        errors.push(`justwatch_primary_outcome:${jw.outcome}`);
      } else {
        justwatch.outcome = "error";
        justwatch.emptyReason = "throw";
        errors.push("justwatch_primary_throw");
      }
    } else {
      justwatch.emptyReason = "missing_title_and_ids";
      errors.push("justwatch_primary_missing_title_and_ids");
    }
  }

  // 3. Balloonerismm ao vivo (fallback residual) — PULADO em modo cacheOnly.
  // Em listas (Home/Watchlist/Biblioteca) não disparamos fetch ao vivo: a tempestade
  // de chamadas sob carga, combinada à cobertura BR inconsistente da fonte, gravava
  // negativos falsos. Nesses contextos, cache-miss → "unresolved" (desconhecido).
  if (imdbId && !input.cacheOnly) {
    const detailed = await getBalloonerismWatchProvidersDetailed(imdbId, mediaType, region).catch(
      (err): { outcome: WatchProvidersOutcome; providers: TitleProvider[]; path: string } => {
        errors.push(`balloon_throw:${err instanceof Error ? err.message : String(err)}`);
        return { outcome: "error", providers: [], path: "" };
      },
    );
    if (detailed.outcome === "error") errors.push("balloon_outcome_error");

    // Vazio genuíno do Balloonerismm (cobertura BR incompleta): antes de concluir
    // "sem providers", consulta o fallback local legado. Recupera títulos cujo dado
    // existe localmente mesmo quando o JustWatch/Balloonerismm BR não os lista.
    if (detailed.outcome === "empty") {
      const local = await readLegacyLocalProviders(input, region);
      if (local.length > 0) {
        return {
          ...base,
          providerPath: detailed.path || `/${mediaType}/${imdbId}/watch/providers`,
          providers: local,
          source: "local",
          live: false, // local não deve sobrescrever/poluir o cache do Balloonerismm
          balloonOutcome: detailed.outcome,
        };
      }
    }

    // Fallback EXPERIMENTAL controlado: JustWatch GraphQL não oficial. Só entra quando
    // o Balloonerismm (fonte PRIMÁRIA) falhou ou veio vazio para BR e o fallback local
    // legado também não tinha nada. Env-gated (JUSTWATCH_UNOFFICIAL_FALLBACK), baixo
    // volume (só no caminho ao vivo, nunca em massa em listas/cards), cache forte na
    // própria source. Quando retorna providers, é persistido em catalog_availability com
    // source "justwatch" (tag distinta) e TTL curto — assim os cards (cacheOnly) também
    // exibem o badge. O front continua lendo só via getTitleAvailability/hydrateMany…,
    // e o Balloonerismm permanece a fonte primária (JustWatch nunca é tentado antes).
    if (
      region === "BR" &&
      (detailed.outcome === "error" || detailed.outcome === "empty") &&
      !isJustWatchPrimaryEnabled() &&
      isJustWatchUnofficialEnabled()
    ) {
      const { title: searchTitle, year } = await resolveTitleForJustWatch(input, mediaType);
      justwatch.queryTitle = searchTitle;
      justwatch.queryYear = year;
      if (searchTitle || imdbId || input.tmdbId != null) {
        justwatch.attempted = true;
        const jw = await getJustWatchUnofficialProviders({
          title: searchTitle,
          year,
          imdbId,
          tmdbId: input.tmdbId ?? null,
          mediaType,
          region,
        }).catch(() => null);
        if (jw) {
          justwatch.outcome = jw.outcome;
          justwatch.offersCount = jw.offersCount;
          justwatch.providersParsed = jw.providers.length;
          justwatch.emptyReason = jw.emptyReason;
          if (jw.matched) {
            justwatch.matchedTitle = jw.matched.title;
            justwatch.matchedImdbId = jw.matched.imdbId;
            justwatch.matchedTmdbId = jw.matched.tmdbId;
            justwatch.matchReason = jw.matched.matchedVia;
          }
          if (jw.outcome === "ok" && jw.providers.length > 0) {
            return {
              ...base,
              providerPath: "justwatch:graphql/GetSearchTitles",
              providers: jw.providers,
              source: "justwatch_graphql_unofficial",
              // Persistível: gravado em catalog_availability com source "justwatch" e TTL
              // curto, para que os cards (cacheOnly) também exibam o badge do fallback.
              live: true,
              balloonOutcome: detailed.outcome,
            };
          }
          errors.push(`justwatch_outcome:${jw.outcome}`);
        } else {
          justwatch.outcome = "error";
          justwatch.emptyReason = "throw";
        }
      } else {
        justwatch.emptyReason = "missing_title_and_ids";
      }
    }

    // Enriquecimento de CANAIS: o Balloonerismm trouxe providers, mas pode tê-los
    // entregue de forma genérica (ex.: "Prime Video" quando o título está, na verdade,
    // só dentro do canal "Diamond Films"). Quando há um host de canais genérico no
    // resultado, consultamos o JustWatch (granularidade de canal) e mesclamos. Só roda
    // no caminho ao vivo (este branch já exige !cacheOnly), region BR, e env-gated. A
    // própria source JustWatch tem cache forte (6h), então o volume é baixo.
    let liveProviders = detailed.providers;
    if (
      region === "BR" &&
      detailed.outcome === "ok" &&
      detailed.providers.length > 0 &&
      isJustWatchChannelEnrichmentEnabled() &&
      hasChannelHostGeneric(detailed.providers)
    ) {
      const { title: searchTitle, year } = await resolveTitleForJustWatch(input, mediaType);
      justwatch.queryTitle = searchTitle;
      justwatch.queryYear = year;
      if (searchTitle || imdbId || input.tmdbId != null) {
        justwatch.enrichmentAttempted = true;
        const jw = await getJustWatchUnofficialProviders({
          title: searchTitle,
          year,
          imdbId,
          tmdbId: input.tmdbId ?? null,
          mediaType,
          region,
        }).catch(() => null);
        if (jw) {
          justwatch.outcome = jw.outcome;
          justwatch.offersCount = jw.offersCount;
          justwatch.providersParsed = jw.providers.length;
          justwatch.emptyReason = jw.emptyReason;
          if (jw.matched) {
            justwatch.matchedTitle = jw.matched.title;
            justwatch.matchedImdbId = jw.matched.imdbId;
            justwatch.matchedTmdbId = jw.matched.tmdbId;
            justwatch.matchReason = jw.matched.matchedVia;
          }
          if (jw.outcome === "ok" && jw.providers.length > 0) {
            const merged = mergeChannelOffers(detailed.providers, jw.providers);
            if (merged.changed) {
              liveProviders = merged.providers;
              justwatch.enrichmentReplaced = merged.replaced;
              justwatch.enrichmentAdded = merged.added;
              console.log(
                `[availability] channelEnrichment imdb=${imdbId} region=${region} replaced=${merged.replaced.length} added=${merged.added.length}`,
              );
            }
          }
        }
      } else {
        justwatch.emptyReason = "missing_title_and_ids";
      }
    }

    return {
      ...base,
      providerPath: detailed.path || `/${mediaType}/${imdbId}/watch/providers`,
      providers: liveProviders,
      source: liveProviders.length > 0 ? "balloonerismm" : "none",
      // Só é "live" (persistível) quando NÃO foi erro. Erro nunca vira cache negativo.
      live: detailed.outcome !== "error",
      balloonOutcome: detailed.outcome,
    };
  }

  // 3. Sem imdbId (ou cacheOnly com cache-miss) → fallback local legado. Não persiste,
  // não chama API externa. balloonOutcome null sinaliza "não checado ao vivo".
  const local = await readLegacyLocalProviders(input, region);
  return {
    ...base,
    providers: local,
    source: local.length > 0 ? "local" : "none",
    live: false,
    balloonOutcome: null,
  };
}

/**
 * Resolve a lista plana de providers (sem status temporal).
 * Mantida pública para call-sites que só precisam dos providers (ex.: title page).
 * Persiste via getTitleAvailability internamente para manter UMA fonte de verdade.
 */
export async function resolveTitleProviders(
  input: AvailabilityIdInput,
): Promise<{ providers: TitleProvider[]; source: AvailabilitySource }> {
  const summary = await getTitleAvailability(input);
  const g = summary.providers;
  return {
    providers: [...g.flatrate, ...g.free, ...g.ads, ...g.rent, ...g.buy],
    source: summary.source,
  };
}

/** Trace de diagnóstico da resolução de disponibilidade (modo debug). */
export type AvailabilityDebug = {
  input: { id: string | null; mediaType: "movie" | "tv"; region: string };
  resolved: { imdbId: string | null; via: ImdbResolutionSource };
  cache: {
    hit: boolean;
    stale: boolean;
    isNegative: boolean;
    expiresAt: string | null;
    source: CatalogAvailabilitySource | null;
  };
  providerRequest: {
    path: string | null;
    attempted: boolean;
    /** Outcome do Balloonerismm (fonte primária). */
    balloonerismmOutcome: WatchProvidersOutcome | null;
    /** Outcome do fallback JustWatch (null quando não foi tentado). */
    justwatchOutcome: string | null;
    /** Resultado final consolidado: "ok" se há providers, senão o outcome do balloon. */
    finalOutcome: WatchProvidersOutcome | null;
    /** @deprecated Mantido p/ compat — agora reflete o finalOutcome. */
    outcome: WatchProvidersOutcome | null;
  };
  result: {
    state: AvailabilityState;
    source: AvailabilitySource;
    hasProviders: boolean;
    flatrateCount: number;
    rentCount: number;
    buyCount: number;
    freeCount: number;
    adsCount: number;
    isInTheaters: boolean;
    isFutureRelease: boolean;
  };
  /** Trace do fallback experimental JustWatch. */
  justwatch: JustWatchDebug;
  errors: string[];
};

function computeState(input: {
  hasProviders: boolean;
  balloonOutcome: WatchProvidersOutcome | null;
  /** O cache fresco era a sentinela negativa (checado antes, genuinamente sem providers). */
  cacheNegative: boolean;
}): AvailabilityState {
  if (input.hasProviders) return "available";
  // Erro de fetch ao vivo: dado desconhecido, não "sem provider".
  if (input.balloonOutcome === "error") return "provider_error";
  // "unavailable" SÓ com sinal genuíno: o endpoint foi consultado ao vivo e voltou vazio,
  // OU o cache fresco era a sentinela negativa. Caso contrário (não checado ao vivo,
  // cache-miss em modo cacheOnly, sem IMDb) o estado é DESCONHECIDO — nunca "unavailable".
  // Isso evita o falso "Indisponível no BR" quando a fonte simplesmente não foi consultada.
  if (input.balloonOutcome === "empty") return "unavailable";
  if (input.cacheNegative) return "unavailable";
  return "unresolved";
}

/**
 * Núcleo de resolução de disponibilidade (providers + status temporal + estado),
 * com trace de debug opcional. É o ponto de entrada canônico para cards/listas/grids.
 */
async function resolveAvailabilityCore(
  input: AvailabilityIdInput,
): Promise<{ summary: TitleAvailabilitySummary; debug: AvailabilityDebug }> {
  const region = (input.region ?? DEFAULT_REGION).toUpperCase();
  const { mediaType } = input;

  const resolved = await resolveProviders({ ...input, region });
  const { source, live, resolvedImdbId, balloonOutcome } = resolved;
  // P3: normalização canônica de providers (PROVIDER_ALIASES) aplicada UMA vez aqui —
  // alimenta tanto o cache (writeProvidersToCache) quanto o summary, então nomes/logos
  // ficam consistentes em todas as superfícies. Cobre origens balloon, cache e local.
  // Defensivo: descarta a sentinela __none__ e nomes vazios — nunca devem virar provider.
  const providers = resolved.providers
    .filter((p) => p.name !== NONE_PROVIDER_NAME && p.name.trim() !== "")
    .map(normalizeTitleProvider);

  const grouped = groupProviders(providers);
  const hasProviders = countProviders(grouped) > 0;

  if (hasProviders && live && region === "BR") {
    void ensureDiscoveredStreamingProviders(providers, region);
  }

  // Status temporal: só vale a pena para filmes ainda sem streaming.
  // Gate por data de lançamento conhecida para não chamar release_dates em catálogo antigo.
  let isInTheaters = false;
  let isFutureRelease = false;
  let releaseAge: number | null = null;
  let releaseStatus: ReleaseStatus | undefined;

  const knownDate = mediaType === "movie" ? input.releaseDate : input.firstAirDate;
  const knownAge = knownDate
    ? Math.floor((Date.now() - new Date(knownDate).getTime()) / 86_400_000)
    : null;
  const isRecentOrUnknown = knownAge === null || knownAge <= THEATRICAL_GATE_DAYS;

  // skipReleaseDates=true em warm background paths para evitar dobrar as chamadas à API
  // (watch/providers já usa o budget de rate-limit; release_dates duplicaria o volume).
  // O status temporal é preenchido corretamente na próxima carga normal ou na title page.
  if (mediaType === "movie" && !hasProviders && resolvedImdbId && isRecentOrUnknown && !input.skipReleaseDates) {
    const releaseDates = await getBalloonerismReleaseDates(resolvedImdbId, mediaType).catch(
      () => null,
    );
    releaseStatus = detectReleaseStatus({
      mediaType,
      response: releaseDates,
      region,
      hasStreaming: hasProviders,
      fallbackDate: knownDate ?? null,
    });
    isInTheaters = releaseStatus.isInTheaters;
    isFutureRelease = releaseStatus.isFutureRelease;
    releaseAge = releaseAgeDays(releaseStatus);
  } else {
    releaseStatus = detectReleaseStatus({
      mediaType,
      response: null,
      region,
      hasStreaming: hasProviders,
      fallbackDate: knownDate ?? null,
    });
    isFutureRelease = releaseStatus.isFutureRelease;
    releaseAge = releaseAgeDays(releaseStatus);
  }

  // Persiste no cache (positivo OU negativo GENUÍNO) quando o dado veio ao vivo SEM erro.
  // Cobre Balloonerismm (fonte primária) e o fallback JustWatch (tag distinta + TTL curto),
  // assim os cards/listas (cacheOnly) também passam a exibir o badge do fallback.
  // Erro de fetch nunca vira cache negativo (evita envenenamento).
  if (resolvedImdbId && live) {
    const isJustWatch = source === "justwatch_graphql_unofficial";
    const baseTtl = computeTtlDays({
      hasProviders,
      isInTheaters,
      isFutureRelease,
      releaseAge,
      expectedVodDate: releaseStatus?.expectedVodDate,
      releaseDate: releaseStatus?.earliestRelevantDate ?? knownDate,
    });
    const ttlDays = isJustWatch ? Math.min(baseTtl, TTL_JUSTWATCH) : baseTtl;
    const effectiveTtlDays = isJustWatch ? ttlDays : Math.min(ttlDays, TTL_BALLOON_FALLBACK);

    // Confiança da sentinela negativa: "low" SÓ quando a checagem foi completa (o fallback
    // JustWatch foi tentado). Caso contrário "unverified" → permanece REVALIDÁVEL.
    const confidence: SourceConfidence = hasProviders
      ? (isJustWatch ? "high" : "medium")
      : (resolved.justwatch.attempted ? "low" : "unverified");

    if (hasProviders && isJustWatch) {
      console.log(
        `[availability] negativeCacheReplacedBySource source="justwatch" imdb=${resolvedImdbId} region=${region} providers=${providers.length}`,
      );
    } else if (hasProviders) {
      console.log(`[availability] negativeCacheRevalidated source="balloonerismm" imdb=${resolvedImdbId} providers=${providers.length}`);
    }

    void writeProvidersToCache({
      imdbId: resolvedImdbId,
      tmdbId: input.tmdbId ?? null,
      mediaType,
      region,
      language: input.language ?? "pt-BR",
      providers,
      ttlDays: effectiveTtlDays,
      source: hasProviders && isJustWatch ? "justwatch" : "balloonerismm",
      sourceConfidence: confidence,
    });
  }

  const state = computeState({
    hasProviders,
    balloonOutcome,
    cacheNegative: resolved.cache.negative,
  });

  const summary = buildSummary({
    region,
    providers,
    source,
    state,
    isInTheaters,
    isFutureRelease,
    release: releaseStatus,
    providerPreferences: input.providerPreferences,
  });

  const debug: AvailabilityDebug = {
    input: { id: input.imdbId ?? (input.tmdbId != null ? String(input.tmdbId) : null), mediaType, region },
    resolved: { imdbId: resolvedImdbId, via: resolved.imdbVia },
    cache: {
      hit: resolved.cache.hit,
      stale: resolved.cache.stale,
      isNegative: resolved.cache.negative,
      expiresAt: resolved.cache.expiresAt,
      source: resolved.cache.source,
    },
    providerRequest: {
      path: resolved.providerPath,
      attempted: resolved.providerPath !== null,
      balloonerismmOutcome: balloonOutcome,
      justwatchOutcome: resolved.justwatch.attempted ? resolved.justwatch.outcome : null,
      // finalOutcome reflete o resultado consolidado (inclui o fallback JustWatch):
      // "ok" quando há providers de qualquer fonte; senão o outcome do Balloonerismm.
      finalOutcome: hasProviders ? "ok" : balloonOutcome,
      outcome: hasProviders ? "ok" : balloonOutcome,
    },
    result: {
      state,
      source,
      hasProviders,
      flatrateCount: grouped.flatrate.length,
      rentCount: grouped.rent.length,
      buyCount: grouped.buy.length,
      freeCount: grouped.free.length,
      adsCount: grouped.ads.length,
      isInTheaters,
      isFutureRelease,
    },
    justwatch: resolved.justwatch,
    errors: resolved.errors,
  };

  // Auto-warm de sentinela negativa REVALIDÁVEL encontrada em cacheOnly: agenda a
  // revalidação live em background pelo fluxo canônico. Suprimido quando o caller é o
  // hydrateManyTitleAvailability (que já agenda o warm em lote, de forma limitada).
  if (resolved.negativeRevalidationPending && !input.suppressAutoWarm) {
    console.log(`[availability] negativeCacheRevalidationQueued imdb=${resolvedImdbId}`);
  }

  if (resolved.staleRefreshPending && !input.suppressAutoWarm) {
    console.log(`[availability] staleCacheRefreshQueued imdb=${resolvedImdbId} region=${region}`);
  }

  return { summary, debug };
}

async function withProviderPreferences(
  input: AvailabilityIdInput,
): Promise<AvailabilityIdInput> {
  if (input.providerPreferences !== undefined) return input;
  return {
    ...input,
    providerPreferences: await getUserProviderDisplayPreferences(),
  };
}

export async function getTitleAvailability(
  input: AvailabilityIdInput,
): Promise<TitleAvailabilitySummary> {
  return (await resolveAvailabilityCore(await withProviderPreferences(input))).summary;
}

/** Igual a getTitleAvailability, mas também retorna o trace de diagnóstico (rota ?debug=1). */
export async function getTitleAvailabilityWithDebug(
  input: AvailabilityIdInput,
): Promise<{ summary: TitleAvailabilitySummary; debug: AvailabilityDebug }> {
  return resolveAvailabilityCore(await withProviderPreferences(input));
}

/** Açúcar: hidrata um único título (alias semântico de getTitleAvailability). */
export async function hydrateTitleAvailability(
  input: AvailabilityIdInput,
): Promise<TitleAvailabilitySummary> {
  return getTitleAvailability(input);
}

/** Teto de aquecimento em background por chamada (evita re-criar a tempestade). */
const WARM_BACKGROUND_LIMIT = Math.max(
  1,
  Number(process.env.POPLOG_AVAILABILITY_WARM_LIMIT ?? process.env.POPLOG_WORKER_MAX_CONCURRENCY ?? 12),
);
const WARM_BACKGROUND_CONCURRENCY = Math.max(
  1,
  Number(process.env.POPLOG_AVAILABILITY_WARM_CONCURRENCY ?? process.env.POPLOG_WORKER_MAX_CONCURRENCY ?? 3),
);

/**
 * Aquece o cache ao vivo (fora do caminho da resposta) para títulos que vieram
 * "unresolved" no modo cacheOnly. Não é aguardado — o objetivo é popular o cache
 * persistente para o PRÓXIMO carregamento, sem bloquear nem inflar a resposta atual.
 * Concorrência baixa; o client Balloonerismm já tem rate-limit global.
 */
function warmAvailabilityInBackground(inputs: AvailabilityIdInput[]): void {
  if (inputs.length === 0) return;
  const queue = inputs.slice(0, WARM_BACKGROUND_LIMIT);
  let cursor = 0;
  async function worker() {
    while (cursor < queue.length) {
      const input = queue[cursor++];
      // Força o caminho ao vivo (cacheOnly: false) — escreve cache positivo/negativo.
      // skipReleaseDates=true: evita dobrar as chamadas à API no warm em lote
      // (watch/providers já usa o budget; release_dates seria 2× o volume).
      await getTitleAvailability({ ...input, cacheOnly: false, skipReleaseDates: true, bypassNegativeCache: true }).catch(() => undefined);
    }
  }
  void Promise.allSettled(
    Array.from({ length: Math.min(WARM_BACKGROUND_CONCURRENCY, queue.length) }, () => worker()),
  );
}

/**
 * Hidrata muitos títulos em lote com limite de concorrência.
 * - Promise.allSettled: falha de um item nunca derruba a lista.
 * - O client Balloonerismm já protege com semáforo/token-bucket; aqui limitamos
 *   o fan-out para não criar milhares de promises de uma vez.
 *
 * `cacheOnly` (recomendado em LISTAS): resolve só por cache persistente, sem fetch ao
 * vivo. Evita tempestades e negativos falsos; cache-miss vira "unresolved" (desconhecido,
 * nunca "unavailable"). `warmCold` agenda aquecimento em background dos miss.
 *
 * Retorna um Map keyed por uma chave estável do caller.
 */
export async function hydrateManyTitleAvailability<K>(
  items: Array<{ key: K; input: AvailabilityIdInput }>,
  options: { concurrency?: number; cacheOnly?: boolean; warmCold?: boolean } = {},
): Promise<Map<K, TitleAvailabilitySummary>> {
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const cacheOnly = options.cacheOnly ?? false;
  const result = new Map<K, TitleAvailabilitySummary>();
  let cursor = 0;
  const needsSharedPreferences = items.some(({ input }) => input.providerPreferences === undefined);
  const sharedPreferences = needsSharedPreferences
    ? await getUserProviderDisplayPreferences()
    : [];

  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      const { key, input } = items[index];
      // suppressAutoWarm: o warm em lote (warmCold) abaixo já cobre os revalidáveis de
      // forma limitada — evita que cada item agende seu próprio warm (tempestade).
      const personalizedInput = input.providerPreferences === undefined
        ? { ...input, providerPreferences: sharedPreferences }
        : input;
      const effectiveInput = cacheOnly
        ? { ...personalizedInput, cacheOnly: true, suppressAutoWarm: true }
        : personalizedInput;
      try {
        result.set(key, await getTitleAvailability(effectiveInput));
      } catch {
        result.set(
          key,
          emptyAvailabilitySummary(
            normalizeStreamingRegion(input.region, {
              source: "availability-batch-empty",
              explicit: input.region != null,
            }),
          ),
        );
      }
    }
  }

  const settled = await Promise.allSettled(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
  // allSettled garante que erros de worker não propagam; nada a fazer com `settled`.
  void settled;

  // Aquecimento em background dos títulos frios (apenas em modo cacheOnly).
  if (cacheOnly && options.warmCold) {
    const cold = items
      .filter(({ key }) => result.get(key)?.state === "unresolved")
      .map(({ input }) => input)
      .filter((input) => Boolean(input.imdbId) || Boolean(input.tmdbId));
    warmAvailabilityInBackground(cold);
  }

  return result;
}
