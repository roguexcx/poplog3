import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  formatEpisodeRuntimeLabel,
  formatRemainingRuntimeLabel,
} from "@/lib/domain-labels";
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
  enrichSyntheticTitlesBatch,
} from "@/server/local-services/continuity-local.service";

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
  original_title?: string | null;
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
  remaining_minutes: number | null;
  remaining_runtime_label: string | null;
  /** Minutos restantes considerando TODOS os episódios aired da série */
  series_remaining_minutes: number | null;
  series_remaining_runtime_label: string | null;
  status_signal: ContinueStatusSignal;
  runtime: number | null;
  runtime_label: string | null;
  /** Episódios assistidos na temporada atual (= next_episode - 1) */
  season_watched: number;
  /** Total de episódios na temporada atual — de title_seasons; null se não sincronizado */
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
  original_title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
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

async function buildLocalContinueItems(userId: string): Promise<NextResponse> {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  let stageStartedAt = totalStartedAt;
  const markStage = (stage: string) => {
    perf[stage] = Date.now() - stageStartedAt;
    stageStartedAt = Date.now();
  };

  try {
    const statesRaw = (await getLocalContinuityStateRows(userId))
      .filter(
        (state) =>
          state.media_type === "tv" &&
          state.status === "watching" &&
          state.computed_state === "in_progress" &&
          (state.watched_episodes ?? 0) > 0 &&
          (state.next_season ?? 0) > 0 &&
          (state.next_episode ?? 0) > 0,
      )
      .sort(
        (a, b) =>
          new Date(b.last_watched_at ?? 0).getTime() -
          new Date(a.last_watched_at ?? 0).getTime(),
      );
    markStage("states_read");

    if (statesRaw.length === 0) {
      console.log("[continuity-continue/local/perf]", { states: 0, ...perf, total: Date.now() - totalStartedAt });
      return NextResponse.json({ items: [] });
    }

    const states = statesRaw as StateRow[];
    const tmdbIds = states.map((s) => s.tmdb_id);

    const titlesRaw = await getLocalTitlesBatch(tmdbIds, "tv");
    const titleMap = new Map<number, TitleRow>(
      titlesRaw.map((t) => [t.tmdb_id, t as unknown as TitleRow]),
    );

    // Enrich any synthetic (negative) IDs not found in DB via Balloonerismm
    const missingIds = tmdbIds.filter((id) => !titleMap.has(id));
    if (missingIds.length > 0) {
      const enriched = await enrichSyntheticTitlesBatch(missingIds, "tv");
      for (const t of enriched) {
        titleMap.set(t.tmdb_id, t as unknown as TitleRow);
      }
    }
    markStage("titles_read");

    const seasonsRaw = await getLocalSeasonsBatch(tmdbIds);
    type SeasonRow = { series_tmdb_id: number; season_number: number; episode_count: number; last_synced_at: string | null };
    const seasonMap = new Map<string, SeasonRow>(
      seasonsRaw
        .filter((r) => r.episode_count !== null)
        .map((r) => [`${r.series_tmdb_id}:${r.season_number}`, r as SeasonRow]),
    );
    markStage("seasons_read");

    const cutoffStr = new Date(Date.now() - NEW_EPISODE_DAYS * 86_400_000).toISOString().slice(0, 10);

    const valid = states.filter((s) => titleMap.has(s.tmdb_id));
    const top = valid.slice(0, MAX_ITEMS);
    markStage("filtering");

    const episodesRaw = await getLocalEpisodesBatch(top.map((s) => s.tmdb_id));
    const episodeMap = new Map<string, EpisodeMeta>(
      episodesRaw
        .filter((ep) =>
          top.some(
            (state) =>
              state.tmdb_id === ep.series_tmdb_id &&
              state.next_season === ep.season_number &&
              state.next_episode === ep.episode_number,
          ),
        )
        .map((ep) => [`${ep.series_tmdb_id}:${ep.season_number}:${ep.episode_number}`, ep as unknown as EpisodeMeta]),
    );
    markStage("episodes_read");

    const items: ContinueItem[] = top.map((state) => {
      const title = titleMap.get(state.tmdb_id)!;
      const ep = episodeMap.get(`${state.tmdb_id}:${state.next_season}:${state.next_episode}`) ?? null;
      const runtimeResolution = resolveRuntimeByMediaType({
        mediaType: "tv",
        runtimeMinutes: title.runtime,
        episodeRunTime: title.episode_run_time,
        episodes: ep
          ? [{ seasonNumber: ep.season_number, episodeNumber: ep.episode_number, runtimeMinutes: ep.runtime, airDate: ep.air_date }]
          : undefined,
      });
      const episodesBehind = Math.max(0, state.aired_episodes - state.watched_episodes);
      const seasonMeta = seasonMap.get(`${state.tmdb_id}:${state.next_season}`) ?? null;
      const seasonTotal = seasonMeta?.episode_count ?? null;
      const seasonEpsBehind = seasonTotal != null ? Math.max(0, seasonTotal - (state.next_episode - 1)) : null;
      const remainingMinutes =
        runtimeResolution.minutes === null || seasonEpsBehind === null
          ? null
          : seasonEpsBehind * runtimeResolution.minutes;
      const runtimeLabel = formatEpisodeRuntimeLabel(runtimeResolution.minutes, { estimated: runtimeResolution.estimated });
      const remainingRuntimeLabel = formatRemainingRuntimeLabel(remainingMinutes, { estimated: runtimeResolution.estimated });
      const seriesRemainingMinutes = runtimeResolution.minutes === null ? null : episodesBehind * runtimeResolution.minutes;
      const seriesRemainingRuntimeLabel = formatRemainingRuntimeLabel(seriesRemainingMinutes, { estimated: runtimeResolution.estimated });

      return {
        content_id: `tv-${state.tmdb_id}`,
        tmdb_id: state.tmdb_id,
        title: title.title ?? `Série ${state.tmdb_id}`,
        original_title: title.original_title ?? null,
        poster_path: title.poster_path ?? null,
        backdrop_path: title.backdrop_path ?? null,
        computed_state: state.computed_state ?? "in_progress",
        watched_episodes: state.watched_episodes,
        aired_episodes: state.aired_episodes ?? 0,
        episodes_behind: episodesBehind,
        progress_pct: state.progress_pct ?? 0,
        next_season: state.next_season,
        next_episode: state.next_episode,
        next_episode_name: ep?.name ?? null,
        next_episode_still_path: ep?.still_path ?? null,
        next_episode_air_date: state.next_episode_air_date ?? null,
        last_watched_at: state.last_watched_at ?? null,
        remaining_minutes: remainingMinutes,
        remaining_runtime_label: remainingRuntimeLabel,
        series_remaining_minutes: seriesRemainingMinutes,
        series_remaining_runtime_label: seriesRemainingRuntimeLabel,
        status_signal: resolveSignal(episodesBehind, state.next_episode_air_date, cutoffStr),
        runtime: runtimeResolution.minutes,
        runtime_label: runtimeLabel,
        season_watched: state.next_episode - 1,
        season_total: seasonTotal,
      };
    });
    markStage("response_build");

    scheduleContinuityTitleRefresh({
      context: "continue",
      targets: states.map((state) => ({
        mediaType: "tv" as const,
        tmdbId: state.tmdb_id,
        lastSyncedAt: titleMap.get(state.tmdb_id)?.last_synced_at ?? null,
      })),
    });
    scheduleContinuitySeasonRefresh({
      context: "continue",
      targets: top.map((state) => ({
        seriesTmdbId: state.tmdb_id,
        seasonNumber: state.next_season,
        lastSyncedAt: seasonMap.get(`${state.tmdb_id}:${state.next_season}`)?.last_synced_at ?? null,
      })),
    });

    console.log("[continuity-continue/local/perf]", {
      states: states.length,
      valid: valid.length,
      returned: items.length,
      ...perf,
      total: Date.now() - totalStartedAt,
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[continuity/continue/local] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    return buildLocalContinueItems(user.id);
  } catch (err) {
    console.error("[continuity/continue] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}
