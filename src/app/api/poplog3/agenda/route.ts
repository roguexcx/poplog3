import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";

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
};

export type AgendaTv = {
  id: number;
  media_type: "tv";
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
  user_status?: string | null;
};

export type AgendaResponse = {
  nowPlaying: AgendaMovie[];
  upcoming: AgendaMovie[];
  airingToday: AgendaTv[];
  onTheAir: AgendaTv[];
  userLibraryIds: Record<string, string>; // "movie-123" => status
};

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

// ── route ─────────────────────────────────────────────────────────────────────

export async function GET() {
  try {
    const [nowPlayingRes, upcomingRes, airingTodayRes, onTheAirRes] =
      await Promise.allSettled([
        tmdbFetch<TmdbPageResult<TmdbMovie>>("/movie/now_playing", {
          params: { region: "BR", page: 1 },
          revalidate: 3600 * 6, // 6h
        }),
        tmdbFetch<TmdbPageResult<TmdbMovie>>("/movie/upcoming", {
          params: { region: "BR", page: 1 },
          revalidate: 3600 * 6,
        }),
        tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/airing_today", {
          params: { page: 1 },
          revalidate: 3600 * 2, // 2h
        }),
        tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/on_the_air", {
          params: { page: 1 },
          revalidate: 3600 * 4, // 4h
        }),
      ]);

    const nowPlaying =
      nowPlayingRes.status === "fulfilled"
        ? nowPlayingRes.value.results.map(normalizeMovie)
        : [];
    const upcoming =
      upcomingRes.status === "fulfilled"
        ? upcomingRes.value.results.map(normalizeMovie)
        : [];
    const airingToday =
      airingTodayRes.status === "fulfilled"
        ? airingTodayRes.value.results.map(normalizeTv)
        : [];
    const onTheAir =
      onTheAirRes.status === "fulfilled"
        ? onTheAirRes.value.results.map(normalizeTv)
        : [];

    // ── user library (optional) ───────────────────────────────────────────────
    let userLibraryIds: Record<string, string> = {};

    try {
      const user = await getCurrentUser();
      if (user) {
        const { data } = await supabaseAdmin
          .from("poplog3_user_titles")
          .select("tmdb_id, media_type, status")
          .eq("user_id", user.id);

        if (data) {
          for (const row of data) {
            const key = `${row.media_type}-${row.tmdb_id}`;
            userLibraryIds[key] = row.status;
          }
        }
      }
    } catch {
      // auth failure is non-fatal — just return empty library
    }

    const response: AgendaResponse = {
      nowPlaying,
      upcoming,
      airingToday,
      onTheAir,
      userLibraryIds,
    };

    return NextResponse.json(response, {
      headers: { "Cache-Control": "private, max-age=300" },
    });
  } catch (err) {
    console.error("[agenda] route error:", err);
    return NextResponse.json(
      { error: "Falha ao carregar a agenda." },
      { status: 500 }
    );
  }
}
