import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { formatEpisodeRuntimeLabel } from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getContinuityStateRows } from "@/server/continuity/continuity-state-cache";
import {
  scheduleContinuitySeasonRefresh,
  scheduleContinuityTitleRefresh,
} from "@/server/continuity/continuity-background-refresh";

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

export async function GET() {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  let stageStartedAt = totalStartedAt;
  const markStage = (stage: string) => {
    perf[stage] = Date.now() - stageStartedAt;
    stageStartedAt = Date.now();
  };

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    markStage("auth");

    // 1. Lê estados de TV ativos (watching + watchlist) do estado materializado
    const statesRaw = (await getContinuityStateRows(user.id)).filter(
      (state) =>
        state.media_type === "tv" &&
        (state.status === "watching" || state.status === "watchlist"),
    );
    markStage("states_read");

    if (statesRaw.length === 0) {
      console.log("[continuity-new-episodes/perf]", {
        states: 0,
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({ items: [] });
    }

    const states = statesRaw as StateRow[];

    // Filtro leve antes de ler metadados pesados: remove backlog grande que
    // nunca entraria no bloco de novidades.
    let prefilterBehindLimit = 0;
    const prefilteredStates = states.filter((state) => {
      const watched = state.watched_episodes ?? 0;
      const aired = state.aired_episodes ?? 0;
      const episodesBehind = Math.max(0, aired - watched);
      const cs = state.computed_state;

      if (cs === "in_progress") {
        if (episodesBehind > MAX_EPISODES_BEHIND) {
          prefilterBehindLimit++;
          return false;
        }

        return (
          episodesBehind > 0 &&
          state.next_season != null &&
          state.next_season > 0 &&
          state.next_episode != null &&
          state.next_episode > 0
        );
      }

      if (cs === "up_to_date" && state.status === "watching") {
        return true;
      }

      return (
        (cs === "watchlist" || state.status === "watchlist") &&
        watched === 0 &&
        aired > 0 &&
        aired <= MAX_AIRED_FOR_WATCHLIST
      );
    });
    markStage("prefilter");

    if (prefilteredStates.length === 0) {
      console.log("[continuity-new-episodes/perf]", {
        states: states.length,
        prefiltered: 0,
        returned: 0,
        external_sync: 0,
        skip_behind_limit: prefilterBehindLimit,
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({ items: [] });
    }

    const tmdbIds = prefilteredStates.map((s) => s.tmdb_id);

    // 2. Busca metadados de título em batch
    // Inclui tmdb_payload para extrair last_air_date quando a coluna direta é nula
    const { data: titlesRaw } = await supabaseAdmin
      .from("poplog3_titles")
      .select(
        "tmdb_id, title, poster_path, backdrop_path, last_air_date, runtime, episode_run_time, last_synced_at",
      )
      .in("tmdb_id", tmdbIds)
      .eq("media_type", "tv");

    const titleMap = new Map<number, TitleRow>(
      ((titlesRaw ?? []) as TitleRow[]).map((t) => [t.tmdb_id, t]),
    );
    markStage("titles_read");

    // Batch query para totais de episódios por temporada
    const { data: seasonsRaw } = await supabaseAdmin
      .from("title_seasons")
      .select("series_tmdb_id, season_number, episode_count, last_synced_at")
      .in("series_tmdb_id", tmdbIds);

    type SeasonRow = {
      series_tmdb_id: number;
      season_number: number;
      episode_count: number;
      last_synced_at: string | null;
    };
    const seasonMap = new Map<string, SeasonRow>(
      ((seasonsRaw ?? []) as SeasonRow[]).map((r) => [
        `${r.series_tmdb_id}:${r.season_number}`,
        r,
      ]),
    );
    markStage("seasons_read");

    // 3. Filtra elegíveis
    const cutoffStr = new Date(Date.now() - NEW_EPISODE_DAYS * 86_400_000)
      .toISOString()
      .slice(0, 10);

    type Eligible = StateRow &
      TitleRow & {
        effectiveNextSeason: number;
        effectiveNextEpisode: number;
        episodesBehind: number;
      };

    const eligible: Eligible[] = [];
    let skipNoTitle = 0;
    let skipBehindLimit = prefilterBehindLimit;
    let skipNoDateTrigger = 0;
    const skipOther = 0;

    for (const state of prefilteredStates) {
      const title = titleMap.get(state.tmdb_id);
      if (!title) { skipNoTitle++; continue; }

      // Resolve last_air_date: coluna direta nunca foi populada — usa tmdb_payload como fallback
      const seriesLastAirDate: string | null = title.last_air_date ?? null;

      const watched = state.watched_episodes ?? 0;
      const aired = state.aired_episodes ?? 0;
      const episodesBehind = Math.max(0, aired - watched);
      const cs = state.computed_state;

      // Série em progresso e com distância pequena — tem next_episode válido
      if (
        cs === "in_progress" &&
        episodesBehind > 0 &&
        episodesBehind <= MAX_EPISODES_BEHIND &&
        state.next_season != null &&
        state.next_season > 0 &&   // exclui temporada especial/fantasma (season 0 → TMDB 404)
        state.next_episode != null &&
        state.next_episode > 0
      ) {
        // Trigger: o próximo episódio DO USUÁRIO foi ao ar recentemente (fonte: user_title_state)
        // Fallback: last_air_date da série (quando disponível no tmdb_payload)
        const dateTrigger = state.next_episode_air_date ?? seriesLastAirDate;
        if (!dateTrigger || dateTrigger < cutoffStr) {
          skipNoDateTrigger++;
          console.log(`[continuity-new-episodes] skip tmdb_id=${state.tmdb_id} reason=date_trigger_stale cs=${cs} behind=${episodesBehind} dateTrigger=${dateTrigger} cutoff=${cutoffStr}`);
          continue;
        }

        eligible.push({
          ...state,
          ...title,
          tmdb_id: state.tmdb_id,
          effectiveNextSeason: state.next_season,
          effectiveNextEpisode: state.next_episode,
          episodesBehind,
        });
        continue;
      }

      // Watchlist ainda não iniciada com poucos episódios aired — começa por S1E1
      // Trigger: série tem episódios recentes (verifica tmdb_payload)
      // Se chegou aqui com in_progress mas episodesBehind > MAX_EPISODES_BEHIND, loga
      if (cs === "in_progress" && episodesBehind > MAX_EPISODES_BEHIND) {
        skipBehindLimit++;
        console.log(`[continuity-new-episodes] skip tmdb_id=${state.tmdb_id} reason=behind_limit cs=${cs} behind=${episodesBehind} max=${MAX_EPISODES_BEHIND}`);
      }

      if (
        (cs === "watchlist" || state.status === "watchlist") &&
        watched === 0 &&
        aired > 0 &&
        aired <= MAX_AIRED_FOR_WATCHLIST &&
        seriesLastAirDate != null &&
        seriesLastAirDate >= cutoffStr
      ) {
        eligible.push({
          ...state,
          ...title,
          tmdb_id: state.tmdb_id,
          effectiveNextSeason: 1,  // watchlist sempre começa em S01E01 — nunca 0
          effectiveNextEpisode: 1,
          episodesBehind: aired,
        });
        continue;
      }

      // up_to_date depende de next_episode_to_air do payload TMDB. Para manter
      // a tela cache-first e leve, esse enriquecimento fica fora do caminho crítico.
    }

    console.log(`[continuity-new-episodes] eligible=${eligible.length} skip_no_title=${skipNoTitle} skip_behind_limit=${skipBehindLimit} skip_no_date=${skipNoDateTrigger} skip_other=${skipOther}`);
    markStage("filtering");

    // Ordena: menos episódios por assistir primeiro, depois mais recente
    eligible.sort(
      (a, b) =>
        a.episodesBehind - b.episodesBehind ||
        (b.last_event_at ?? "").localeCompare(a.last_event_at ?? ""),
    );

    const top = eligible.slice(0, MAX_ITEMS);

    // 4. Enriquece com nome do episódio (em paralelo)
    const { data: episodesRaw } = top.length > 0
      ? await supabaseAdmin
          .from("poplog3_episodes")
          .select("series_tmdb_id, season_number, episode_number, name, still_path, air_date, runtime")
          .in("series_tmdb_id", top.map((item) => item.tmdb_id))
      : { data: [] as EpisodeMeta[] };

    const episodeMap = new Map<string, EpisodeMeta>(
      ((episodesRaw ?? []) as EpisodeMeta[])
        .filter((ep) =>
          top.some(
            (item) =>
              item.tmdb_id === ep.series_tmdb_id &&
              item.effectiveNextSeason === ep.season_number &&
              item.effectiveNextEpisode === ep.episode_number,
          ),
        )
        .map((ep) => [`${ep.series_tmdb_id}:${ep.season_number}:${ep.episode_number}`, ep]),
    );
    markStage("episodes_cache_read");

    // 5. Monta resposta
    const items: NewEpisodeItem[] = top.map((item) => {
      const ep = episodeMap.get(`${item.tmdb_id}:${item.effectiveNextSeason}:${item.effectiveNextEpisode}`) ?? null;
      const lastAirDate = item.last_air_date ?? null;
      const daysSince = lastAirDate
        ? Math.floor(
            (Date.now() - new Date(lastAirDate).getTime()) / 86_400_000,
          )
        : null;

      const runtimeResolution = resolveRuntimeByMediaType({
        mediaType: "tv",
        episodeRunTime: item.episode_run_time,
      });
      const runtimeLabel = formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
        estimated: runtimeResolution.estimated,
      });

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
        season_total:
          seasonMap.get(`${item.tmdb_id}:${item.effectiveNextSeason}`)?.episode_count ?? null,
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
        lastSyncedAt:
          seasonMap.get(`${item.tmdb_id}:${item.effectiveNextSeason}`)?.last_synced_at ?? null,
      })),
    });

    console.log("[continuity-new-episodes/perf]", {
      states: states.length,
      prefiltered: prefilteredStates.length,
      eligible: eligible.length,
      titles: titleMap.size,
      returned: items.length,
      external_sync: 0,
      skip_no_title: skipNoTitle,
      skip_behind_limit: skipBehindLimit,
      skip_no_date: skipNoDateTrigger,
      skip_other: skipOther,
      ...perf,
      total: Date.now() - totalStartedAt,
    });
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[new-episodes] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}
