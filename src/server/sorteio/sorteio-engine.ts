import { db } from "@/server/db/client";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";
import { hydrateManyTitleAvailability } from "@/server/availability";
import {
  catalogGetTrending,
  catalogGetPopular,
} from "@/server/source-engine/engine";
import type { CatalogSearchResult } from "@/server/source-engine/types/catalog.types";
import { syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import { ensureMinimumSorteioSeed } from "@/server/sorteio/minimum-pool";

type MediaType = "movie" | "tv";
export type SorteioMode = "discovery" | "watchlist";
export type SorteioTypeFilter = "all" | "movie" | "tv";
export type SorteioVibeFilter = "all" | "intense" | "light" | "surprise";
type AvailabilityScope = "preferred" | "streaming" | "digital" | "none";

export type SorteioItem = {
  id: number;
  media_type: MediaType;
  title: string;
  original_title?: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
  original_language?: string | null;
  user_status?: string | null;
  user_computed_state?: string | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  is_preferred_provider?: boolean;
  availability_scope?: AvailabilityScope;
  sorteio_source?: string;
  sorteio_weight?: number;
};

export type SorteioFilters = {
  mode: SorteioMode;
  type: SorteioTypeFilter;
  vibe: SorteioVibeFilter;
};

export type SorteioPoolResult = {
  items: SorteioItem[];
  meta: {
    mode: SorteioMode;
    filters: SorteioFilters;
    sourceCounts: Record<string, number>;
    fallback: string;
    excludedLibraryCount: number;
    recentWindowDays: number;
    recentDemotedCount: number;
    totalBeforeFallback: number;
    poolCount: number;
    usedTmdbApi: boolean;
    poolSource: string;
    skippedReasons: string[];
  };
};

type BuildSorteioPoolOptions = {
  externalDiscovery?: boolean;
  warmAvailability?: boolean;
};

const INTENSE_GENRES = new Set([18, 80, 53, 27, 9648, 10752]);
const LIGHT_GENRES = new Set([35, 10751, 10749, 16]);
const STREAMING_TYPES = new Set(["streaming", "subscription", "flatrate", "free", "ads"]);
const DIGITAL_TYPES = new Set(["rent", "buy"]);
const MIN_LOCAL_DISCOVERY_ITEMS = 12;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isPastOrToday(date?: string | null) {
  return Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayIso());
}

function itemDate(item: SorteioItem) {
  return item.media_type === "movie" ? item.release_date : item.first_air_date;
}

function normalizeCatalogResult(item: CatalogSearchResult, source: string): SorteioItem | null {
  const mediaType: MediaType = item.mediaType === "show" ? "tv" : "movie";
  const date = mediaType === "movie" ? item.releaseDate : item.firstAirDate;

  if (!item.title?.trim() || !item.posterPath || !isPastOrToday(date)) return null;

  // Prefer real tmdbId; fall back to synthetic from imdbId; finally a stable hash
  const tmdbId =
    item.ids.tmdbId ??
    (item.ids.imdbId ? syntheticTmdbFromImdbId(item.ids.imdbId) : null) ??
    (() => {
      // Stable positive hash for titles with no tmdbId and no imdbId
      const key = `${mediaType}|${item.title}|${item.releaseDate ?? item.firstAirDate ?? ""}`;
      let h = 0;
      for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
      return 1_800_000_000 + (h % 100_000_000);
    })();

  return {
    id: tmdbId,
    media_type: mediaType,
    title: item.title.trim(),
    original_title: item.originalTitle?.trim() ?? null,
    poster_path: item.posterPath,
    backdrop_path: item.backdropPath ?? null,
    release_date: mediaType === "movie" ? date ?? "" : "",
    first_air_date: mediaType === "tv" ? date ?? "" : "",
    vote_average: item.voteAverage ?? 0,
    vote_count: item.voteCount ?? 0,
    popularity: 0,
    overview: item.overview ?? "",
    genre_ids: item.genreIds ?? [],
    original_language: null,
    availability_scope: "none",
    sorteio_source: source,
  };
}

function dedupe(items: SorteioItem[]) {
  const map = new Map<string, SorteioItem>();
  for (const item of items) {
    const key = `${item.media_type}-${item.id}`;
    const current = map.get(key);
    if (!current || sourceStrength(item.sorteio_source) > sourceStrength(current.sorteio_source)) {
      map.set(key, item);
    }
  }
  return Array.from(map.values());
}

function sourceStrength(source?: string) {
  if (!source) return 1;
  if (source.includes("trending_day")) return 10;
  if (source.includes("trending_week")) return 9;
  if (source.includes("popular_provider")) return 8;
  if (source.includes("discover")) return 7;
  if (source.includes("popular")) return 6;
  if (source.includes("top_rated")) return 5;
  if (source.includes("poplog_seed")) return 4;
  return 1;
}

function normalizeProviderType(type?: string | null) {
  if (!type) return null;
  if (type === "flatrate" || type === "subscription") return "streaming";
  return type;
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function genreIdsFromJson(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > 0)
    .map((item) => Math.floor(item));
}

/** Chave de comparação canônica para nomes de provider (alias-aware + lowercase). */
function passesVibe(item: SorteioItem, vibe: SorteioVibeFilter) {
  if (vibe === "all" || vibe === "surprise") return true;
  const genres = item.genre_ids ?? [];
  if (vibe === "intense") return genres.some((genre) => INTENSE_GENRES.has(genre));
  if (vibe === "light") return genres.some((genre) => LIGHT_GENRES.has(genre));
  return true;
}

function baseWeight(item: SorteioItem, recentPenalty: number) {
  let weight = 1;
  weight += Math.min(item.popularity ?? 0, 280) / 32;
  weight += Math.min(item.vote_count ?? 0, 7000) / 1250;
  if ((item.vote_average ?? 0) >= 7.2) weight += 1.2;
  if ((item.vote_average ?? 0) < 5.5) weight *= 0.55;
  if ((item.vote_count ?? 0) < 40) weight *= 0.45;
  if (item.backdrop_path) weight += 0.75;
  if (item.availability_scope === "preferred") weight += 9;
  else if (item.availability_scope === "streaming") weight += 4.5;
  else if (item.availability_scope === "digital") weight += 1.25;
  if (item.original_language === "pt") weight += 1.25;
  if (item.original_language === "en") weight += 0.85;
  weight += sourceStrength(item.sorteio_source) * 0.55;
  weight *= recentPenalty;
  return Math.max(weight, 0.05);
}

function recentWindowDays(poolSize: number) {
  if (poolSize >= 120) return 30;
  if (poolSize >= 45) return 15;
  return 7;
}

export function pickWeightedSorteioItem(items: SorteioItem[]) {
  const total = items.reduce((sum, item) => sum + (item.sorteio_weight ?? 1), 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.sorteio_weight ?? 1;
    if (cursor <= 0) return item;
  }
  return items[0];
}

async function fetchBalloonerismmDiscovery(): Promise<SorteioItem[]> {
  const LIMIT = 20;
  const sources = await Promise.allSettled([
    catalogGetTrending({ mediaType: "movie", limit: LIMIT }),
    catalogGetTrending({ mediaType: "show", limit: LIMIT }),
    catalogGetPopular({ mediaType: "movie", limit: LIMIT }),
    catalogGetPopular({ mediaType: "show", limit: LIMIT }),
  ]);

  const sourceNames = [
    "balloonerismm_trending_movie",
    "balloonerismm_trending_tv",
    "balloonerismm_popular_movie",
    "balloonerismm_popular_tv",
  ] as const;

  const items: SorteioItem[] = [];
  for (let i = 0; i < sources.length; i++) {
    const result = sources[i];
    if (result.status === "rejected") {
      console.warn("[sorteio-engine] balloonerismm source failed", { source: sourceNames[i], err: result.reason });
      continue;
    }
    for (const catalogItem of result.value) {
      const normalized = normalizeCatalogResult(catalogItem, sourceNames[i]);
      if (normalized) items.push(normalized);
    }
  }
  return items;
}

async function fetchLocalDiscovery(): Promise<SorteioItem[]> {
  await ensureMinimumSorteioSeed({
    minCount: MIN_LOCAL_DISCOVERY_ITEMS,
    reason: "sorteio_local_discovery",
  }).catch((err) => {
    console.warn("[sorteio-engine] minimum seed skipped", err);
  });

  const rows = await db.poplog3Title.findMany({
    where: { posterPath: { not: null } },
    orderBy: { popularity: "desc" },
    take: 300,
    select: {
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      overview: true,
      posterPath: true,
      backdropPath: true,
      releaseDate: true,
      firstAirDate: true,
      voteAverage: true,
      voteCount: true,
      popularity: true,
      genres: true,
      originalLanguage: true,
      source: true,
    },
  });

  return rows
    .map((row): SorteioItem | null => {
      const mediaType = row.mediaType as MediaType;
      const date = mediaType === "movie" ? dateOnly(row.releaseDate) : dateOnly(row.firstAirDate);
      const title = row.title ?? row.originalTitle;
      if (!title?.trim() || !row.posterPath || !isPastOrToday(date)) return null;
      return {
        id: row.tmdbId,
        media_type: mediaType,
        title: title.trim(),
        original_title: row.originalTitle ?? null,
        poster_path: row.posterPath,
        backdrop_path: row.backdropPath ?? null,
        release_date: mediaType === "movie" ? date ?? "" : "",
        first_air_date: mediaType === "tv" ? date ?? "" : "",
        vote_average: row.voteAverage === null ? 0 : Number(row.voteAverage),
        vote_count: row.voteCount ?? 0,
        popularity: row.popularity === null ? 0 : Number(row.popularity),
        overview: row.overview ?? "",
        genre_ids: genreIdsFromJson(row.genres),
        original_language: row.originalLanguage ?? null,
        availability_scope: "none",
        sorteio_source: row.source === "poplog_seed" ? "poplog_seed" : "local_db",
      };
    })
    .filter((item): item is SorteioItem => item !== null);
}

async function fetchDiscoveryPool(
  _favoriteProviderIds: string[],
  _region: string,
  options: BuildSorteioPoolOptions = {},
): Promise<{ items: SorteioItem[]; poolSource: string; skippedReasons: string[] }> {
  const skippedReasons: string[] = [];
  const allowExternal = options.externalDiscovery !== false;
  const [balloonerismmItems, localItems] = await Promise.all([
    allowExternal
      ? fetchBalloonerismmDiscovery().catch((err) => {
          console.warn("[sorteio-engine] fetchBalloonerismmDiscovery failed", err);
          skippedReasons.push("balloonerismm_unavailable");
          return [] as SorteioItem[];
        })
      : Promise.resolve([] as SorteioItem[]),
    fetchLocalDiscovery().catch((err) => {
      console.warn("[sorteio-engine] fetchLocalDiscovery failed", err);
      skippedReasons.push("local_db_unavailable");
      return [] as SorteioItem[];
    }),
  ]);

  if (!allowExternal) skippedReasons.push("external_discovery_disabled_for_draw");

  const poolSource = balloonerismmItems.length > 0 ? "balloonerismm+local_db" : "local_db";
  const items = dedupe([...balloonerismmItems, ...localItems]).filter((item) => {
    if (!item.poster_path || !item.title || !isPastOrToday(itemDate(item))) return false;
    return true;
  });

  return { items, poolSource, skippedReasons };
}

async function fetchLibraryRows(userId: string) {
  const rows = await db.userTitleState.findMany({
    where: { userId },
    select: {
      tmdbId: true,
      mediaType: true,
      status: true,
      computedState: true,
      bestProviderName: true,
      bestProviderType: true,
      bestProviderLogo: true,
    },
  });
  return rows.map((row) => ({
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    status: row.status,
    computed_state: row.computedState,
    best_provider_name: row.bestProviderName,
    best_provider_type: row.bestProviderType,
    best_provider_logo: row.bestProviderLogo,
  }));
}

async function fetchNotInterestedKeys(userId: string): Promise<Set<string>> {
  const rows = await db.userTitleFeedback.findMany({
    where: {
      userId,
      feedbackType: "not_interested",
      active: true,
    },
    select: {
      tmdbId: true,
      mediaType: true,
    },
  });
  return new Set(rows.map((row) => `${row.mediaType}-${row.tmdbId}`));
}

async function fetchWatchlistPool(userId: string): Promise<SorteioItem[]> {
  const states = (await db.userTitleState.findMany({
    where: {
      userId,
      status: "watchlist",
    },
    select: {
      tmdbId: true,
      mediaType: true,
      status: true,
      computedState: true,
      bestProviderName: true,
      bestProviderType: true,
      bestProviderLogo: true,
    },
  })).map((row) => ({
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    status: row.status,
    computed_state: row.computedState,
    best_provider_name: row.bestProviderName,
    best_provider_type: row.bestProviderType,
    best_provider_logo: row.bestProviderLogo,
  }));
  const movieIds = states.filter((row) => row.media_type === "movie").map((row) => row.tmdb_id);
  const tvIds = states.filter((row) => row.media_type === "tv").map((row) => row.tmdb_id);
  const [movieTitles, tvTitles] = await Promise.all([
    movieIds.length
      ? db.poplog3Title.findMany({ where: { mediaType: "movie", tmdbId: { in: movieIds } } })
      : Promise.resolve([]),
    tvIds.length
      ? db.poplog3Title.findMany({ where: { mediaType: "tv", tmdbId: { in: tvIds } } })
      : Promise.resolve([]),
  ]);
  const stateMap = new Map(states.map((row) => [`${row.media_type}-${row.tmdb_id}`, row]));

  const mapped: Array<SorteioItem | null> = [...movieTitles, ...tvTitles]
    .map((row): SorteioItem | null => {
      const mediaType = row.mediaType as MediaType;
      const tmdbId = row.tmdbId;
      const state = stateMap.get(`${mediaType}-${tmdbId}`);
      const title = row.title ?? row.originalTitle;
      const date = mediaType === "movie" ? dateOnly(row.releaseDate) : dateOnly(row.firstAirDate);
      if (!title || !row.posterPath || !isPastOrToday(date)) return null;
      return {
        id: tmdbId,
        media_type: mediaType,
        title,
        original_title: row.originalTitle ?? null,
        poster_path: row.posterPath,
        backdrop_path: row.backdropPath,
        release_date: mediaType === "movie" ? date ?? "" : "",
        first_air_date: mediaType === "tv" ? date ?? "" : "",
        vote_average: row.voteAverage === null ? 0 : Number(row.voteAverage),
        vote_count: 0,
        popularity: row.popularity === null ? 0 : Number(row.popularity),
        overview: "",
        genre_ids: [],
        user_status: state?.status ?? "watchlist",
        user_computed_state: state?.computed_state ?? null,
        best_provider_name: state?.best_provider_name ?? null,
        best_provider_type: normalizeProviderType(state?.best_provider_type ?? null),
        best_provider_logo: state?.best_provider_logo ?? null,
        availability_scope: state?.best_provider_name
          ? DIGITAL_TYPES.has(state.best_provider_type ?? "") ? "digital" : "streaming"
          : "none",
        sorteio_source: "watchlist",
      };
    });

  return mapped.filter((item): item is SorteioItem => item !== null);
}

/**
 * P4: disponibilidade do Sorteio agora vem do FLUXO CANÔNICO
 * (hydrateManyTitleAvailability, cacheOnly + warmCold) — sem ler catalog_availability direto.
 */
async function enrichAvailability(items: SorteioItem[], region: string, options: BuildSorteioPoolOptions = {}) {
  if (items.length === 0) return;

  const availabilityMap = await hydrateManyTitleAvailability(
    items.map((item) => ({
      key: `${item.media_type}-${item.id}`,
      input: { mediaType: item.media_type, tmdbId: item.id, region },
    })),
    { cacheOnly: true, warmCold: options.warmAvailability !== false },
  );

  for (const item of items) {
    const best = availabilityMap.get(`${item.media_type}-${item.id}`)?.bestProvider ?? null;
    if (!best) continue; // preserva best_provider já vindo do user_title_state
    const providerType = normalizeProviderType(best.type);
    const isPreferred = Boolean(best.isPreferred);

    item.best_provider_name = best.name;
    item.best_provider_type = providerType;
    item.best_provider_logo = best.logoUrl ?? null;
    item.is_preferred_provider = isPreferred;
    item.availability_scope = isPreferred
      ? "preferred"
      : STREAMING_TYPES.has(providerType ?? "")
        ? "streaming"
        : DIGITAL_TYPES.has(providerType ?? "")
          ? "digital"
          : "none";
  }
}

async function fetchRecentDraws(userId: string, days: number, mode: SorteioMode) {
  const since = new Date(Date.now() - days * 86_400_000);
  const rows = await db.userEvent.findMany({
    where: {
      userId,
      eventType: "sorteio_draw",
      createdAt: { gte: since },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows
    .filter((row) => typeof row.payload === "object" && row.payload !== null && (row.payload as Record<string, unknown>).mode === mode)
    .map((row) => ({
      tmdb_id: row.tmdbId,
      media_type: row.mediaType,
      created_at: row.createdAt.toISOString(),
    }));
}

export async function logSorteioDraw(userId: string, item: SorteioItem, meta: SorteioPoolResult["meta"]) {
  await db.userEvent.create({
    data: {
    userId,
    tmdbId: item.id,
    mediaType: item.media_type,
    eventType: "sorteio_draw",
    payload: {
      mode: meta.mode,
      source: item.sorteio_source,
      filters: meta.filters,
      fallback: meta.fallback,
      weight: item.sorteio_weight,
      provider: item.best_provider_name ?? null,
      availabilityScope: item.availability_scope ?? "none",
      poolSize: meta.totalBeforeFallback,
    },
    },
  });
}

function applyFallback(items: SorteioItem[], filters: SorteioFilters) {
  let filtered = items;
  let fallback = "strict";

  if (filters.type !== "all" && filters.vibe !== "surprise") {
    const byType = filtered.filter((item) => item.media_type === filters.type);
    if (byType.length >= 3) filtered = byType;
    else fallback = "type_relaxed";
  }

  if (filters.vibe !== "all" && filters.vibe !== "surprise") {
    const byVibe = filtered.filter((item) => passesVibe(item, filters.vibe));
    if (byVibe.length >= 3) filtered = byVibe;
    else fallback = fallback === "strict" ? "vibe_relaxed" : `${fallback}+vibe_relaxed`;
  }

  return { items: filtered, fallback };
}

export async function buildSorteioPool(
  userId: string,
  filters: SorteioFilters,
  options: BuildSorteioPoolOptions = {},
): Promise<SorteioPoolResult> {
  const preferences = await getUserProviderPreferences();
  const region = preferences.region ?? "BR";
  const favoriteProviderIds = new Set(preferences.favoriteProviderIds ?? []);
  const [libraryRows, notInterestedKeys] = await Promise.all([
    fetchLibraryRows(userId),
    fetchNotInterestedKeys(userId),
  ]);
  const libraryKeys = new Set(libraryRows.map((row) => `${row.media_type}-${row.tmdb_id}`));
  const excludedKeys = new Set([...libraryKeys, ...notInterestedKeys]);

  let poolSource = "watchlist";
  let skippedReasons: string[] = [];

  let initialItems: SorteioItem[];
  if (filters.mode === "watchlist") {
    initialItems = await fetchWatchlistPool(userId);
  } else {
    const discovery = await fetchDiscoveryPool([...favoriteProviderIds], region, options);
    poolSource = discovery.poolSource;
    skippedReasons = discovery.skippedReasons;
    initialItems = discovery.items.filter(
      (item) => !excludedKeys.has(`${item.media_type}-${item.id}`),
    );
  }

  if (filters.mode === "discovery" && options.warmAvailability !== false) {
    await enrichAvailability(initialItems, region, options);
  }

  const strictCandidates = initialItems.filter((item) => {
    if (!item.poster_path || !item.title || !isPastOrToday(itemDate(item))) return false;
    if (filters.mode === "discovery" && excludedKeys.has(`${item.media_type}-${item.id}`)) return false;
    return true;
  });

  const { items: fallbackItems, fallback } = applyFallback(strictCandidates, filters);
  const windowDays = recentWindowDays(fallbackItems.length);
  const recent = await fetchRecentDraws(userId, windowDays, filters.mode);
  const recentKeys = new Set(recent.map((row) => `${row.media_type}-${row.tmdb_id}`));
  let recentDemotedCount = 0;

  const weighted = fallbackItems.map((item) => {
    const isRecent = recentKeys.has(`${item.media_type}-${item.id}`);
    if (isRecent) recentDemotedCount += 1;
    return {
      ...item,
      sorteio_weight: baseWeight(item, isRecent ? (fallbackItems.length < 8 ? 0.35 : 0.08) : 1),
    };
  });

  const sourceCounts = weighted.reduce<Record<string, number>>((acc, item) => {
    const source = item.sorteio_source ?? "unknown";
    acc[source] = (acc[source] ?? 0) + 1;
    return acc;
  }, {});

  return {
    items: weighted.sort((a, b) => (b.sorteio_weight ?? 0) - (a.sorteio_weight ?? 0)),
    meta: {
      mode: filters.mode,
      filters,
      sourceCounts,
      fallback,
      excludedLibraryCount: filters.mode === "discovery" ? excludedKeys.size : 0,
      recentWindowDays: windowDays,
      recentDemotedCount,
      totalBeforeFallback: strictCandidates.length,
      poolCount: weighted.length,
      usedTmdbApi: false,
      poolSource,
      skippedReasons,
    },
  };
}

export async function drawSorteioItem(userId: string, filters: SorteioFilters) {
  const pool = await buildSorteioPool(userId, filters);
  const item = pickWeightedSorteioItem(pool.items);
  if (item) await logSorteioDraw(userId, item, pool.meta);
  return { item: item ?? null, meta: pool.meta };
}
