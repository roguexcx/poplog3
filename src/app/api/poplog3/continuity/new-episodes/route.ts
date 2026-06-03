import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { formatEpisodeRuntimeLabel } from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import {
  scheduleContinuitySeasonRefresh,
  scheduleContinuityTitleRefresh,
} from "@/server/continuity/continuity-background-refresh";
import {
  getLocalContinuityStateRows,
  getLocalTitlesBatch,
  getLocalSeasonsBatch,
  getLocalEpisodesBatch,
} from "@/server/local-services/continuity-local.service";

// Séries com mais de N episódios por assistir são ignoradas (backlog pesado)
const MAX_EPISODES_BEHIND = 5;
// Séries ainda não iniciadas só entram se já tiverem poucos episódios aired
const MAX_AIRED_FOR_WATCHLIST = 5;
// Trigger editorial: episódio novo nos últimos N dias
const NEW_EPISODE_DAYS = 30;
const MAX_ITEMS = 12;

export type NewEpisodeItem = {
  content_id: string;
  tmdb_id: number;
  title: string;
  original_title?: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  computed_state: string | null;
  watched_episodes: number;
  aired_episodes: number;
  episodes_behind: number;
  progress_pct: number;
  next_season: number | null;
  next_episode: number | null;
  next_episode_name: string | null;
  next_episode_still_path: string | null;
  next_episode_air_date: string | null;
  last_air_date: string | null;
  days_since_new_episode: number | null;
  runtime: number | null;
  runtime_label: string | null;
  /** Episódios assistidos na temporada atual (heurística: next_episode - 1) */
  season_watched: number | null;
  /** Total de episódios na temporada atual — null se não sincronizado */
  season_total: number | null;
};

type StateRow = {
  tmdb_id: number;
  status: string | null;
  computed_state: string | null;
  watched_episodes: number;
  aired_episodes: number;
  progress_pct: number;
  next_season: number | null;
  next_episode: number | null;
  next_episode_air_date: string | null;
  last_event_at: string;
};

type TitleRow = {
  tmdb_id: number;
  title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  last_air_date: string | null;
  runtime: number | null;
  episode_run_time: number[] | null;
  last_synced_at: string | null;
};

type EpisodeMeta = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  name: string | null;
  still_path: string | null;
  air_date: string | null;
  runtime: number | null;
};

async function buildLocalNewEpisodes(userId: string): Promise<NextResponse> {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  let stageStartedAt = totalStartedAt;
  const markStage = (stage: string) => {
    perf[stage] = Date.now() - stageStartedAt;
    stageStartedAt = Date.now();
  };

  try {
    const statesRaw = (await getLocalContinuityStateRows(userId)).filter(
      (state) =>
        state.media_type === "tv" &&
        (state.status === "watching" || state.status === "watchlist"),
    );
    markStage("states_read");

    if (statesRaw.length === 0) {
      console.log("[continuity-new-episodes/local/perf]", { states: 0, ...perf, total: Date.now() - totalStartedAt });
      return NextResponse.json({ items: [] });
    }

    const states = statesRaw as StateRow[];
    let prefilterBehindLimit = 0;
    const prefilteredStates = states.filter((state) => {
      const watched = state.watched_episodes ?? 0;
      const aired = state.aired_episodes ?? 0;
      const episodesBehind = Math.max(0, aired - watched);
      const cs = state.computed_state;
      if (cs === "in_progress") {
        if (episodesBehind > MAX_EPISODES_BEHIND) { prefilterBehindLimit++; return false; }
        return (
          episodesBehind > 0 &&
          state.next_season != null && state.next_season > 0 &&
          state.next_episode != null && state.next_episode > 0
        );
      }
      if (cs === "up_to_date" && state.status === "watching") return true;
      return (
        (cs === "watchlist" || state.status === "watchlist") &&
        watched === 0 && aired > 0 && aired <= MAX_AIRED_FOR_WATCHLIST
      );
    });
    markStage("prefilter");

    if (prefilteredStates.length === 0) {
      console.log("[continuity-new-episodes/local/perf]", {
        states: states.length, prefiltered: 0, returned: 0, skip_behind_limit: prefilterBehindLimit, ...perf, total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({ items: [] });
    }

    const tmdbIds = prefilteredStates.map((s) => s.tmdb_id);
    const titlesRaw = await getLocalTitlesBatch(tmdbIds, "tv");
    const titleMap = new Map<number, TitleRow>(titlesRaw.map((t) => [t.tmdb_id, t as unknown as TitleRow]));
    markStage("titles_read");

    const seasonsRaw = await getLocalSeasonsBatch(tmdbIds);
    type SeasonRow2 = { series_tmdb_id: number; season_number: number; episode_count: number; last_synced_at: string | null };
    const seasonMap = new Map<string, SeasonRow2>(
      seasonsRaw.filter((r) => r.episode_count !== null).map((r) => [`${r.series_tmdb_id}:${r.season_number}`, r as SeasonRow2]),
    );
    markStage("seasons_read");

    const cutoffStr = new Date(Date.now() - NEW_EPISODE_DAYS * 86_400_000).toISOString().slice(0, 10);

    type Eligible = StateRow & TitleRow & { effectiveNextSeason: number; effectiveNextEpisode: number; episodesBehind: number };
    const eligible: Eligible[] = [];
    let skipNoTitle = 0;
    let skipBehindLimit = prefilterBehindLimit;
    let skipNoDateTrigger = 0;

    for (const state of prefilteredStates) {
      const title = titleMap.get(state.tmdb_id);
      if (!title) { skipNoTitle++; continue; }

      const seriesLastAirDate: string | null = title.last_air_date ?? null;
      const watched = state.watched_episodes ?? 0;
      const aired = state.aired_episodes ?? 0;
      const episodesBehind = Math.max(0, aired - watched);
      const cs = state.computed_state;

      if (
        cs === "in_progress" &&
        episodesBehind > 0 && episodesBehind <= MAX_EPISODES_BEHIND &&
        state.next_season != null && state.next_season > 0 &&
        state.next_episode != null && state.next_episode > 0
      ) {
        const dateTrigger = state.next_episode_air_date ?? seriesLastAirDate;
        if (!dateTrigger || dateTrigger < cutoffStr) { skipNoDateTrigger++; continue; }
        eligible.push({ ...state, ...title, tmdb_id: state.tmdb_id, effectiveNextSeason: state.next_season, effectiveNextEpisode: state.next_episode, episodesBehind });
        continue;
      }

      if (cs === "in_progress" && episodesBehind > MAX_EPISODES_BEHIND) skipBehindLimit++;

      if (
        (cs === "watchlist" || state.status === "watchlist") &&
        watched === 0 && aired > 0 && aired <= MAX_AIRED_FOR_WATCHLIST &&
        seriesLastAirDate != null && seriesLastAirDate >= cutoffStr
      ) {
        eligible.push({ ...state, ...title, tmdb_id: state.tmdb_id, effectiveNextSeason: 1, effectiveNextEpisode: 1, episodesBehind: aired });
      }
    }
    markStage("filtering");

    eligible.sort(
      (a, b) =>
        a.episodesBehind - b.episodesBehind ||
        (b.last_event_at ?? "").localeCompare(a.last_event_at ?? ""),
    );
    const top = eligible.slice(0, MAX_ITEMS);

    const episodesRaw = top.length > 0 ? await getLocalEpisodesBatch(top.map((item) => item.tmdb_id)) : [];
    const episodeMap = new Map<string, EpisodeMeta>(
      episodesRaw
        .filter((ep) => top.some((item) => item.tmdb_id === ep.series_tmdb_id && item.effectiveNextSeason === ep.season_number && item.effectiveNextEpisode === ep.episode_number))
        .map((ep) => [`${ep.series_tmdb_id}:${ep.season_number}:${ep.episode_number}`, ep as unknown as EpisodeMeta]),
    );
    markStage("episodes_read");

    const items: NewEpisodeItem[] = top.map((item) => {
      const ep = episodeMap.get(`${item.tmdb_id}:${item.effectiveNextSeason}:${item.effectiveNextEpisode}`) ?? null;
      const lastAirDate = item.last_air_date ?? null;
      const daysSince = lastAirDate ? Math.floor((Date.now() - new Date(lastAirDate).getTime()) / 86_400_000) : null;
      const runtimeResolution = resolveRuntimeByMediaType({ mediaType: "tv", episodeRunTime: item.episode_run_time });
      const runtimeLabel = formatEpisodeRuntimeLabel(runtimeResolution.minutes, { estimated: runtimeResolution.estimated });
      const nextEpAirDate: string | null = item.next_episode_air_date ?? ep?.air_date ?? null;

      return {
        content_id: `tv-${item.tmdb_id}`,
        tmdb_id: item.tmdb_id,
        title: item.title ?? `Série ${item.tmdb_id}`,
        poster_path: item.poster_path ?? null,
        backdrop_path: item.backdrop_path ?? null,
        computed_state: item.computed_state ?? null,
        watched_episodes: item.watched_episodes ?? 0,
        aired_episodes: item.aired_episodes ?? 0,
        episodes_behind: item.episodesBehind,
        progress_pct: item.progress_pct ?? 0,
        next_season: item.effectiveNextSeason,
        next_episode: item.effectiveNextEpisode,
        next_episode_name: ep?.name ?? null,
        next_episode_still_path: ep?.still_path ?? null,
        next_episode_air_date: nextEpAirDate,
        last_air_date: lastAirDate,
        days_since_new_episode: daysSince,
        runtime: runtimeResolution.minutes,
        runtime_label: runtimeLabel,
        season_watched: item.effectiveNextEpisode > 1 ? item.effectiveNextEpisode - 1 : 0,
        season_total: seasonMap.get(`${item.tmdb_id}:${item.effectiveNextSeason}`)?.episode_count ?? null,
      };
    });
    markStage("response_build");

    scheduleContinuityTitleRefresh({
      context: "new-episodes",
      targets: prefilteredStates.map((state) => ({
        mediaType: "tv" as const,
        tmdbId: state.tmdb_id,
        lastSyncedAt: titleMap.get(state.tmdb_id)?.last_synced_at ?? null,
      })),
    });
    scheduleContinuitySeasonRefresh({
      context: "new-episodes",
      targets: top.map((item) => ({
        seriesTmdbId: item.tmdb_id,
        seasonNumber: item.effectiveNextSeason,
        lastSyncedAt: seasonMap.get(`${item.tmdb_id}:${item.effectiveNextSeason}`)?.last_synced_at ?? null,
      })),
    });

    console.log("[continuity-new-episodes/local/perf]", {
      states: states.length, prefiltered: prefilteredStates.length, eligible: eligible.length,
      returned: items.length, skip_no_title: skipNoTitle, skip_behind_limit: skipBehindLimit, skip_no_date: skipNoDateTrigger,
      ...perf, total: Date.now() - totalStartedAt,
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[new-episodes/local] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    return buildLocalNewEpisodes(user.id);
  } catch (err) {
    console.error("[new-episodes] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}
