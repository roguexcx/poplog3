import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";

const MAX_SERIES = 6;

export type RecentlyWatchedItem = {
  content_id: string;
  tmdb_id: number;
  media_type: "tv" | "movie";
  title: string;
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

type TitleRow = {
  tmdb_id: number;
  title: string | null;
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

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // Pega os últimos episódios assistidos, um por série (o mais recente)
    const { data: episodesRaw, error: epError } = await supabaseAdmin
      .from("user_episodes")
      .select("series_tmdb_id, season_number, episode_number, watched_at")
      .eq("user_id", user.id)
      .order("watched_at", { ascending: false })
      .limit(MAX_SERIES * 5); // pega mais para poder deduplicar por série

    if (epError) {
      console.error("[recently-watched] user_episodes error:", epError);
      return NextResponse.json({ items: [] });
    }

    if (!episodesRaw || episodesRaw.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const episodes = episodesRaw as EpisodeRow[];

    // Deduplica: pega apenas o episódio mais recente de cada série
    const seenSeries = new Set<number>();
    const latestPerSeries: EpisodeRow[] = [];
    for (const ep of episodes) {
      if (!seenSeries.has(ep.series_tmdb_id)) {
        seenSeries.add(ep.series_tmdb_id);
        latestPerSeries.push(ep);
      }
      if (latestPerSeries.length >= MAX_SERIES) break;
    }

    const tmdbIds = latestPerSeries.map((ep) => ep.series_tmdb_id);

    // Busca metadados dos títulos
    const { data: titlesRaw } = await supabaseAdmin
      .from("poplog3_titles")
      .select("tmdb_id, title, poster_path, backdrop_path")
      .in("tmdb_id", tmdbIds)
      .eq("media_type", "tv");

    const titleMap = new Map<number, TitleRow>(
      ((titlesRaw ?? []) as TitleRow[]).map((t) => [t.tmdb_id, t]),
    );

    // Busca nomes dos episódios
    const epKeys = latestPerSeries.map((ep) => ({
      series_tmdb_id: ep.series_tmdb_id,
      season_number: ep.season_number,
      episode_number: ep.episode_number,
    }));

    // Busca em lote — inclui still_path do episódio
    const { data: epMetaRaw } = await supabaseAdmin
      .from("poplog3_episodes")
      .select("series_tmdb_id, season_number, episode_number, name, still_path")
      .in("series_tmdb_id", tmdbIds);

    type EpKey = `${number}:${number}:${number}`;
    const epMetaMap = new Map<EpKey, { name: string | null; still_path: string | null }>(
      ((epMetaRaw ?? []) as EpisodeMeta[]).map((e) => [
        `${e.series_tmdb_id}:${e.season_number}:${e.episode_number}` as EpKey,
        { name: e.name ?? null, still_path: e.still_path ?? null },
      ]),
    );

    const items: RecentlyWatchedItem[] = latestPerSeries
      .filter((ep) => titleMap.has(ep.series_tmdb_id))
      .map((ep) => {
        const title = titleMap.get(ep.series_tmdb_id)!;
        const epKey: EpKey = `${ep.series_tmdb_id}:${ep.season_number}:${ep.episode_number}`;
        const epMeta = epMetaMap.get(epKey) ?? null;
        return {
          content_id: `tv-${ep.series_tmdb_id}`,
          tmdb_id: ep.series_tmdb_id,
          media_type: "tv" as const,
          title: title.title ?? `Série ${ep.series_tmdb_id}`,
          poster_path: title.poster_path ?? null,
          backdrop_path: title.backdrop_path ?? null,
          last_episode_still_path: epMeta?.still_path ?? null,
          last_season: ep.season_number,
          last_episode: ep.episode_number,
          last_episode_name: epMeta?.name ?? null,
          watched_at: ep.watched_at,
        };
      });

    // Descarta séries sem título no catálogo
    void epKeys; // usado implicitamente via epMetaMap
    return NextResponse.json({ items });
  } catch (err) {
    console.error("[recently-watched] unhandled error:", err);
    return NextResponse.json({ items: [] });
  }
}
