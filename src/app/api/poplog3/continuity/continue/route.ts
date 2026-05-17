import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getCachedEpisode } from "@/server/cache/season-cache";

const DEFAULT_EPISODE_RUNTIME = 45;
const NEW_EPISODE_DAYS = 30;
const MAX_ITEMS = 24;

export type ContinueStatusSignal =
  | "new_episode"
  | "last_episode"
  | "reta_final"
  | "continuing";

export type ContinueItem = {
  content_id: string;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  computed_state: string;
  watched_episodes: number;
  aired_episodes: number;
  episodes_behind: number;
  progress_pct: number;
  next_season: number;
  next_episode: number;
  next_episode_name: string | null;
  next_episode_still_path: string | null;
  next_episode_air_date: string | null;
  last_watched_at: string | null;
  remaining_minutes: number;
  status_signal: ContinueStatusSignal;
  runtime: number | null;
  /** Episódios assistidos na temporada atual (= next_episode - 1) */
  season_watched: number;
  /** Total de episódios na temporada atual — de poplog3_seasons; null se não sincronizado */
  season_total: number | null;
};

type StateRow = {
  tmdb_id: number;
  computed_state: string | null;
  watched_episodes: number;
  aired_episodes: number;
  progress_pct: number;
  next_season: number;
  next_episode: number;
  next_episode_air_date: string | null;
  last_watched_at: string | null;
  last_event_at: string;
};

type TitleRow = {
  tmdb_id: number;
  title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  runtime: number | null;
  episode_run_time: number[] | null;
};

function resolveSignal(
  episodesBehind: number,
  nextEpAirDate: string | null,
  cutoffStr: string,
): ContinueStatusSignal {
  if (nextEpAirDate && nextEpAirDate >= cutoffStr) return "new_episode";
  if (episodesBehind === 1) return "last_episode";
  if (episodesBehind <= 3) return "reta_final";
  return "continuing";
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Apenas séries em andamento com progresso real — nenhum recálculo no front
    const { data: statesRaw, error: statesError } = await supabaseAdmin
      .from("user_title_state")
      .select(
        "tmdb_id, computed_state, watched_episodes, aired_episodes, progress_pct, next_season, next_episode, next_episode_air_date, last_watched_at, last_event_at",
      )
      .eq("user_id", user.id)
      .eq("media_type", "tv")
      .eq("status", "watching")
      .eq("computed_state", "in_progress")
      .gt("watched_episodes", 0)
      .not("next_season", "is", null)
      .not("next_episode", "is", null)
      .order("last_watched_at", { ascending: false, nullsFirst: false });

    if (statesError) {
      console.error("[continuity/continue] states query failed", {
        message: statesError.message,
        code: statesError.code,
        details: statesError.details,
      });
      return NextResponse.json({ items: [] });
    }

    if (!statesRaw || statesRaw.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const states = statesRaw as StateRow[];
    const tmdbIds = states.map((s) => s.tmdb_id);

    const { data: titlesRaw } = await supabaseAdmin
      .from("poplog3_titles")
      .select("tmdb_id, title, poster_path, backdrop_path, runtime, episode_run_time")
      .in("tmdb_id", tmdbIds)
      .eq("media_type", "tv");

    const titleMap = new Map<number, TitleRow>(
      ((titlesRaw ?? []) as TitleRow[]).map((t) => [t.tmdb_id, t]),
    );

    // Batch query para totais de episódios por temporada
    const { data: seasonsRaw } = await supabaseAdmin
      .from("poplog3_seasons")
      .select("series_tmdb_id, season_number, episode_count")
      .in("series_tmdb_id", tmdbIds);

    type SeasonRow = { series_tmdb_id: number; season_number: number; episode_count: number };
    const seasonMap = new Map<string, number>(
      ((seasonsRaw ?? []) as SeasonRow[]).map((r) => [
        `${r.series_tmdb_id}:${r.season_number}`,
        r.episode_count,
      ]),
    );

    const cutoffStr = new Date(Date.now() - NEW_EPISODE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    // Filtra novamente para garantir que o título exista no catálogo
    const valid = states.filter((s) => titleMap.has(s.tmdb_id));
    const top = valid.slice(0, MAX_ITEMS);

    // Enriquece com nome/still do próximo episódio em paralelo
    const epData = await Promise.all(
      top.map((s) => getCachedEpisode(s.tmdb_id, s.next_season, s.next_episode)),
    );

    const items: ContinueItem[] = top.map((state, i) => {
      const title = titleMap.get(state.tmdb_id)!;
      const ep = epData[i];
      const avgRuntime =
        title.episode_run_time?.[0] ?? title.runtime ?? DEFAULT_EPISODE_RUNTIME;
      const episodesBehind = Math.max(0, state.aired_episodes - state.watched_episodes);
      const remainingMinutes = episodesBehind * avgRuntime;

      return {
        content_id: `tv-${state.tmdb_id}`,
        tmdb_id: state.tmdb_id,
        title: title.title ?? `Série ${state.tmdb_id}`,
        poster_path: title.poster_path ?? null,
        backdrop_path: title.backdrop_path ?? null,
        computed_state: state.computed_state ?? "in_progress",
        watched_episodes: state.watched_episodes,
        aired_episodes: state.aired_episodes,
        episodes_behind: episodesBehind,
        progress_pct: state.progress_pct,
        next_season: state.next_season,
        next_episode: state.next_episode,
        next_episode_name: ep?.name ?? null,
        next_episode_still_path: ep?.still_path ?? null,
        next_episode_air_date: state.next_episode_air_date ?? null,
        last_watched_at: state.last_watched_at ?? null,
        remaining_minutes: remainingMinutes,
        status_signal: resolveSignal(episodesBehind, state.next_episode_air_date, cutoffStr),
        runtime: avgRuntime,
        season_watched: state.next_episode - 1,
        season_total: seasonMap.get(`${state.tmdb_id}:${state.next_season}`) ?? null,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[continuity/continue] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}
