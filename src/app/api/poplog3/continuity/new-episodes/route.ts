import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getCachedEpisode } from "@/server/cache/season-cache";
import { formatEpisodeRuntimeLabel } from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getSeriesEpisodeRuntimesMap } from "@/server/runtime/series-episode-runtimes";

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
  // tmdb_payload inclui last_air_date quando a coluna direta é nula
  tmdb_payload: Record<string, unknown> | null;
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // 1. Lê estados de TV ativos (watching + watchlist) do estado materializado
    const { data: statesRaw, error: statesError } = await supabaseAdmin
      .from("user_title_state")
      .select(
        "tmdb_id, status, computed_state, watched_episodes, aired_episodes, progress_pct, next_season, next_episode, next_episode_air_date, last_event_at",
      )
      .eq("user_id", user.id)
      .eq("media_type", "tv")
      .in("status", ["watching", "watchlist"])
      .order("last_event_at", { ascending: false });

    if (statesError) {
      console.error("[new-episodes] states query failed", {
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

    // 2. Busca metadados de título em batch
    // Inclui tmdb_payload para extrair last_air_date quando a coluna direta é nula
    const { data: titlesRaw } = await supabaseAdmin
      .from("poplog3_titles")
      .select(
        "tmdb_id, title, poster_path, backdrop_path, last_air_date, runtime, episode_run_time, tmdb_payload",
      )
      .in("tmdb_id", tmdbIds)
      .eq("media_type", "tv");

    const titleMap = new Map<number, TitleRow>(
      ((titlesRaw ?? []) as TitleRow[]).map((t) => [t.tmdb_id, t]),
    );
    const episodeRuntimesBySeries = await getSeriesEpisodeRuntimesMap(tmdbIds);

    // Batch query para totais de episódios por temporada
    const { data: seasonsRaw } = await supabaseAdmin
      .from("title_seasons")
      .select("series_tmdb_id, season_number, episode_count")
      .in("series_tmdb_id", tmdbIds);

    type SeasonRow = { series_tmdb_id: number; season_number: number; episode_count: number };
    const seasonMap = new Map<string, number>(
      ((seasonsRaw ?? []) as SeasonRow[]).map((r) => [
        `${r.series_tmdb_id}:${r.season_number}`,
        r.episode_count,
      ]),
    );

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

    for (const state of states) {
      const title = titleMap.get(state.tmdb_id);
      if (!title) continue;

      // Resolve last_air_date: coluna direta nunca foi populada — usa tmdb_payload como fallback
      const seriesLastAirDate: string | null =
        title.last_air_date ??
        (typeof title.tmdb_payload?.last_air_date === "string"
          ? title.tmdb_payload.last_air_date
          : null);

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
        state.next_episode != null
      ) {
        // Trigger: o próximo episódio DO USUÁRIO foi ao ar recentemente (fonte: user_title_state)
        // Fallback: last_air_date da série (quando disponível no tmdb_payload)
        const dateTrigger = state.next_episode_air_date ?? seriesLastAirDate;
        if (!dateTrigger || dateTrigger < cutoffStr) continue;

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
          effectiveNextSeason: 1,
          effectiveNextEpisode: 1,
          episodesBehind: aired,
        });
        continue;
      }

      // up_to_date: usuário está em dia, mas tmdb_payload indica novo episódio disponível hoje
      // Só entra se o next_episode_to_air ainda não foi assistido, verificando o ponteiro
      // do estado do usuário. Se state.next_season/next_episode não bate com o episódio
      // do payload, o usuário já assistiu (estado adiantou) — evita falso positivo após
      // assistir o último ep de uma temporada encerrada.
      if (cs === "up_to_date" && state.status === "watching") {
        const nextEpToAir = title.tmdb_payload?.next_episode_to_air as Record<string, unknown> | null | undefined;
        if (nextEpToAir) {
          const airDate = typeof nextEpToAir.air_date === "string" ? nextEpToAir.air_date : null;
          const seasonNum = typeof nextEpToAir.season_number === "number" ? nextEpToAir.season_number : null;
          const episodeNum = typeof nextEpToAir.episode_number === "number" ? nextEpToAir.episode_number : null;
          const todayStr = new Date().toISOString().slice(0, 10);
          if (airDate && seasonNum && episodeNum && airDate >= cutoffStr && airDate <= todayStr) {
            // Só exibe se o ponteiro do usuário ainda aponta para este episódio,
            // indicando que ele ainda não foi assistido.
            const userIsAhead =
              state.next_season !== seasonNum || state.next_episode !== episodeNum;
            if (userIsAhead) continue;
            eligible.push({
              ...state,
              ...title,
              tmdb_id: state.tmdb_id,
              effectiveNextSeason: seasonNum,
              effectiveNextEpisode: episodeNum,
              episodesBehind: 1,
            });
          }
        }
      }
    }

    // Ordena: menos episódios por assistir primeiro, depois mais recente
    eligible.sort(
      (a, b) =>
        a.episodesBehind - b.episodesBehind ||
        (b.last_event_at ?? "").localeCompare(a.last_event_at ?? ""),
    );

    const top = eligible.slice(0, MAX_ITEMS);

    // 4. Enriquece com nome do episódio (em paralelo)
    const epData = await Promise.all(
      top.map((item) =>
        getCachedEpisode(
          item.tmdb_id,
          item.effectiveNextSeason,
          item.effectiveNextEpisode,
        ),
      ),
    );

    // 5. Monta resposta
    const items: NewEpisodeItem[] = top.map((item, i) => {
      const ep = epData[i];
      const lastAirDate =
        item.last_air_date ??
        (typeof item.tmdb_payload?.last_air_date === "string"
          ? item.tmdb_payload.last_air_date
          : null);
      const daysSince = lastAirDate
        ? Math.floor(
            (Date.now() - new Date(lastAirDate).getTime()) / 86_400_000,
          )
        : null;

      const runtimeResolution = resolveRuntimeByMediaType({
        mediaType: "tv",
        episodeRunTime: item.episode_run_time,
        episodes: episodeRuntimesBySeries.get(item.tmdb_id) ?? null,
      });
      const runtimeLabel = formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
        estimated: runtimeResolution.estimated,
      });

      // Para up_to_date, next_episode_air_date vem do tmdb_payload
      const nextEpAirDate: string | null =
        item.next_episode_air_date ??
        (() => {
          const neta = item.tmdb_payload?.next_episode_to_air as Record<string, unknown> | null | undefined;
          return typeof neta?.air_date === "string" ? neta.air_date : null;
        })();

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
        season_total: seasonMap.get(`${item.tmdb_id}:${item.effectiveNextSeason}`) ?? null,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[new-episodes] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}
