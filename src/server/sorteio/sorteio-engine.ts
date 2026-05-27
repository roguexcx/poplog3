import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";

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
  };
};

type TmdbItem = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  overview?: string;
  genre_ids?: number[];
  original_language?: string;
};

type TmdbPage<T> = {
  results: T[];
};

type LibraryRow = {
  tmdb_id: number;
  media_type: MediaType;
  status: string | null;
  computed_state: string | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
};

type AvailabilityRow = {
  tmdb_id: number;
  media_type: MediaType;
  provider_name: string;
  provider_logo_path: string | null;
  availability_type: string | null;
  tmdb_provider_id: number | null;
};

type RecentDrawRow = {
  tmdb_id: number;
  media_type: MediaType;
  created_at: string;
};

const INTENSE_GENRES = new Set([18, 80, 53, 27, 9648, 10752]);
const LIGHT_GENRES = new Set([35, 10751, 10749, 16]);
const DISCOVERY_GENRES = [28, 35, 18, 27, 53, 878, 10749, 16, 99];
const DISCOVERY_LANGUAGES = ["pt", "en", "es", "ko", "ja", "fr"];
const STREAMING_TYPES = new Set(["streaming", "subscription", "flatrate", "free", "ads"]);
const DIGITAL_TYPES = new Set(["rent", "buy"]);

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function isPastOrToday(date?: string | null) {
  return Boolean(date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= todayIso());
}

function itemDate(item: SorteioItem) {
  return item.media_type === "movie" ? item.release_date : item.first_air_date;
}

function normalizeTmdbItem(item: TmdbItem, mediaType: MediaType, source: string): SorteioItem | null {
  const title = mediaType === "movie" ? item.title : item.name;
  const date = mediaType === "movie" ? item.release_date : item.first_air_date;
  if (!title?.trim() || !item.poster_path || !isPastOrToday(date)) return null;

  const rawOriginalTitle = mediaType === "movie" ? item.original_title : item.original_name;
  return {
    id: item.id,
    media_type: mediaType,
    title: title.trim(),
    original_title: rawOriginalTitle?.trim() || null,
    poster_path: item.poster_path,
    backdrop_path: item.backdrop_path ?? null,
    release_date: mediaType === "movie" ? date ?? "" : "",
    first_air_date: mediaType === "tv" ? date ?? "" : "",
    vote_average: item.vote_average ?? 0,
    vote_count: item.vote_count ?? 0,
    popularity: item.popularity ?? 0,
    overview: item.overview ?? "",
    genre_ids: item.genre_ids ?? [],
    original_language: item.original_language ?? null,
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
  return 1;
}

function normalizeProviderType(type?: string | null) {
  if (!type) return null;
  if (type === "flatrate" || type === "subscription") return "streaming";
  return type;
}

function availabilityScore(row: AvailabilityRow, favoriteProviderIds: Set<string>) {
  const type = row.availability_type ?? "";
  const isPreferred = row.tmdb_provider_id !== null && favoriteProviderIds.has(String(row.tmdb_provider_id));
  let score = 0;
  if (isPreferred) score += 1000;
  if (STREAMING_TYPES.has(type)) score += 300;
  if (DIGITAL_TYPES.has(type)) score += 60;
  if (row.provider_logo_path) score += 10;
  return score;
}

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

function weightedPick(items: SorteioItem[]) {
  const total = items.reduce((sum, item) => sum + (item.sorteio_weight ?? 1), 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.sorteio_weight ?? 1;
    if (cursor <= 0) return item;
  }
  return items[0];
}

async function safeTmdb(path: string, mediaType: MediaType, source: string, params: Record<string, string | number | boolean | undefined> = {}) {
  try {
    const response = await tmdbFetch<TmdbPage<TmdbItem>>(path, {
      params: { page: 1, ...params },
      revalidate: 3600 * 4,
    });
    return response.results
      .map((item) => normalizeTmdbItem(item, mediaType, source))
      .filter((item): item is SorteioItem => item !== null);
  } catch (err) {
    console.warn("[sorteio-engine] source failed", { source, path, err });
    return [];
  }
}

async function fetchDiscoveryPool(favoriteProviderIds: string[], region: string) {
  const today = todayIso();
  const providerList = favoriteProviderIds.join("|");
  const sources: Array<Promise<SorteioItem[]>> = [
    safeTmdb("/trending/movie/day", "movie", "trending_day"),
    safeTmdb("/trending/tv/day", "tv", "trending_day"),
    safeTmdb("/trending/movie/week", "movie", "trending_week"),
    safeTmdb("/trending/tv/week", "tv", "trending_week"),
    safeTmdb("/movie/popular", "movie", "popular"),
    safeTmdb("/tv/popular", "tv", "popular"),
    safeTmdb("/movie/top_rated", "movie", "top_rated"),
    safeTmdb("/tv/top_rated", "tv", "top_rated"),
    safeTmdb("/discover/movie", "movie", "discover_movie", {
      include_adult: false,
      "release_date.lte": today,
      "vote_count.gte": 80,
      sort_by: "popularity.desc",
      region,
    }),
    safeTmdb("/discover/tv", "tv", "discover_tv", {
      "first_air_date.lte": today,
      "vote_count.gte": 60,
      sort_by: "popularity.desc",
      watch_region: region,
    }),
  ];

  for (const genre of DISCOVERY_GENRES) {
    sources.push(safeTmdb("/discover/movie", "movie", `popular_genre_movie_${genre}`, {
      include_adult: false,
      "release_date.lte": today,
      "vote_count.gte": 80,
      with_genres: genre,
      sort_by: "popularity.desc",
      region,
    }));
    sources.push(safeTmdb("/discover/tv", "tv", `popular_genre_tv_${genre}`, {
      "first_air_date.lte": today,
      "vote_count.gte": 60,
      with_genres: genre,
      sort_by: "popularity.desc",
      watch_region: region,
    }));
  }

  for (const language of DISCOVERY_LANGUAGES) {
    sources.push(safeTmdb("/discover/movie", "movie", `popular_language_movie_${language}`, {
      include_adult: false,
      "release_date.lte": today,
      "vote_count.gte": 80,
      with_original_language: language,
      sort_by: "popularity.desc",
      region,
    }));
    sources.push(safeTmdb("/discover/tv", "tv", `popular_language_tv_${language}`, {
      "first_air_date.lte": today,
      "vote_count.gte": 60,
      with_original_language: language,
      sort_by: "popularity.desc",
      watch_region: region,
    }));
  }

  // Busca múltiplas páginas para fontes de provider — são as mais relevantes para
  // "meus streamings" e o TMDB confirma a disponibilidade diretamente no filtro.
  const PROVIDER_POOL_PAGES = 5;
  if (providerList) {
    for (let page = 1; page <= PROVIDER_POOL_PAGES; page++) {
      sources.push(safeTmdb("/discover/movie", "movie", "popular_provider_movie", {
        include_adult: false,
        "release_date.lte": today,
        "vote_count.gte": 40,
        watch_region: region,
        with_watch_providers: providerList,
        with_watch_monetization_types: "flatrate",
        sort_by: "popularity.desc",
        page,
      }));
      sources.push(safeTmdb("/discover/tv", "tv", "popular_provider_tv", {
        "first_air_date.lte": today,
        "vote_count.gte": 30,
        watch_region: region,
        with_watch_providers: providerList,
        with_watch_monetization_types: "flatrate",
        sort_by: "popularity.desc",
        page,
      }));
    }
  }

  const settled = await Promise.all(sources);
  const items = dedupe(settled.flat()).filter((item) => {
    if (!item.poster_path || !item.title || !isPastOrToday(itemDate(item))) return false;
    if (item.sorteio_source?.includes("top_rated") && item.vote_count < 1000) return false;
    return true;
  });

  return items;
}

async function fetchLibraryRows(userId: string) {
  const { data } = await supabaseAdmin
    .from("user_title_state")
    .select("tmdb_id, media_type, status, computed_state, best_provider_name, best_provider_type, best_provider_logo")
    .eq("user_id", userId);
  return (data ?? []) as LibraryRow[];
}

async function fetchNotInterestedKeys(userId: string): Promise<Set<string>> {
  const { data } = await supabaseAdmin
    .from("user_title_feedback")
    .select("tmdb_id, media_type")
    .eq("user_id", userId)
    .eq("feedback_type", "not_interested")
    .eq("active", true);
  return new Set((data ?? []).map((row) => `${row.media_type}-${row.tmdb_id}`));
}

async function fetchWatchlistPool(userId: string): Promise<SorteioItem[]> {
  const { data: stateRows } = await supabaseAdmin
    .from("user_title_state")
    .select("tmdb_id, media_type, status, computed_state, best_provider_name, best_provider_type, best_provider_logo")
    .eq("user_id", userId)
    .eq("status", "watchlist");

  const states = (stateRows ?? []) as LibraryRow[];
  const movieIds = states.filter((row) => row.media_type === "movie").map((row) => row.tmdb_id);
  const tvIds = states.filter((row) => row.media_type === "tv").map((row) => row.tmdb_id);
  const [movieTitles, tvTitles] = await Promise.all([
    movieIds.length
      ? supabaseAdmin
          .from("poplog3_titles")
          .select("tmdb_id, media_type, title, original_title, poster_path, backdrop_path, release_date, first_air_date, vote_average, popularity")
          .eq("media_type", "movie")
          .in("tmdb_id", movieIds)
      : Promise.resolve({ data: [] }),
    tvIds.length
      ? supabaseAdmin
          .from("poplog3_titles")
          .select("tmdb_id, media_type, title, original_title, poster_path, backdrop_path, release_date, first_air_date, vote_average, popularity")
          .eq("media_type", "tv")
          .in("tmdb_id", tvIds)
      : Promise.resolve({ data: [] }),
  ]);
  const stateMap = new Map(states.map((row) => [`${row.media_type}-${row.tmdb_id}`, row]));

  const mapped: Array<SorteioItem | null> = [...(movieTitles.data ?? []), ...(tvTitles.data ?? [])]
    .map((row): SorteioItem | null => {
      const record = row as Record<string, unknown>;
      const mediaType = record.media_type as MediaType;
      const tmdbId = record.tmdb_id as number;
      const state = stateMap.get(`${mediaType}-${tmdbId}`);
      const title = (record.title as string | null) ?? (record.original_title as string | null);
      const date = mediaType === "movie" ? record.release_date as string | null : record.first_air_date as string | null;
      if (!title || !record.poster_path || !isPastOrToday(date)) return null;
      return {
        id: tmdbId,
        media_type: mediaType,
        title,
        original_title: (record.original_title as string | null) ?? null,
        poster_path: record.poster_path as string | null,
        backdrop_path: record.backdrop_path as string | null,
        release_date: mediaType === "movie" ? date ?? "" : "",
        first_air_date: mediaType === "tv" ? date ?? "" : "",
        vote_average: (record.vote_average as number | null) ?? 0,
        vote_count: 0,
        popularity: (record.popularity as number | null) ?? 0,
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

async function enrichAvailability(items: SorteioItem[], favoriteProviderIds: Set<string>, region: string) {
  const movieIds = items.filter((item) => item.media_type === "movie").map((item) => item.id);
  const tvIds = items.filter((item) => item.media_type === "tv").map((item) => item.id);
  const [movieRows, tvRows] = await Promise.all([
    movieIds.length
      ? supabaseAdmin
          .from("poplog3_title_availability")
          .select("tmdb_id, media_type, provider_name, provider_logo_path, availability_type, tmdb_provider_id")
          .eq("media_type", "movie")
          .eq("country", region)
          .in("tmdb_id", movieIds)
      : Promise.resolve({ data: [] }),
    tvIds.length
      ? supabaseAdmin
          .from("poplog3_title_availability")
          .select("tmdb_id, media_type, provider_name, provider_logo_path, availability_type, tmdb_provider_id")
          .eq("media_type", "tv")
          .eq("country", region)
          .in("tmdb_id", tvIds)
      : Promise.resolve({ data: [] }),
  ]);

  const availabilityMap = new Map<string, AvailabilityRow>();
  for (const row of [...(movieRows.data ?? []), ...(tvRows.data ?? [])] as AvailabilityRow[]) {
    const key = `${row.media_type}-${row.tmdb_id}`;
    const current = availabilityMap.get(key);
    if (!current || availabilityScore(row, favoriteProviderIds) > availabilityScore(current, favoriteProviderIds)) {
      availabilityMap.set(key, row);
    }
  }

  for (const item of items) {
    const availability = availabilityMap.get(`${item.media_type}-${item.id}`);
    if (!availability) continue;
    const providerType = normalizeProviderType(availability.availability_type);
    const isPreferred =
      availability.tmdb_provider_id !== null &&
      favoriteProviderIds.has(String(availability.tmdb_provider_id));

    item.best_provider_name = availability.provider_name;
    item.best_provider_type = providerType;
    item.best_provider_logo = availability.provider_logo_path;
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
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const { data } = await supabaseAdmin
    .from("user_events")
    .select("tmdb_id, media_type, created_at")
    .eq("user_id", userId)
    .eq("event_type", "sorteio_draw")
    .eq("payload->>mode", mode)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  return (data ?? []) as RecentDrawRow[];
}

async function logDraw(userId: string, item: SorteioItem, meta: SorteioPoolResult["meta"]) {
  const { error } = await supabaseAdmin.from("user_events").insert({
    user_id: userId,
    tmdb_id: item.id,
    media_type: item.media_type,
    event_type: "sorteio_draw",
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
  });
  if (error) console.warn("[sorteio-engine] draw log failed", error);
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

export async function buildSorteioPool(userId: string, filters: SorteioFilters): Promise<SorteioPoolResult> {
  const preferences = await getUserProviderPreferences();
  const region = preferences.region ?? "BR";
  const favoriteProviderIds = new Set(preferences.favoriteProviderIds ?? []);
  const [libraryRows, notInterestedKeys] = await Promise.all([
    fetchLibraryRows(userId),
    fetchNotInterestedKeys(userId),
  ]);
  const libraryKeys = new Set(libraryRows.map((row) => `${row.media_type}-${row.tmdb_id}`));
  const excludedKeys = new Set([...libraryKeys, ...notInterestedKeys]);

  const initialItems = filters.mode === "watchlist"
    ? await fetchWatchlistPool(userId)
    : (await fetchDiscoveryPool([...favoriteProviderIds], region)).filter(
        (item) => !excludedKeys.has(`${item.media_type}-${item.id}`),
      );

  if (filters.mode === "discovery") {
    await enrichAvailability(initialItems, favoriteProviderIds, region);

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
    },
  };
}

export async function drawSorteioItem(userId: string, filters: SorteioFilters) {
  const pool = await buildSorteioPool(userId, filters);
  const item = weightedPick(pool.items);
  if (item) await logDraw(userId, item, pool.meta);
  return { item: item ?? null, meta: pool.meta };
}
