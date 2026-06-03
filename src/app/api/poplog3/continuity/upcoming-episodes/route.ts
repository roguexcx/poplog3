import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getCachedEpisode } from "@/server/cache/season-cache";
import { db } from "@/server/db/client";
import { isLocalDbEnabled } from "@/server/runtime/local-db-flags";

// Horizonte máximo: episódios até N dias à frente
const MAX_DAYS_AHEAD = 90;
const MAX_ITEMS = 24;

export type UpcomingEpisodeItem = {
  content_id: string;
  tmdb_id: number;
  title: string;
  original_title?: string | null;
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
  original_title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
};

function dateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

function readNextEpisodeToAir(payload: unknown) {
  if (!payload || typeof payload !== "object") return null;
  const nextEpisode = (payload as { next_episode_to_air?: unknown }).next_episode_to_air;
  if (!nextEpisode || typeof nextEpisode !== "object") return null;
  const row = nextEpisode as {
    air_date?: unknown;
    season_number?: unknown;
    episode_number?: unknown;
  };
  return {
    airDate: typeof row.air_date === "string" ? row.air_date : null,
    seasonNumber: typeof row.season_number === "number" ? row.season_number : null,
    episodeNumber: typeof row.episode_number === "number" ? row.episode_number : null,
  };
}

async function buildLocalUpcomingEpisodeItems(userId: string) {
  const tomorrowStr = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const cutoffStr = new Date(Date.now() + MAX_DAYS_AHEAD * 86_400_000).toISOString().slice(0, 10);
  const tomorrowDate = new Date(`${tomorrowStr}T00:00:00.000Z`);
  const cutoffDate = new Date(`${cutoffStr}T00:00:00.000Z`);

  const [datedStates, upToDateStates] = await Promise.all([
    db.userTitleState.findMany({
      where: {
        userId,
        mediaType: "tv",
        status: { in: ["watching", "watchlist"] },
        nextEpisodeAirDate: { gte: tomorrowDate, lte: cutoffDate },
        nextSeason: { not: null },
        nextEpisode: { not: null },
      },
      orderBy: { nextEpisodeAirDate: "asc" },
      take: MAX_ITEMS,
    }),
    db.userTitleState.findMany({
      where: {
        userId,
        mediaType: "tv",
        status: "watching",
        computedState: "up_to_date",
      },
      select: { tmdbId: true, status: true },
      take: 100,
    }),
  ]);

  const states: StateRow[] = datedStates
    .map((state) => ({
      tmdb_id: state.tmdbId,
      status: state.status,
      next_season: state.nextSeason,
      next_episode: state.nextEpisode,
      next_episode_air_date: dateOnly(state.nextEpisodeAirDate),
    }))
    .filter((state) => (state.next_season ?? 0) > 0 && (state.next_episode ?? 0) > 0);

  const alreadyIncluded = new Set(states.map((state) => state.tmdb_id));
  const upToDateIds = upToDateStates
    .map((state) => state.tmdbId)
    .filter((tmdbId) => !alreadyIncluded.has(tmdbId));

  if (upToDateIds.length > 0) {
    const payloadRows = await db.poplog3Title.findMany({
      where: { mediaType: "tv", tmdbId: { in: upToDateIds } },
      select: { tmdbId: true, tmdbPayload: true },
    });
    const statusById = new Map(upToDateStates.map((state) => [state.tmdbId, state.status]));

    for (const row of payloadRows) {
      const nextEpisode = readNextEpisodeToAir(row.tmdbPayload);
      if (!nextEpisode?.airDate || !nextEpisode.seasonNumber || !nextEpisode.episodeNumber) {
        continue;
      }
      if (nextEpisode.airDate < tomorrowStr || nextEpisode.airDate > cutoffStr) continue;

      states.push({
        tmdb_id: row.tmdbId,
        status: statusById.get(row.tmdbId) ?? "watching",
        next_season: nextEpisode.seasonNumber,
        next_episode: nextEpisode.episodeNumber,
        next_episode_air_date: nextEpisode.airDate,
      });
    }

    states.sort((a, b) => (a.next_episode_air_date ?? "").localeCompare(b.next_episode_air_date ?? ""));
  }

  const valid = states
    .filter(
      (state): state is StateRow & {
        next_season: number;
        next_episode: number;
        next_episode_air_date: string;
      } =>
        state.next_season != null &&
        state.next_episode != null &&
        state.next_episode_air_date != null,
    )
    .slice(0, MAX_ITEMS);

  if (valid.length === 0) return [];

  const titles = await db.poplog3Title.findMany({
    where: {
      mediaType: "tv",
      tmdbId: { in: valid.map((state) => state.tmdb_id) },
    },
    select: {
      tmdbId: true,
      title: true,
      originalTitle: true,
      posterPath: true,
      backdropPath: true,
    },
  });
  const titleMap = new Map(titles.map((title) => [title.tmdbId, title]));
  const episodeData = await Promise.all(
    valid.map((state) => getCachedEpisode(state.tmdb_id, state.next_season, state.next_episode)),
  );
  const now = Date.now();

  const items: Array<UpcomingEpisodeItem | null> = valid.map((state, index) => {
      const title = titleMap.get(state.tmdb_id);
      if (!title) return null;
      const daysUntil = Math.ceil(
        (new Date(state.next_episode_air_date).getTime() - now) / 86_400_000,
      );
      const episode = episodeData[index];

      return {
        content_id: `tv-${state.tmdb_id}`,
        tmdb_id: state.tmdb_id,
        title: title.title ?? `Série ${state.tmdb_id}`,
        original_title: title.originalTitle ?? null,
        poster_path: title.posterPath ?? null,
        backdrop_path: title.backdropPath ?? null,
        status: state.status ?? "watching",
        next_season: state.next_season,
        next_episode: state.next_episode,
        next_episode_name: episode?.name ?? null,
        next_episode_still_path: episode?.still_path ?? null,
        next_episode_air_date: state.next_episode_air_date,
        days_until: daysUntil,
      } satisfies UpcomingEpisodeItem;
    });

  return items.filter((item): item is UpcomingEpisodeItem => item !== null);
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    if (isLocalDbEnabled()) {
      return NextResponse.json({ items: await buildLocalUpcomingEpisodeItems(user.id) });
    }

    // "amanhã" como limite inferior — episódios de hoje pertencem a new-episodes
    const tomorrowStr = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    const cutoffStr = new Date(Date.now() + MAX_DAYS_AHEAD * 86_400_000)
      .toISOString()
      .slice(0, 10);

    // Query 1: in_progress + watchlist com next_episode_air_date já preenchida
    const inProgressQuery = supabaseAdmin
      .from("user_title_state")
      .select("tmdb_id, status, next_season, next_episode, next_episode_air_date")
      .eq("user_id", user.id)
      .eq("media_type", "tv")
      .in("status", ["watching", "watchlist"])
      .gte("next_episode_air_date", tomorrowStr)
      .lte("next_episode_air_date", cutoffStr)
      .order("next_episode_air_date", { ascending: true })
      .limit(MAX_ITEMS);

    // Query 2: up_to_date + watching — next_episode_air_date é null no state,
    // mas tmdb_payload.next_episode_to_air pode ter episódio futuro confirmado
    const upToDateQuery = supabaseAdmin
      .from("user_title_state")
      .select("tmdb_id, status")
      .eq("user_id", user.id)
      .eq("media_type", "tv")
      .eq("status", "watching")
      .eq("computed_state", "up_to_date");

    const [{ data: statesRaw, error }, { data: upToDateRaw }] = await Promise.all([
      inProgressQuery,
      upToDateQuery,
    ]);

    if (error) {
      console.error("[upcoming-episodes] query error", {
        message: error.message,
        code: error.code,
      });
      return NextResponse.json({ items: [] });
    }

    // Filtra estados com next_season/next_episode inválidos para não tentar
    // enriquecer episódios de temporada 0 (Specials) ou dados corrompidos.
    const states = ((statesRaw ?? []) as StateRow[]).filter(
      (s) => (s.next_season ?? 0) > 0 && (s.next_episode ?? 0) > 0,
    );

    // Sintetiza StateRows para séries up_to_date usando tmdb_payload.next_episode_to_air
    if (upToDateRaw && upToDateRaw.length > 0) {
      const upToDateIds = (upToDateRaw as { tmdb_id: number; status: string | null }[]).map(
        (s) => s.tmdb_id,
      );

      const { data: payloads } = await supabaseAdmin
        .from("poplog3_titles")
        .select("tmdb_id, tmdb_payload")
        .in("tmdb_id", upToDateIds)
        .eq("media_type", "tv");

      const alreadyIncluded = new Set(states.map((s) => s.tmdb_id));

      for (const row of payloads ?? []) {
        if (alreadyIncluded.has((row as { tmdb_id: number }).tmdb_id)) continue;

        const payload = (row as { tmdb_payload: Record<string, unknown> | null }).tmdb_payload;
        const neta = payload?.next_episode_to_air as Record<string, unknown> | null | undefined;
        if (!neta) continue;

        const airDate =
          typeof neta.air_date === "string" ? neta.air_date : null;
        const seasonNum =
          typeof neta.season_number === "number" ? neta.season_number : null;
        const episodeNum =
          typeof neta.episode_number === "number" ? neta.episode_number : null;

        if (!airDate || !seasonNum || !episodeNum) continue;
        if (airDate < tomorrowStr || airDate > cutoffStr) continue;

        const upToDateEntry = upToDateRaw.find(
          (s) => (s as { tmdb_id: number }).tmdb_id === (row as { tmdb_id: number }).tmdb_id,
        ) as { tmdb_id: number; status: string | null } | undefined;

        states.push({
          tmdb_id: (row as { tmdb_id: number }).tmdb_id,
          status: upToDateEntry?.status ?? "watching",
          next_season: seasonNum,
          next_episode: episodeNum,
          next_episode_air_date: airDate,
        });
      }

      // Re-ordena por air_date após merge
      states.sort((a, b) =>
        (a.next_episode_air_date ?? "").localeCompare(b.next_episode_air_date ?? ""),
      );
    }

    if (states.length === 0) return NextResponse.json({ items: [] });

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
      .select("tmdb_id, title, original_title, poster_path, backdrop_path")
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
      .slice(0, MAX_ITEMS)
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
          original_title: title.original_title ?? null,
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
