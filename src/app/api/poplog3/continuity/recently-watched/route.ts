import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";

const MAX_ITEMS = 6;

export type RecentlyWatchedItem = {
  content_id: string;
  tmdb_id: number;
  media_type: "tv" | "movie";
  title: string;
  original_title?: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  /** Still do último episódio assistido */
  last_episode_still_path: string | null;
  /** Último episódio assistido — null para filmes */
  last_season: number | null;
  last_episode: number | null;
  last_episode_name: string | null;
  watched_at: string;
};

type EpisodeRow = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  watched_at: string;
};

type StateRow = {
  tmdb_id: number;
  media_type: "tv" | "movie";
  status: string | null;
  computed_state: string | null;
  watched_episodes: number;
  watched_keys: string[] | null;
  last_watched_at: string | null;
  last_event_at: string;
};

type TitleRow = {
  tmdb_id: number;
  media_type: "tv" | "movie";
  title: string | null;
  original_title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
};

type EpisodeMeta = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  name: string | null;
  still_path: string | null;
};

function parseEpisodeKey(key: string | null | undefined) {
  const match = /^S(\d+)E(\d+)$/i.exec(key ?? "");
  if (!match) return null;

  const season = Number(match[1]);
  const episode = Number(match[2]);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;

  return { season_number: season, episode_number: episode };
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    const { data: statesRaw, error: statesError } = await supabaseAdmin
      .from("user_title_state")
      .select(
        "tmdb_id, media_type, status, computed_state, watched_episodes, watched_keys, last_watched_at, last_event_at",
      )
      .eq("user_id", user.id)
      .or(
        [
          "status.eq.watched",
          "computed_state.eq.watched",
          "computed_state.eq.completed",
          "computed_state.eq.up_to_date",
          "watched_episodes.gt.0",
        ].join(","),
      )
      .order("last_event_at", { ascending: false })
      .limit(60);

    if (statesError) {
      console.error("[recently-watched] user_title_state error:", statesError);
      return NextResponse.json({ items: [] });
    }

    if (!statesRaw || statesRaw.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const states = (statesRaw as StateRow[])
      .map((state) => ({
        ...state,
        activity_at: state.last_watched_at ?? state.last_event_at,
      }))
      .filter((state) => Boolean(state.activity_at))
      .sort((a, b) => new Date(b.activity_at).getTime() - new Date(a.activity_at).getTime())
      .slice(0, MAX_ITEMS);

    if (states.length === 0) {
      return NextResponse.json({ items: [] });
    }

    // Busca metadados dos títulos
    const titles: TitleRow[] = [];
    for (const mediaType of ["tv", "movie"] as const) {
      const ids = states
        .filter((state) => state.media_type === mediaType)
        .map((state) => state.tmdb_id);

      if (ids.length === 0) continue;

      const { data: titlesRaw, error: titlesError } = await supabaseAdmin
        .from("poplog3_titles")
        .select("tmdb_id, media_type, title, original_title, poster_path, backdrop_path")
        .in("tmdb_id", ids)
        .eq("media_type", mediaType);

      if (titlesError) {
        console.error("[recently-watched] titles query error:", titlesError);
        continue;
      }

      titles.push(...((titlesRaw ?? []) as TitleRow[]));
    }

    const titleMap = new Map<string, TitleRow>(
      titles.map((t) => [`${t.media_type}-${t.tmdb_id}`, t]),
    );

    const tvIds = states
      .filter((state) => state.media_type === "tv")
      .map((state) => state.tmdb_id);

    const latestEpisodeMap = new Map<number, EpisodeRow>();
    if (tvIds.length > 0) {
      const { data: episodesRaw, error: epError } = await supabaseAdmin
        .from("user_episodes")
        .select("series_tmdb_id, season_number, episode_number, watched_at")
        .eq("user_id", user.id)
        .in("series_tmdb_id", tvIds)
        .order("watched_at", { ascending: false })
        .limit(tvIds.length * 10);

      if (epError) {
        console.error("[recently-watched] user_episodes error:", epError);
      } else {
        for (const ep of (episodesRaw ?? []) as EpisodeRow[]) {
          if (!latestEpisodeMap.has(ep.series_tmdb_id)) {
            latestEpisodeMap.set(ep.series_tmdb_id, ep);
          }
        }
      }
    }

    for (const state of states) {
      if (state.media_type !== "tv" || latestEpisodeMap.has(state.tmdb_id)) continue;

      const keys = Array.isArray(state.watched_keys) ? state.watched_keys : [];
      const parsed = parseEpisodeKey(keys[keys.length - 1]);
      if (!parsed) continue;

      latestEpisodeMap.set(state.tmdb_id, {
        series_tmdb_id: state.tmdb_id,
        season_number: parsed.season_number,
        episode_number: parsed.episode_number,
        watched_at: state.activity_at,
      });
    }

    const latestEpisodes = Array.from(latestEpisodeMap.values());
    const epSeriesIds = latestEpisodes.map((ep) => ep.series_tmdb_id);

    // Busca em lote — inclui still_path do episódio
    const { data: epMetaRaw } = epSeriesIds.length > 0
      ? await supabaseAdmin
          .from("poplog3_episodes")
          .select("series_tmdb_id, season_number, episode_number, name, still_path")
          .in("series_tmdb_id", epSeriesIds)
      : { data: [] as EpisodeMeta[] };

    type EpKey = `${number}:${number}:${number}`;
    const epMetaMap = new Map<EpKey, { name: string | null; still_path: string | null }>(
      ((epMetaRaw ?? []) as EpisodeMeta[]).map((e) => [
        `${e.series_tmdb_id}:${e.season_number}:${e.episode_number}` as EpKey,
        { name: e.name ?? null, still_path: e.still_path ?? null },
      ]),
    );

    const items: RecentlyWatchedItem[] = states
      .filter((state) => titleMap.has(`${state.media_type}-${state.tmdb_id}`))
      .map((state) => {
        const title = titleMap.get(`${state.media_type}-${state.tmdb_id}`)!;
        const ep = state.media_type === "tv" ? latestEpisodeMap.get(state.tmdb_id) ?? null : null;
        const epKey: EpKey | null = ep
          ? `${ep.series_tmdb_id}:${ep.season_number}:${ep.episode_number}` as EpKey
          : null;
        const epMeta = epKey ? epMetaMap.get(epKey) ?? null : null;

        return {
          content_id: `${state.media_type}-${state.tmdb_id}`,
          tmdb_id: state.tmdb_id,
          media_type: state.media_type,
          title:
            title.title ??
            (state.media_type === "tv" ? `Série ${state.tmdb_id}` : `Filme ${state.tmdb_id}`),
          original_title: title.original_title ?? null,
          poster_path: title.poster_path ?? null,
          backdrop_path: title.backdrop_path ?? null,
          last_episode_still_path: epMeta?.still_path ?? null,
          last_season: ep?.season_number ?? null,
          last_episode: ep?.episode_number ?? null,
          last_episode_name: epMeta?.name ?? null,
          watched_at: ep?.watched_at ?? state.activity_at,
        };
      });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[recently-watched] unhandled error:", err);
    return NextResponse.json({ items: [] });
  }
}
