/**
 * GET /api/debug/local-db/acompanhando-diff
 *
 * Ferramenta de diagnóstico: compara o payload do GET /api/poplog3/acompanhando
 * entre o caminho Supabase (atual) e o caminho local Prisma/MySQL.
 *
 * Uso local:
 *   curl http://localhost:3000/api/debug/local-db/acompanhando-diff
 *
 * Requer: autenticação válida (session cookie) + POPLOG_LOCAL_ACOMPANHANDO_ENABLED não precisa
 * estar ligada — o diff executa os dois caminhos independentemente.
 *
 * Não expõe dados de outros usuários — opera somente com o userId autenticado.
 */

import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";

type DiffField<T> = { match: boolean; local: T; supabase: T };

function diffField<T>(local: T, supabase: T): DiffField<T> {
  return { match: local === supabase, local, supabase };
}

function nullableDiffField<T>(local: T | null | undefined, supabase: T | null | undefined): DiffField<T | null> {
  const l = local ?? null;
  const s = supabase ?? null;
  return { match: l === s, local: l, supabase: s };
}

// ─── Tipos locais mínimos para comparação ────────────────────────────────────

type ItemSnapshot = {
  content_id: string;
  status: string | null;
  current_season: number | null;
  current_episode: number | null;
  total_seasons: number | null;
  episodes_watched: number | null;
  next_episode_name: string | null;
  next_episode_air_date: string | null;
  new_episode_available: boolean;
  streaming_platform: string | null;
  available_on_vod: boolean;
  snoozed_until: string | null;
  snooze_count: number;
  genres_count: number;
  year: number | null;
  tmdb_id?: number;
  media_type?: string;
};

// ─── Caminho Supabase ─────────────────────────────────────────────────────────

async function fetchSupabaseItems(userId: string): Promise<ItemSnapshot[]> {
  const { data: rawUserTitles, error } = await supabaseAdmin
    .from("user_titles")
    .select("id, tmdb_id, media_type, status, created_at, watched_at")
    .eq("user_id", userId)
    .in("status", ["watching", "watchlist", "abandoned", "fridge"])
    .order("created_at", { ascending: false })
    .limit(120);

  if (error || !rawUserTitles?.length) return [];

  const tmdbIds = rawUserTitles.map((r: Record<string, unknown>) => r.tmdb_id as number);
  const mediaTypeValues = [...new Set(rawUserTitles.map((r: Record<string, unknown>) => r.media_type as string))];

  const { data: titlesData } = await supabaseAdmin
    .from("poplog3_titles")
    .select("tmdb_id, media_type, number_of_seasons, genres, year")
    .in("tmdb_id", tmdbIds)
    .in("media_type", mediaTypeValues);

  const titleMap = new Map<string, Record<string, unknown>>(
    ((titlesData ?? []) as Record<string, unknown>[]).map((t) => [
      `${t.tmdb_id}:${t.media_type}`,
      t,
    ]),
  );

  const seriesIds = rawUserTitles
    .filter((r: Record<string, unknown>) => r.media_type === "tv")
    .map((r: Record<string, unknown>) => r.tmdb_id as number);

  const contentIds = rawUserTitles.map(
    (r: Record<string, unknown>) => `tmdb-${r.media_type}-${r.tmdb_id}`,
  );

  const [userEpisodesResult, overlayResult] = await Promise.all([
    seriesIds.length > 0
      ? supabaseAdmin
          .from("user_episodes")
          .select("series_tmdb_id, season_number, episode_number, watched_at")
          .eq("user_id", userId)
          .in("series_tmdb_id", seriesIds)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("user_curadoria_state")
      .select("content_id, snoozed_until, snooze_count")
      .eq("user_id", userId)
      .in("content_id", contentIds),
  ]);

  const watchedBySeries = new Map<number, Array<{ season: number; episode: number }>>();
  for (const ep of (userEpisodesResult.data ?? []) as Array<{ series_tmdb_id: number; season_number: number; episode_number: number }>) {
    const list = watchedBySeries.get(ep.series_tmdb_id) ?? [];
    list.push({ season: ep.season_number, episode: ep.episode_number });
    watchedBySeries.set(ep.series_tmdb_id, list);
  }

  const overlayMap = new Map<string, { snoozed_until: string | null; snooze_count: number }>(
    ((overlayResult.data ?? []) as Array<{ content_id: string; snoozed_until: string | null; snooze_count: number | null }>).map(
      (ov) => [ov.content_id, { snoozed_until: ov.snoozed_until, snooze_count: ov.snooze_count ?? 0 }],
    ),
  );

  return rawUserTitles
    .map((ut: Record<string, unknown>) => {
      const title = titleMap.get(`${ut.tmdb_id}:${ut.media_type}`);
      if (!title) return null;
      const contentId = `tmdb-${ut.media_type}-${ut.tmdb_id}`;
      const overlay = overlayMap.get(contentId);
      const watched = watchedBySeries.get(ut.tmdb_id as number) ?? [];
      const sorted = [...watched].sort((a, b) =>
        a.season !== b.season ? a.season - b.season : a.episode - b.episode,
      );
      const last = sorted.at(-1);
      const watchedSet = new Set(watched.map((ep) => `${ep.season}:${ep.episode}`));

      const genres = Array.isArray(title.genres) ? title.genres : [];

      return {
        content_id: contentId,
        status: ut.status as string,
        current_season: last?.season ?? null,
        current_episode: last?.episode ?? null,
        total_seasons: (title.number_of_seasons as number | null) ?? null,
        episodes_watched: watched.length > 0 ? watched.length : null,
        next_episode_name: null,
        next_episode_air_date: null,
        new_episode_available: false,
        streaming_platform: null,
        available_on_vod: false,
        snoozed_until: overlay?.snoozed_until ?? null,
        snooze_count: overlay?.snooze_count ?? 0,
        genres_count: genres.length,
        year: (title.year as number | null) ?? null,
        tmdb_id: ut.tmdb_id as number,
        media_type: ut.media_type as string,
        _watchedSet: watchedSet,
      } as ItemSnapshot & { _watchedSet: Set<string> };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

// ─── Caminho local Prisma ─────────────────────────────────────────────────────

async function fetchLocalItems(userId: string): Promise<ItemSnapshot[]> {
  const { db } = await import("@/server/db/client");

  const userTitleRows = await db.userTitle.findMany({
    where: { userId, status: { in: ["watching", "watchlist", "abandoned", "fridge"] } },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  if (userTitleRows.length === 0) return [];

  const tmdbIds = userTitleRows.map((r) => r.tmdbId);
  const seriesIds = [
    ...new Set(userTitleRows.filter((r) => r.mediaType === "tv").map((r) => r.tmdbId)),
  ];
  const contentIds = userTitleRows.map((r) => `tmdb-${r.mediaType}-${r.tmdbId}`);

  const [titleRows, watchedRows, overlayRows] = await Promise.all([
    db.poplog3Title.findMany({
      where: { tmdbId: { in: tmdbIds } },
      select: { tmdbId: true, mediaType: true, numberOfSeasons: true, genres: true, year: true },
    }),
    seriesIds.length > 0
      ? db.userEpisode.findMany({
          where: { userId, seriesTmdbId: { in: seriesIds } },
          select: { seriesTmdbId: true, seasonNumber: true, episodeNumber: true },
        })
      : Promise.resolve([]),
    db.userCuradoriaState.findMany({
      where: { userId, contentId: { in: contentIds } },
      select: { contentId: true, snoozedUntil: true, snoozeCount: true },
    }),
  ]);

  const titleMap = new Map(titleRows.map((t) => [`${t.tmdbId}:${t.mediaType}`, t]));

  const watchedBySeries = new Map<number, Array<{ season: number; episode: number }>>();
  for (const ep of watchedRows) {
    const list = watchedBySeries.get(ep.seriesTmdbId) ?? [];
    list.push({ season: ep.seasonNumber, episode: ep.episodeNumber });
    watchedBySeries.set(ep.seriesTmdbId, list);
  }

  const overlayMap = new Map(
    overlayRows.map((ov) => [
      ov.contentId,
      { snoozed_until: ov.snoozedUntil ? ov.snoozedUntil.toISOString() : null, snooze_count: ov.snoozeCount },
    ]),
  );

  return userTitleRows
    .map((ut) => {
      const title = titleMap.get(`${ut.tmdbId}:${ut.mediaType}`);
      if (!title) return null;
      const contentId = `tmdb-${ut.mediaType}-${ut.tmdbId}`;
      const overlay = overlayMap.get(contentId);
      const watched = watchedBySeries.get(ut.tmdbId) ?? [];
      const sorted = [...watched].sort((a, b) =>
        a.season !== b.season ? a.season - b.season : a.episode - b.episode,
      );
      const last = sorted.at(-1);

      const genres = Array.isArray(title.genres) ? title.genres : [];

      return {
        content_id: contentId,
        status: ut.status as string,
        current_season: last?.season ?? null,
        current_episode: last?.episode ?? null,
        total_seasons: title.numberOfSeasons ?? null,
        episodes_watched: watched.length > 0 ? watched.length : null,
        next_episode_name: null,
        next_episode_air_date: null,
        new_episode_available: false,
        streaming_platform: null,
        available_on_vod: false,
        snoozed_until: overlay?.snoozed_until ?? null,
        snooze_count: overlay?.snooze_count ?? 0,
        genres_count: genres.length,
        year: title.year ?? null,
        tmdb_id: ut.tmdbId,
        media_type: ut.mediaType as string,
      } as ItemSnapshot;
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);
}

// ─── GET handler ──────────────────────────────────────────────────────────────

export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let localItems: ItemSnapshot[] = [];
  let supabaseItems: ItemSnapshot[] = [];
  let localError: string | null = null;
  let supabaseError: string | null = null;

  [
    { result: localItems, err: localError },
    { result: supabaseItems, err: supabaseError },
  ] = await Promise.all([
    fetchLocalItems(user.id)
      .then((r) => ({ result: r, err: null }))
      .catch((e) => ({ result: [] as ItemSnapshot[], err: e instanceof Error ? e.message : String(e) })),
    fetchSupabaseItems(user.id)
      .then((r) => ({ result: r, err: null }))
      .catch((e) => ({ result: [] as ItemSnapshot[], err: e instanceof Error ? e.message : String(e) })),
  ]);

  const localById = new Map(localItems.map((i) => [i.content_id, i]));
  const supabaseById = new Map(supabaseItems.map((i) => [i.content_id, i]));

  const allContentIds = new Set([
    ...localItems.map((i) => i.content_id),
    ...supabaseItems.map((i) => i.content_id),
  ]);

  const onlyInLocal = localItems
    .filter((i) => !supabaseById.has(i.content_id))
    .map((i) => i.content_id);
  const onlyInSupabase = supabaseItems
    .filter((i) => !localById.has(i.content_id))
    .map((i) => i.content_id);

  const itemDiffs = Array.from(allContentIds)
    .map((contentId) => {
      const l = localById.get(contentId);
      const s = supabaseById.get(contentId);
      if (!l || !s) return null;

      const fields = {
        status: diffField(l.status, s.status),
        current_season: nullableDiffField(l.current_season, s.current_season),
        current_episode: nullableDiffField(l.current_episode, s.current_episode),
        total_seasons: nullableDiffField(l.total_seasons, s.total_seasons),
        episodes_watched: nullableDiffField(l.episodes_watched, s.episodes_watched),
        new_episode_available: diffField(l.new_episode_available, s.new_episode_available),
        streaming_platform: nullableDiffField(l.streaming_platform, s.streaming_platform),
        available_on_vod: diffField(l.available_on_vod, s.available_on_vod),
        snoozed_until: nullableDiffField(
          l.snoozed_until ? l.snoozed_until.slice(0, 10) : null,
          s.snoozed_until ? s.snoozed_until.slice(0, 10) : null,
        ),
        snooze_count: diffField(l.snooze_count, s.snooze_count),
        genres_count: diffField(l.genres_count, s.genres_count),
        year: nullableDiffField(l.year, s.year),
      };

      const hasAnyMismatch = Object.values(fields).some((f) => !f.match);

      return {
        content_id: contentId,
        tmdb_id: l.tmdb_id,
        media_type: l.media_type,
        match: !hasAnyMismatch,
        fields,
      };
    })
    .filter((d): d is NonNullable<typeof d> => d !== null);

  const mismatchCount = itemDiffs.filter((d) => !d.match).length;
  const matchCount = itemDiffs.filter((d) => d.match).length;

  return NextResponse.json({
    ok: true,
    summary: {
      local_total: localItems.length,
      supabase_total: supabaseItems.length,
      total_mismatch: localItems.length !== supabaseItems.length,
      only_in_local: onlyInLocal.length,
      only_in_supabase: onlyInSupabase.length,
      item_matches: matchCount,
      item_mismatches: mismatchCount,
      local_error: localError,
      supabase_error: supabaseError,
    },
    only_in_local: onlyInLocal,
    only_in_supabase: onlyInSupabase,
    items: itemDiffs,
  });
}
