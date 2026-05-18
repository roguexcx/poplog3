import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getCachedEpisode } from "@/server/cache/season-cache";

// Horizonte máximo: episódios até N dias à frente
const MAX_DAYS_AHEAD = 90;
const MAX_ITEMS = 24;

export type UpcomingEpisodeItem = {
  content_id: string;
  tmdb_id: number;
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  status: string;
  next_season: number;
  next_episode: number;
  next_episode_name: string | null;
  next_episode_still_path: string | null;
  next_episode_air_date: string; // ISO date, sempre no futuro
  days_until: number;
};

type StateRow = {
  tmdb_id: number;
  status: string | null;
  next_season: number | null;
  next_episode: number | null;
  next_episode_air_date: string | null;
};

type TitleRow = {
  tmdb_id: number;
  title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
};

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // "amanhã" como limite inferior — episódios de hoje pertencem a new-episodes
    const tomorrowStr = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const cutoffStr = new Date(Date.now() + MAX_DAYS_AHEAD * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const { data: statesRaw, error } = await supabaseAdmin
      .from("user_title_state")
      .select("tmdb_id, status, next_season, next_episode, next_episode_air_date")
      .eq("user_id", user.id)
      .eq("media_type", "tv")
      .in("status", ["watching", "watchlist"])
      .gte("next_episode_air_date", tomorrowStr)
      .lte("next_episode_air_date", cutoffStr)
      .order("next_episode_air_date", { ascending: true })
      .limit(MAX_ITEMS);

    if (error) {
      console.error("[upcoming-episodes] query error", {
        message: error.message,
        code: error.code,
      });
      return NextResponse.json({ items: [] });
    }

    if (!statesRaw || statesRaw.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const states = statesRaw as StateRow[];

    // Filtra os que têm todos os campos necessários
    const valid = states.filter(
      (s): s is StateRow & {
        next_season: number;
        next_episode: number;
        next_episode_air_date: string;
      } =>
        s.next_season != null &&
        s.next_episode != null &&
        s.next_episode_air_date != null,
    );

    if (valid.length === 0) return NextResponse.json({ items: [] });

    const tmdbIds = valid.map((s) => s.tmdb_id);

    const { data: titlesRaw } = await supabaseAdmin
      .from("poplog3_titles")
      .select("tmdb_id, title, poster_path, backdrop_path")
      .in("tmdb_id", tmdbIds)
      .eq("media_type", "tv");

    const titleMap = new Map<number, TitleRow>(
      ((titlesRaw ?? []) as TitleRow[]).map((t) => [t.tmdb_id, t]),
    );

    // Enriquece com nome do episódio (em paralelo)
    const epData = await Promise.all(
      valid.map((s) =>
        getCachedEpisode(s.tmdb_id, s.next_season, s.next_episode),
      ),
    );

    const now = Date.now();

    const items: UpcomingEpisodeItem[] = valid
      .map((s, i) => {
        const title = titleMap.get(s.tmdb_id);
        if (!title) return null;

        const ep = epData[i];
        const daysUntil = Math.ceil(
          (new Date(s.next_episode_air_date).getTime() - now) / 86_400_000,
        );

        return {
          content_id: `tv-${s.tmdb_id}`,
          tmdb_id: s.tmdb_id,
          title: title.title ?? `Série ${s.tmdb_id}`,
          poster_path: title.poster_path ?? null,
          backdrop_path: title.backdrop_path ?? null,
          status: s.status ?? "watching",
          next_season: s.next_season,
          next_episode: s.next_episode,
          next_episode_name: ep?.name ?? null,
          next_episode_still_path: ep?.still_path ?? null,
          next_episode_air_date: s.next_episode_air_date,
          days_until: daysUntil,
        } satisfies UpcomingEpisodeItem;
      })
      .filter(Boolean) as UpcomingEpisodeItem[];

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[upcoming-episodes] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}
