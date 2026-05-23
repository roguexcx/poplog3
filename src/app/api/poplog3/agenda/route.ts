import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { applyLegacyBrazilianBonus } from "@/server/agenda/editorial-regional-bonus";
import { normalizeTmdbPopularity } from "@/lib/score/tmdb-popularity";

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
    try {
      const user = await getCurrentUser();
      if (user) {
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
    } catch {
      // auth failure e nao-fatal
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
