import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { applyLegacyBrazilianBonus } from "@/server/agenda/editorial-regional-bonus";
import { normalizeTmdbPopularity } from "@/lib/score/tmdb-popularity";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";
import { isLocalAgendaEnabled } from "@/server/runtime/local-db-flags";
import {
  getLocalUserLibraryIds,
  getLocalTitleAvailabilityBatch,
  getLocalAgendaStateBatch,
} from "@/server/local-services/continuity-local.service";

// ── TMDB response shapes ──────────────────────────────────────────────────────

type TmdbMovie = {
  id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
};

type TmdbTv = {
  id: number;
  name: string;
  original_language?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
};

type TmdbPageResult<T> = {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
  dates?: { maximum: string; minimum: string };
};

// ── Canonical agenda shapes ───────────────────────────────────────────────────

export type AgendaMovie = {
  id: number;
  media_type: "movie";
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
  user_status?: string | null;
  user_computed_state?: string | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  is_preferred_provider?: boolean;
  availability_scope?: "preferred" | "streaming" | "digital" | "none";
  /** Score editorial: popularidade normalizada + bônus BR (quando aplicável). */
  editorial_score?: number;
  /** Bônus BR concedido — 0 se não for produção brasileira elegível. */
  br_bonus?: number;
};

export type AgendaTv = {
  id: number;
  media_type: "tv";
  title: string;
  original_language?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
  user_status?: string | null;
  user_computed_state?: string | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  is_preferred_provider?: boolean;
  availability_scope?: "preferred" | "streaming" | "digital" | "none";
  /** Score editorial: popularidade normalizada + bônus BR (quando aplicável). */
  editorial_score?: number;
  /** Bônus BR concedido — 0 se não for produção brasileira elegível. */
  br_bonus?: number;
};

export type AgendaResponse = {
  nowPlaying: AgendaMovie[];
  upcoming: AgendaMovie[];
  airingToday: AgendaTv[];      // hoje (p1+p2 mergeados)
  onTheAir: AgendaTv[];         // próximos 7 dias (p1+p2 mergeados)
  newSeries: AgendaTv[];        // estreias: first_air_date nos últimos 45 dias
  soonToReturn: AgendaTv[];     // retornos: air_date nos próximos 8–30 dias
  trendingMovies: AgendaMovie[];
  trendingTv: AgendaTv[];
  userLibraryIds: Record<string, string>; // "movie-123" => status
};

// Gêneros a excluir de séries: Talk Show (10767) e Notícias (10763)
const EXCLUDED_TV_GENRES = new Set([10767, 10763]);
const STREAMING_TYPES = new Set(["streaming", "subscription", "flatrate", "free", "ads"]);

function isTalkOrNews(item: { genre_ids: number[] }): boolean {
  return item.genre_ids.some((g) => EXCLUDED_TV_GENRES.has(g));
}

// ── helpers ───────────────────────────────────────────────────────────────────

function normalizeMovie(m: TmdbMovie): AgendaMovie {
  return {
    id: m.id,
    media_type: "movie",
    title: m.title,
    poster_path: m.poster_path,
    backdrop_path: m.backdrop_path,
    release_date: m.release_date,
    vote_average: m.vote_average,
    vote_count: m.vote_count,
    popularity: m.popularity,
    overview: m.overview,
    genre_ids: m.genre_ids,
  };
}

function normalizeTv(t: TmdbTv): AgendaTv {
  return {
    id: t.id,
    media_type: "tv",
    title: t.name,
    original_language: t.original_language,
    poster_path: t.poster_path,
    backdrop_path: t.backdrop_path,
    first_air_date: t.first_air_date,
    vote_average: t.vote_average,
    vote_count: t.vote_count,
    popularity: t.popularity,
    overview: t.overview,
    genre_ids: t.genre_ids,
  };
}

type EnrichableAgendaItem = AgendaMovie | AgendaTv;

type AvailabilityRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  provider_name: string;
  provider_logo_path: string | null;
  availability_type: string | null;
  tmdb_provider_id: number | null;
};

type StateRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: string | null;
  computed_state: string | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
};

function availabilityScore(row: AvailabilityRow, favoriteProviderIds: Set<string>) {
  const type = row.availability_type ?? "";
  const isPreferred = row.tmdb_provider_id !== null && favoriteProviderIds.has(String(row.tmdb_provider_id));
  const isStreaming = STREAMING_TYPES.has(type);

  let score = 0;
  if (isPreferred) score += 1000;
  if (isStreaming) score += 300;
  if (type === "rent") score += 80;
  if (type === "buy") score += 60;
  if (row.provider_logo_path) score += 10;
  return score;
}

function normalizeProviderType(type?: string | null) {
  if (!type) return null;
  if (type === "flatrate" || type === "subscription") return "streaming";
  return type;
}

async function enrichAgendaItemsLocal(input: {
  userId: string | null;
  items: EnrichableAgendaItem[];
}) {
  const { userId, items } = input;
  if (items.length === 0) return;

  const movieIds = Array.from(new Set(items.filter((i) => i.media_type === "movie").map((i) => i.id)));
  const tvIds = Array.from(new Set(items.filter((i) => i.media_type === "tv").map((i) => i.id)));
  const preferences = await getUserProviderPreferences();
  const favoriteProviderIds = new Set(preferences.favoriteProviderIds ?? []);
  const region = preferences.region ?? "BR";

  const availabilityRows = await getLocalTitleAvailabilityBatch(movieIds, tvIds, region);

  const availabilityMap = new Map<string, AvailabilityRow>();
  for (const row of availabilityRows) {
    const key = `${row.media_type}-${row.tmdb_id}`;
    const current = availabilityMap.get(key);
    const candidate: AvailabilityRow = {
      tmdb_id: row.tmdb_id,
      media_type: row.media_type,
      provider_name: row.provider_name,
      provider_logo_path: row.provider_logo_path,
      availability_type: row.availability_type,
      tmdb_provider_id: row.tmdb_provider_id,
    };
    if (!current || availabilityScore(candidate, favoriteProviderIds) > availabilityScore(current, favoriteProviderIds)) {
      availabilityMap.set(key, candidate);
    }
  }

  const stateRows = userId ? await getLocalAgendaStateBatch(userId, movieIds, tvIds) : [];
  const stateMap = new Map<string, StateRow>();
  for (const row of stateRows) {
    stateMap.set(`${row.media_type}-${row.tmdb_id}`, row as StateRow);
  }

  for (const item of items) {
    const key = `${item.media_type}-${item.id}`;
    const state = stateMap.get(key);
    const availability = availabilityMap.get(key);
    const providerName = state?.best_provider_name ?? availability?.provider_name ?? null;
    const providerType = normalizeProviderType(state?.best_provider_type ?? availability?.availability_type ?? null);
    const providerLogo = state?.best_provider_logo ?? availability?.provider_logo_path ?? null;
    const isPreferred =
      availability?.tmdb_provider_id !== null &&
      availability?.tmdb_provider_id !== undefined &&
      favoriteProviderIds.has(String(availability.tmdb_provider_id));
    const isStreaming = STREAMING_TYPES.has(providerType ?? "");

    item.user_status = state?.status ?? null;
    item.user_computed_state = state?.computed_state ?? null;
    item.best_provider_name = providerName;
    item.best_provider_type = providerType;
    item.best_provider_logo = providerLogo;
    item.is_preferred_provider = isPreferred;
    item.availability_scope = isPreferred ? "preferred" : isStreaming ? "streaming" : providerName ? "digital" : "none";
  }
}

async function enrichAgendaItems(input: {
  userId: string | null;
  items: EnrichableAgendaItem[];
}) {
  const { userId, items } = input;
  if (items.length === 0) return;

  const movieIds = Array.from(new Set(items.filter((item) => item.media_type === "movie").map((item) => item.id)));
  const tvIds = Array.from(new Set(items.filter((item) => item.media_type === "tv").map((item) => item.id)));
  const preferences = await getUserProviderPreferences();
  const favoriteProviderIds = new Set(preferences.favoriteProviderIds ?? []);
  const region = preferences.region ?? "BR";

  const availabilityQueries = [
    movieIds.length
      ? supabaseAdmin
          .from("poplog3_title_availability")
          .select("tmdb_id, media_type, provider_name, provider_logo_path, availability_type, tmdb_provider_id")
          .eq("media_type", "movie")
          .eq("country", region)
          .in("tmdb_id", movieIds)
      : Promise.resolve({ data: [], error: null }),
    tvIds.length
      ? supabaseAdmin
          .from("poplog3_title_availability")
          .select("tmdb_id, media_type, provider_name, provider_logo_path, availability_type, tmdb_provider_id")
          .eq("media_type", "tv")
          .eq("country", region)
          .in("tmdb_id", tvIds)
      : Promise.resolve({ data: [], error: null }),
  ] as const;

  const stateQueries = userId
    ? ([
        movieIds.length
          ? supabaseAdmin
              .from("user_title_state")
              .select("tmdb_id, media_type, status, computed_state, best_provider_name, best_provider_type, best_provider_logo")
              .eq("user_id", userId)
              .eq("media_type", "movie")
              .in("tmdb_id", movieIds)
          : Promise.resolve({ data: [], error: null }),
        tvIds.length
          ? supabaseAdmin
              .from("user_title_state")
              .select("tmdb_id, media_type, status, computed_state, best_provider_name, best_provider_type, best_provider_logo")
              .eq("user_id", userId)
              .eq("media_type", "tv")
              .in("tmdb_id", tvIds)
          : Promise.resolve({ data: [], error: null }),
      ] as const)
    : ([Promise.resolve({ data: [], error: null }), Promise.resolve({ data: [], error: null })] as const);

  const [movieAvailability, tvAvailability, movieStates, tvStates] = await Promise.all([
    availabilityQueries[0],
    availabilityQueries[1],
    stateQueries[0],
    stateQueries[1],
  ]);

  const availabilityMap = new Map<string, AvailabilityRow>();
  for (const row of [
    ...((movieAvailability.data ?? []) as AvailabilityRow[]),
    ...((tvAvailability.data ?? []) as AvailabilityRow[]),
  ]) {
    const key = `${row.media_type}-${row.tmdb_id}`;
    const current = availabilityMap.get(key);
    if (!current || availabilityScore(row, favoriteProviderIds) > availabilityScore(current, favoriteProviderIds)) {
      availabilityMap.set(key, row);
    }
  }

  const stateMap = new Map<string, StateRow>();
  for (const row of [
    ...((movieStates.data ?? []) as StateRow[]),
    ...((tvStates.data ?? []) as StateRow[]),
  ]) {
    stateMap.set(`${row.media_type}-${row.tmdb_id}`, row);
  }

  for (const item of items) {
    const key = `${item.media_type}-${item.id}`;
    const state = stateMap.get(key);
    const availability = availabilityMap.get(key);
    const providerName = state?.best_provider_name ?? availability?.provider_name ?? null;
    const providerType = normalizeProviderType(state?.best_provider_type ?? availability?.availability_type ?? null);
    const providerLogo = state?.best_provider_logo ?? availability?.provider_logo_path ?? null;
    const isPreferred =
      availability?.tmdb_provider_id !== null &&
      availability?.tmdb_provider_id !== undefined &&
      favoriteProviderIds.has(String(availability.tmdb_provider_id));
    const isStreaming = STREAMING_TYPES.has(providerType ?? "");

    item.user_status = state?.status ?? null;
    item.user_computed_state = state?.computed_state ?? null;
    item.best_provider_name = providerName;
    item.best_provider_type = providerType;
    item.best_provider_logo = providerLogo;
    item.is_preferred_provider = isPreferred;
    item.availability_scope = isPreferred
      ? "preferred"
      : isStreaming
        ? "streaming"
        : providerName
          ? "digital"
          : "none";
  }
}

// Merge resultados de múltiplas páginas dedupando por id
function mergeDedup<T extends { id: number }>(
  ...settled: PromiseSettledResult<TmdbPageResult<T>>[]
): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const item of r.value.results) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        out.push(item);
      }
    }
  }
  return out;
}

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const nowDate = new Date();
    const todayStr          = nowDate.toISOString().slice(0, 10);
    const fortyFiveDaysAgo  = new Date(nowDate.getTime() - 45  * 86_400_000).toISOString().slice(0, 10);
    const eightDaysAhead    = new Date(nowDate.getTime() + 8   * 86_400_000).toISOString().slice(0, 10);
    const ninetyDaysAhead   = new Date(nowDate.getTime() + 90  * 86_400_000).toISOString().slice(0, 10);

    const WITHOUT_TALK = "10767,10763";

    // 12 fetches paralelos — todos cacheados individualmente pelo Next.js
    const [
      nowPlayingRes,
      upcomingRes,
      airingTodayRes1,
      airingTodayRes2,
      onTheAirRes1,
      onTheAirRes2,
      newSeriesRes,
      soonToReturnRes1,
      soonToReturnRes2,
      trendingMoviesRes,
      trendingTvRes,
    ] = await Promise.allSettled([
      // Filmes em cartaz (Brasil)
      tmdbFetch<TmdbPageResult<TmdbMovie>>("/movie/now_playing", {
        params: { region: "BR", page: 1 },
        revalidate: 3600 * 6,
      }),
      // Próximos lançamentos (Brasil)
      tmdbFetch<TmdbPageResult<TmdbMovie>>("/movie/upcoming", {
        params: { region: "BR", page: 1 },
        revalidate: 3600 * 6,
      }),
      // Episódios hoje — página 1 (~20 séries)
      tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/airing_today", {
        params: { page: 1 },
        revalidate: 3600 * 2,
      }),
      // Episódios hoje — página 2 (~40 séries total)
      tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/airing_today", {
        params: { page: 2 },
        revalidate: 3600 * 2,
      }),
      // No ar esta semana — página 1
      tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/on_the_air", {
        params: { page: 1 },
        revalidate: 3600 * 4,
      }),
      // No ar esta semana — página 2
      tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/on_the_air", {
        params: { page: 2 },
        revalidate: 3600 * 4,
      }),
      // Estreias: séries com première nos últimos 45 dias
      tmdbFetch<TmdbPageResult<TmdbTv>>("/discover/tv", {
        params: {
          "first_air_date.gte": fortyFiveDaysAgo,
          "first_air_date.lte": todayStr,
          "sort_by": "popularity.desc",
          "vote_count.gte": "3",
          "without_genres": WITHOUT_TALK,
          page: 1,
        },
        revalidate: 3600 * 6,
      }),
      // Retornando em breve: séries com episódios nos próximos 90 dias — página 1
      tmdbFetch<TmdbPageResult<TmdbTv>>("/discover/tv", {
        params: {
          "air_date.gte": eightDaysAhead,
          "air_date.lte": ninetyDaysAhead,
          "sort_by": "popularity.desc",
          "vote_count.gte": "20",
          "without_genres": WITHOUT_TALK,
          page: 1,
        },
        revalidate: 3600 * 6,
      }),
      // Retornando em breve — página 2
      tmdbFetch<TmdbPageResult<TmdbTv>>("/discover/tv", {
        params: {
          "air_date.gte": eightDaysAhead,
          "air_date.lte": ninetyDaysAhead,
          "sort_by": "popularity.desc",
          "vote_count.gte": "20",
          "without_genres": WITHOUT_TALK,
          page: 2,
        },
        revalidate: 3600 * 6,
      }),
      // Trending filmes (semana)
      tmdbFetch<TmdbPageResult<TmdbMovie>>("/trending/movie/week", {
        params: { page: 1 },
        revalidate: 3600 * 4,
      }),
      // Trending séries (semana)
      tmdbFetch<TmdbPageResult<TmdbTv>>("/trending/tv/week", {
        params: { page: 1 },
        revalidate: 3600 * 4,
      }),
    ]);

    // Merge + dedup multi-página; filtro talk/news aplicado pós-fetch (endpoints sem parâmetro)
    const airingTodayRaw = mergeDedup(airingTodayRes1, airingTodayRes2).filter((t) => !isTalkOrNews(t));
    const onTheAirRaw    = mergeDedup(onTheAirRes1, onTheAirRes2).filter((t) => !isTalkOrNews(t));
    const soonToReturnRaw = mergeDedup(soonToReturnRes1, soonToReturnRes2);

    // Bônus BR: aplicado nos arrays de TV/filmes legados antes da entrega ao cliente.
    // applyLegacyBrazilianBonus() adiciona editorial_score e br_bonus e reordena
    // por editorial_score, garantindo que produções brasileiras elegíveis ganhem
    // visibilidade consistente com o pipeline principal do AgendaEngine.
    const airingToday = applyLegacyBrazilianBonus(
      airingTodayRaw.map(normalizeTv),
      normalizeTmdbPopularity,
    );
    const onTheAir = applyLegacyBrazilianBonus(
      onTheAirRaw.map(normalizeTv),
      normalizeTmdbPopularity,
    );

    const nowPlaying = nowPlayingRes.status === "fulfilled"
      ? nowPlayingRes.value.results.map(normalizeMovie) : [];
    const upcoming = upcomingRes.status === "fulfilled"
      ? upcomingRes.value.results.map(normalizeMovie) : [];
    const newSeries = applyLegacyBrazilianBonus(
      newSeriesRes.status === "fulfilled"
        ? newSeriesRes.value.results.filter((t) => !isTalkOrNews(t)).map(normalizeTv)
        : [],
      normalizeTmdbPopularity,
    );
    const soonToReturn = applyLegacyBrazilianBonus(
      soonToReturnRaw.map(normalizeTv),
      normalizeTmdbPopularity,
    );
    const trendingMovies = trendingMoviesRes.status === "fulfilled"
      ? trendingMoviesRes.value.results.map(normalizeMovie) : [];
    const trendingTv = trendingTvRes.status === "fulfilled"
      ? trendingTvRes.value.results.filter((t) => !isTalkOrNews(t)).map(normalizeTv) : [];


    // user library (optional)
    const userLibraryIds: Record<string, string> = {};
    let userId: string | null = null;
    try {
      const user = await getCurrentUser();
      if (user) {
        userId = user.id;
        if (isLocalAgendaEnabled()) {
          Object.assign(userLibraryIds, await getLocalUserLibraryIds(user.id));
        } else {
          const { data } = await supabaseAdmin
            .from("user_titles")
            .select("tmdb_id, media_type, status")
            .eq("user_id", user.id);
          if (data) {
            for (const row of data) {
              userLibraryIds[`${row.media_type}-${row.tmdb_id}`] = row.status;
            }
          }
        }
      }
    } catch {
      // auth failure e nao-fatal
    }

    const enrichFn = isLocalAgendaEnabled() ? enrichAgendaItemsLocal : enrichAgendaItems;

    try {
      await enrichFn({
        userId,
        items: [
          ...nowPlaying,
          ...upcoming,
          ...airingToday,
          ...onTheAir,
          ...newSeries,
          ...soonToReturn,
          ...trendingMovies,
          ...trendingTv,
        ],
      });
    } catch (err) {
      console.warn("[agenda] enrichment failed", err);
    }

    const response: AgendaResponse = {
      nowPlaying,
      upcoming,
      airingToday,
      onTheAir,
      newSeries,
      soonToReturn,
      trendingMovies,
      trendingTv,
      userLibraryIds,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    console.error("[agenda] route error:", err);
    return NextResponse.json(
      { error: "Falha ao carregar a agenda." },
      { status: 500 },
    );
  }
}
