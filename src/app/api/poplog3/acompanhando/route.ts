import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getUserTitleStatus, upsertUserTitleStatus } from "@/server/library/library-service";
import { isValidSeason, mapSeriesStatus } from "@/lib/series";
import {
  isLocalCuradoriaEnabled,
  isLocalUserPreferencesEnabled,
} from "@/server/runtime/local-db-flags";
import type {
  ContentType,
  SignalType,
  UserWatching,
  WatchStatus,
} from "@/components/HeroSpotlight/types";

type MediaType = "movie" | "tv";

type ParsedContentId = {
  contentId: string;
  tmdbId: number;
  mediaType: MediaType;
  contentType: ContentType;
};

type DbUserTitle = {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: string;
  rating: number | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
  title: DbTitleMeta | null;
};

type DbTitleMeta = {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  original_title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  year: number | null;
  runtime: number | null;
  episode_run_time: number[] | null;
  vote_average: number | null;
  genres: unknown;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  tmdb_payload: Record<string, unknown> | null;
};

type DbUserEpisode = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  watched_at: string;
  runtime_minutes: number | null;
};

type DbEpisode = {
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  name: string | null;
  air_date: string | null;
  runtime: number | null;
  still_path: string | null;
};

type DbCuradoriaOverlay = {
  content_id: string;
  snoozed_until: string | null;
  snooze_count: number | null;
  hero_shown_count: number | null;
  hero_last_shown_at: string | null;
  dominant_color: string | null;
  rediscovery_eligible: boolean | null;
  new_episode_available: boolean | null;
  new_episode_available_since: string | null;
  streaming_platform: string | null;
  streaming_available_since: string | null;
  available_on_vod: boolean | null;
  vod_available_since: string | null;
};

type CuradoriaPreferencesResult = {
  data: unknown;
  error: { message: string } | null;
};

type AvailabilityOverlay = {
  streaming_platform: string | null;
  streaming_available_since: string | null;
  available_on_vod: boolean;
  vod_available_since: string | null;
};

type CuradoriaPostBody =
  | {
      action: "snooze";
      contentId: string;
      durationHours?: number;
    }
  | {
      action: "log_signal";
      contentId: string;
      signal: SignalType;
      value?: Record<string, unknown> | null;
    }
  | {
      action: "mark_watched";
      contentId: string;
    };

const LIBRARY_TO_WATCH_STATUS: Record<string, WatchStatus | null> = {
  watching: "watching",
  watchlist: "watchlist",
  abandoned: "abandoned",
  fridge: "paused",
  watched: null,
};

const VALID_SIGNALS: SignalType[] = [
  "watched_episode",
  "snoozed",
  "clicked_hero",
  "clicked_not_now",
  "finished",
  "abandoned",
  "added_watchlist",
  "removed_watchlist",
  "rated",
];

function parseContentId(contentId: string): ParsedContentId | null {
  const match = /^tmdb-(movie|tv)-(\d+)$/.exec(contentId);

  if (!match) return null;

  const mediaType = match[1] as MediaType;
  const tmdbId = Number(match[2]);

  if (!Number.isFinite(tmdbId) || tmdbId <= 0) return null;

  return {
    contentId,
    tmdbId,
    mediaType,
    contentType: mediaType === "tv" ? "serie" : "filme",
  };
}

function normalizeGenres(genres: unknown): string[] {
  if (!Array.isArray(genres)) return [];

  return genres
    .map((genre) => {
      if (typeof genre === "string") return genre;

      if (
        genre &&
        typeof genre === "object" &&
        "name" in genre &&
        typeof genre.name === "string"
      ) {
        return genre.name;
      }

      return null;
    })
    .filter((genre): genre is string => Boolean(genre));
}

function getAverageEpisodeRuntime(meta: DbTitleMeta) {
  if (Array.isArray(meta.episode_run_time) && meta.episode_run_time.length > 0) {
    return meta.episode_run_time[0] ?? null;
  }

  return null;
}

function toContentId(mediaType: MediaType, tmdbId: number) {
  return `tmdb-${mediaType}-${tmdbId}`;
}

async function getLocalUserPreferencesService() {
  return import("@/server/local-services/user-preferences-local.service");
}

async function getLocalCuradoriaService() {
  return import("@/server/local-services/curadoria-local.service");
}

function extractCollection(
  meta: DbTitleMeta
): { id: number; name: string; poster_path: string | null } | null {
  const c = meta.tmdb_payload?.belongs_to_collection;
  if (!c || typeof c !== "object") return null;
  const col = c as { id?: unknown; name?: unknown; poster_path?: unknown };
  if (typeof col.id !== "number" || typeof col.name !== "string") return null;
  return {
    id: col.id,
    name: col.name,
    poster_path: typeof col.poster_path === "string" ? col.poster_path : null,
  };
}

function sortEpisodes<T extends { season_number: number; episode_number: number }>(
  episodes: T[]
) {
  return [...episodes].sort((a, b) => {
    if (a.season_number !== b.season_number) {
      return a.season_number - b.season_number;
    }

    return a.episode_number - b.episode_number;
  });
}

function getValidSeasonNumbers(meta: DbTitleMeta): Set<number> {
  const seasons = meta.tmdb_payload?.seasons;
  if (!Array.isArray(seasons) || seasons.length === 0) return new Set();

  const valid = new Set<number>();
  for (const s of seasons) {
    if (typeof s !== "object" || !s) continue;
    const season = s as {
      season_number?: number | null;
      air_date?: string | null;
      name?: string | null;
      poster_path?: string | null;
      overview?: string | null;
    };
    if (isValidSeason(season)) {
      valid.add(season.season_number!);
    }
  }

  return valid;
}

function getEpisodeContext({
  meta,
  watchedEpisodes,
  episodeRows,
  overlay,
}: {
  meta: DbTitleMeta;
  watchedEpisodes: DbUserEpisode[];
  episodeRows: DbEpisode[];
  overlay?: DbCuradoriaOverlay;
}) {
  const watchedSet = new Set(
    watchedEpisodes.map((ep) => `${ep.season_number}:${ep.episode_number}`)
  );

  const sortedWatched = sortEpisodes(watchedEpisodes);
  const lastWatched = sortedWatched.at(-1) ?? null;

  const validSeasonNums = getValidSeasonNumbers(meta);

  const validEpisodeRows = sortEpisodes(
    episodeRows.filter(
      (ep) =>
        ep.season_number > 0 &&
        ep.episode_number > 0 &&
        (validSeasonNums.size === 0 || validSeasonNums.has(ep.season_number))
    )
  );

  const nextEpisode =
    validEpisodeRows.find(
      (ep) => !watchedSet.has(`${ep.season_number}:${ep.episode_number}`)
    ) ?? null;

  const currentSeason =
    nextEpisode?.season_number ?? lastWatched?.season_number ?? null;

  const currentEpisode = nextEpisode
    ? Math.max(nextEpisode.episode_number - 1, 0)
    : lastWatched?.episode_number ?? null;

  const episodesInCurrentSeason = currentSeason
    ? validEpisodeRows.filter((ep) => ep.season_number === currentSeason)
    : [];

  const totalEpisodesSeason =
    episodesInCurrentSeason.length > 0 ? episodesInCurrentSeason.length : null;

  const episodesWatchedInSeason = currentSeason
    ? watchedEpisodes.filter((ep) => ep.season_number === currentSeason).length
    : watchedEpisodes.length;

  const nextEpisodeDate = nextEpisode?.air_date ?? null;
  const today = new Date();
  today.setHours(23, 59, 59, 999);

  const isNextEpisodeAired = nextEpisodeDate
    ? new Date(nextEpisodeDate).getTime() <= today.getTime()
    : false;

  return {
    currentSeason,
    currentEpisode,
    totalEpisodesSeason,
    episodesWatched: episodesWatchedInSeason,
    nextEpisodeName: nextEpisode?.name ?? null,
    nextEpisodeDuration:
      nextEpisode?.runtime ??
      lastWatched?.runtime_minutes ??
      getAverageEpisodeRuntime(meta),
    nextEpisodeAirDate: nextEpisodeDate,
    nextEpisodeStillPath: nextEpisode?.still_path ?? null,
    newEpisodeAvailable: overlay?.new_episode_available ?? isNextEpisodeAired,
    newEpisodeAvailableSince:
      overlay?.new_episode_available_since ??
      (isNextEpisodeAired ? nextEpisodeDate : null),
  };
}

async function getOverlayBase(userId: string, parsed: ParsedContentId) {
  const [userRow, titleRow] = await Promise.all([
    supabaseAdmin
      .from("user_titles")
      .select("status, created_at")
      .eq("user_id", userId)
      .eq("tmdb_id", parsed.tmdbId)
      .eq("media_type", parsed.mediaType)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("poplog3_titles")
      .select("title, original_title, poster_path, backdrop_path, year, runtime, episode_run_time, vote_average, genres, number_of_seasons, number_of_episodes, tmdb_payload")
      .eq("tmdb_id", parsed.tmdbId)
      .eq("media_type", parsed.mediaType)
      .maybeSingle(),
  ]);

  if (userRow.error) throw new Error(userRow.error.message);
  if (titleRow.error) throw new Error(titleRow.error.message);

  if (!userRow.data || !titleRow.data) {
    throw new Error("Título não encontrado na biblioteca.");
  }

  const status = (userRow.data as Record<string, unknown>).status as string;
  const createdAt = (userRow.data as Record<string, unknown>).created_at as string;
  const meta = titleRow.data as unknown as DbTitleMeta;

  return {
    user_id: userId,
    content_id: parsed.contentId,
    content_type: parsed.contentType,
    title: meta.title ?? "Sem título",
    poster_path: meta.poster_path ?? null,
    backdrop_path: meta.backdrop_path ?? null,
    status: LIBRARY_TO_WATCH_STATUS[status] ?? "watching",
    runtime: meta.runtime ?? null,
    tmdb_rating: meta.vote_average ?? null,
    user_rating: null,
    added_to_watchlist_at: createdAt ?? null,
    started_at: null,
    finished_at: null,
    genres: normalizeGenres(meta.genres),
    year: meta.year ?? null,
    updated_at: new Date().toISOString(),
  };
}

async function upsertCuradoriaOverlay(
  userId: string,
  parsed: ParsedContentId,
  patch: Record<string, unknown>
) {
  const base = await getOverlayBase(userId, parsed);

  const { error } = await supabaseAdmin.from("user_curadoria_state").upsert(
    {
      ...base,
      ...patch,
    },
    {
      onConflict: "user_id,content_id",
    }
  );

  if (error) throw new Error(error.message);
}

async function logCuradoriaSignal(
  userId: string,
  contentId: string,
  signal: SignalType,
  value?: object | null
) {
  if (!VALID_SIGNALS.includes(signal)) {
    throw new Error("Sinal de curadoria inválido.");
  }

  const { error } = await supabaseAdmin
    .from("user_curadoria_signals")
    .insert({
      user_id: userId,
      content_id: contentId,
      signal_type: signal,
      signal_value: value ?? null,
    });

  if (error) throw new Error(error.message);
}

async function readCuradoriaPreference(userId: string): Promise<CuradoriaPreferencesResult> {
  if (isLocalUserPreferencesEnabled()) {
    try {
      const local = await getLocalUserPreferencesService();
      return {
        data: await local.getUserPreferences(userId),
        error: null,
      };
    } catch (error) {
      return {
        data: null,
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  const result = await supabaseAdmin
    .from("user_curadoria_preferences")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  return {
    data: result.data ?? null,
    error: result.error ? { message: result.error.message } : null,
  };
}

async function logLocalCuradoriaAction(input: {
  userId: string;
  parsed: ParsedContentId;
  signal: SignalType;
  value?: Record<string, unknown> | null;
}) {
  if (!VALID_SIGNALS.includes(input.signal)) {
    throw new Error("Sinal de curadoria inválido.");
  }

  const local = await getLocalCuradoriaService();
  await local.logCuradoriaSignal(
    input.userId,
    input.parsed.contentId,
    input.signal,
    input.value ?? null,
  );
  await local.logUserActionEvent({
    userId: input.userId,
    tmdbId: input.parsed.tmdbId,
    mediaType: input.parsed.mediaType,
    eventType: `curadoria_${input.signal}`,
    payload: {
      contentId: input.parsed.contentId,
      signal: input.signal,
      value: input.value ?? null,
    },
  });
}

export async function GET() {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const { data: rawUserTitles, error } = await supabaseAdmin
    .from("user_titles")
    .select("id, user_id, tmdb_id, media_type, status, created_at, watched_at")
    .eq("user_id", user.id)
    .in("status", ["watching", "watchlist", "abandoned", "fridge"])
    .order("created_at", { ascending: false })
    .limit(120);

  if (error) {
    console.error("[acompanhando] user_titles query error:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const rawRows = (rawUserTitles ?? []) as Array<Record<string, unknown>>;

  // Busca metadados dos títulos em lote
  const tmdbIds = rawRows.map((r) => r.tmdb_id as number);
  const mediaTypeValues = [...new Set(rawRows.map((r) => r.media_type as string))];

  let titlesMetaMap = new Map<string, DbTitleMeta>();
  if (tmdbIds.length > 0) {
    const { data: titlesData } = await supabaseAdmin
      .from("poplog3_titles")
      .select("tmdb_id, media_type, title, original_title, poster_path, backdrop_path, year, runtime, episode_run_time, vote_average, genres, number_of_seasons, number_of_episodes, tmdb_payload")
      .in("tmdb_id", tmdbIds)
      .in("media_type", mediaTypeValues);

    titlesMetaMap = new Map(
      ((titlesData ?? []) as unknown as DbTitleMeta[]).map((t) => [
        `${t.tmdb_id}:${t.media_type}`,
        t,
      ])
    );
  }

  const userTitles: DbUserTitle[] = rawRows
    .map((row) => {
      const meta = titlesMetaMap.get(`${row.tmdb_id}:${row.media_type}`) ?? null;
      if (!meta) return null;
      return {
        id: row.id as string,
        user_id: row.user_id as string,
        tmdb_id: row.tmdb_id as number,
        media_type: row.media_type as MediaType,
        status: row.status as string,
        rating: null,
        started_at: null,
        finished_at: null,
        created_at: row.created_at as string,
        updated_at: (row.watched_at as string | null) ?? (row.created_at as string),
        title: meta,
      } as DbUserTitle;
    })
    .filter((r): r is DbUserTitle => r !== null);

  const seriesIds = userTitles
    .filter((ut) => ut.media_type === "tv")
    .map((ut) => ut.tmdb_id);

  const contentIds = userTitles.map((ut) =>
    toContentId(ut.media_type, ut.tmdb_id)
  );

  const [
    preferencesResult,
    userEpisodesResult,
    episodeRowsResult,
    overlayResult,
  ] = await Promise.all([
    readCuradoriaPreference(user.id),

    seriesIds.length > 0
      ? supabaseAdmin
          .from("user_episodes")
          .select(
            "series_tmdb_id, season_number, episode_number, watched_at, runtime_minutes"
          )
          .eq("user_id", user.id)
          .in("series_tmdb_id", seriesIds)
      : Promise.resolve({ data: [], error: null }),

    seriesIds.length > 0
      ? supabaseAdmin
          .from("poplog3_episodes")
          .select(
            "series_tmdb_id, season_number, episode_number, name, air_date, runtime, still_path"
          )
          .in("series_tmdb_id", seriesIds)
      : Promise.resolve({ data: [], error: null }),

    contentIds.length > 0
      ? supabaseAdmin
          .from("user_curadoria_state")
          .select(
            `
            content_id,
            snoozed_until,
            snooze_count,
            hero_shown_count,
            hero_last_shown_at,
            dominant_color,
            rediscovery_eligible,
            new_episode_available,
            new_episode_available_since,
            streaming_platform,
            streaming_available_since,
            available_on_vod,
            vod_available_since
          `
          )
          .eq("user_id", user.id)
          .in("content_id", contentIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (preferencesResult.error) {
    console.error(
      "[acompanhando] user_curadoria_preferences error:",
      preferencesResult.error
    );
  }

  if (userEpisodesResult.error) {
    console.error(
      "[acompanhando] user_episodes error:",
      userEpisodesResult.error
    );
  }

  if (episodeRowsResult.error) {
    console.error(
      "[acompanhando] poplog3_episodes error:",
      episodeRowsResult.error
    );
  }

  if (overlayResult.error) {
    console.error(
      "[acompanhando] user_curadoria_state error:",
      overlayResult.error
    );
  }

  const watchedBySeries = new Map<number, DbUserEpisode[]>();
  for (const ep of (userEpisodesResult.data ?? []) as DbUserEpisode[]) {
    const list = watchedBySeries.get(ep.series_tmdb_id) ?? [];
    list.push(ep);
    watchedBySeries.set(ep.series_tmdb_id, list);
  }

  const episodesBySeries = new Map<number, DbEpisode[]>();
  for (const ep of (episodeRowsResult.data ?? []) as DbEpisode[]) {
    const list = episodesBySeries.get(ep.series_tmdb_id) ?? [];
    list.push(ep);
    episodesBySeries.set(ep.series_tmdb_id, list);
  }

  const overlayByContentId = new Map<string, DbCuradoriaOverlay>();
  for (const ov of (overlayResult.data ?? []) as DbCuradoriaOverlay[]) {
    overlayByContentId.set(ov.content_id, ov);
  }

  const availabilityByContentId = new Map<string, AvailabilityOverlay>();
  if (tmdbIds.length > 0) {
    const { data: availabilityRows } = await supabaseAdmin
      .from("poplog3_title_availability")
      .select("tmdb_id, media_type, provider_name, availability_type, country, last_synced_at")
      .in("tmdb_id", tmdbIds)
      .in("media_type", mediaTypeValues)
      .in("country", ["BR", "US"]);

    for (const row of (availabilityRows ?? []) as Array<{
      tmdb_id: number;
      media_type: MediaType;
      provider_name: string | null;
      availability_type: string | null;
      country: string | null;
      last_synced_at: string | null;
    }>) {
      const contentId = toContentId(row.media_type, row.tmdb_id);
      const current = availabilityByContentId.get(contentId) ?? {
        streaming_platform: null,
        streaming_available_since: null,
        available_on_vod: false,
        vod_available_since: null,
      };
      const isSubscription =
        row.country === "BR" &&
        ["streaming", "subscription", "free", "ads"].includes(row.availability_type ?? "");
      const isVod =
        ["rent", "buy"].includes(row.availability_type ?? "") &&
        (row.country === "BR" || row.country === "US");

      availabilityByContentId.set(contentId, {
        streaming_platform:
          current.streaming_platform ?? (isSubscription ? row.provider_name : null),
        streaming_available_since:
          current.streaming_available_since ?? (isSubscription ? row.last_synced_at : null),
        available_on_vod: current.available_on_vod || isVod,
        vod_available_since:
          current.vod_available_since ?? (isVod ? row.last_synced_at : null),
      });
    }
  }

  const items: UserWatching[] = [];

  for (const ut of userTitles) {
    const watchStatus = LIBRARY_TO_WATCH_STATUS[ut.status];
    if (!watchStatus) continue;

    const meta = ut.title;
    if (!meta) continue;

    const contentId = toContentId(ut.media_type, ut.tmdb_id);
    const contentType: ContentType = ut.media_type === "tv" ? "serie" : "filme";
    const overlay = overlayByContentId.get(contentId);
    const availabilityOverlay = availabilityByContentId.get(contentId);

    const watchedEpisodes = watchedBySeries.get(ut.tmdb_id) ?? [];
    const episodeRows = episodesBySeries.get(ut.tmdb_id) ?? [];

    const episodeContext =
      ut.media_type === "tv"
        ? getEpisodeContext({
            meta,
            watchedEpisodes,
            episodeRows,
            overlay,
          })
        : null;

    const sortedWatched = sortEpisodes(watchedEpisodes);
    const lastWatchedEpisode = sortedWatched.at(-1) ?? null;

    const rawSeriesStatus =
      typeof meta.tmdb_payload?.status === "string"
        ? meta.tmdb_payload.status
        : null;

    items.push({
      id: ut.id,
      user_id: ut.user_id,
      content_id: contentId,
      content_type: contentType,

      title: meta.title ?? "Sem título",
      original_title: meta.original_title ?? null,
      poster_path: meta.poster_path ?? null,
      backdrop_path: meta.backdrop_path ?? null,
      dominant_color: overlay?.dominant_color ?? null,

      status: watchStatus,

      current_season: episodeContext?.currentSeason ?? null,
      current_episode: episodeContext?.currentEpisode ?? null,
      total_seasons: meta.number_of_seasons ?? null,
      total_episodes_season: episodeContext?.totalEpisodesSeason ?? null,
      episodes_watched: episodeContext?.episodesWatched ?? null,
      next_episode_name: episodeContext?.nextEpisodeName ?? null,
      next_episode_duration: episodeContext?.nextEpisodeDuration ?? null,
      next_episode_air_date: episodeContext?.nextEpisodeAirDate ?? null,
      next_episode_still_path: episodeContext?.nextEpisodeStillPath ?? null,
      series_status: mapSeriesStatus(rawSeriesStatus),
      new_episode_available: episodeContext?.newEpisodeAvailable ?? false,
      new_episode_available_since:
        episodeContext?.newEpisodeAvailableSince ?? null,

      runtime: meta.runtime ?? null,
      watch_progress_minutes: null,

      streaming_platform:
        availabilityOverlay?.streaming_platform ?? overlay?.streaming_platform ?? null,
      streaming_available_since:
        availabilityOverlay?.streaming_available_since ??
        overlay?.streaming_available_since ??
        null,
      available_on_vod:
        availabilityOverlay?.available_on_vod ?? overlay?.available_on_vod ?? false,
      vod_available_since:
        availabilityOverlay?.vod_available_since ?? overlay?.vod_available_since ?? null,

      tmdb_rating: meta.vote_average ?? null,
      user_rating: ut.rating ? Math.round(Number(ut.rating)) : null,

      last_watched_at:
        lastWatchedEpisode?.watched_at ?? ut.updated_at ?? ut.created_at,

      last_session_duration: null,
      sessions_last_7_days: 0,
      sessions_last_30_days: 0,
      average_session_gap_days: null,
      is_marathon: false,

      priority_score: 0,
      priority_last_calculated_at: null,
      snoozed_until: overlay?.snoozed_until ?? null,
      snooze_count: overlay?.snooze_count ?? 0,
      hero_shown_count: overlay?.hero_shown_count ?? 0,
      hero_last_shown_at: overlay?.hero_last_shown_at ?? null,
      rediscovery_eligible: overlay?.rediscovery_eligible ?? false,

      added_to_watchlist_at: ut.created_at ?? null,
      started_at: ut.started_at ?? null,
      finished_at: ut.finished_at ?? null,
      genres: normalizeGenres(meta.genres),
      year: meta.year ?? null,

      belongs_to_collection: extractCollection(meta),

      created_at: ut.created_at,
      updated_at: ut.updated_at,
    });
  }

  return NextResponse.json({
    ok: true,
    items,
    preferences: preferencesResult.data ?? null,
  });
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: CuradoriaPostBody;

  try {
    body = (await request.json()) as CuradoriaPostBody;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Payload inválido." },
      { status: 400 }
    );
  }

  if (!body || typeof body !== "object" || !("action" in body)) {
    return NextResponse.json(
      { ok: false, error: "Ação inválida." },
      { status: 400 }
    );
  }

  const parsed = parseContentId(body.contentId);

  if (!parsed) {
    return NextResponse.json(
      { ok: false, error: "contentId inválido." },
      { status: 400 }
    );
  }

  try {
    if (body.action === "snooze") {
      const durationHours =
        typeof body.durationHours === "number" &&
        Number.isFinite(body.durationHours) &&
        body.durationHours > 0
          ? Math.min(body.durationHours, 168)
          : 4;

      const snoozedUntil = new Date(
        Date.now() + durationHours * 60 * 60 * 1000
      ).toISOString();

      if (isLocalCuradoriaEnabled()) {
        await logLocalCuradoriaAction({
          userId: user.id,
          parsed,
          signal: "snoozed",
          value: { durationHours, snoozedUntil },
        });

        return NextResponse.json({
          ok: true,
          action: "snooze",
          contentId: parsed.contentId,
          snoozedUntil,
        });
      }

      await upsertCuradoriaOverlay(user.id, parsed, {
        snoozed_until: snoozedUntil,
        snooze_count: 1,
      });

      await logCuradoriaSignal(user.id, parsed.contentId, "snoozed", {
        durationHours,
        snoozedUntil,
      });

      return NextResponse.json({
        ok: true,
        action: "snooze",
        contentId: parsed.contentId,
        snoozedUntil,
      });
    }

    if (body.action === "log_signal") {
      if (isLocalCuradoriaEnabled()) {
        await logLocalCuradoriaAction({
          userId: user.id,
          parsed,
          signal: body.signal,
          value: body.value ?? null,
        });

        return NextResponse.json({
          ok: true,
          action: "log_signal",
          contentId: parsed.contentId,
        });
      }

      await logCuradoriaSignal(
        user.id,
        parsed.contentId,
        body.signal,
        body.value ?? null
      );

      if (body.signal === "clicked_hero") {
        await upsertCuradoriaOverlay(user.id, parsed, {
          hero_last_shown_at: new Date().toISOString(),
        });
      }

      return NextResponse.json({
        ok: true,
        action: "log_signal",
        contentId: parsed.contentId,
      });
    }

    if (body.action === "mark_watched") {
      const now = new Date().toISOString();
      const existingTitle = await getUserTitleStatus(
        user.id,
        parsed.tmdbId,
        parsed.mediaType,
      );
      const existingFavorite = Boolean(existingTitle?.favorite);
      const existingLiked = existingTitle?.liked ?? null;

      await upsertUserTitleStatus({
        userId: user.id,
        tmdbId: parsed.tmdbId,
        mediaType: parsed.mediaType,
        status: "watched",
        favorite: existingFavorite,
        liked: existingLiked,
      });

      if (isLocalCuradoriaEnabled()) {
        await logLocalCuradoriaAction({
          userId: user.id,
          parsed,
          signal: "finished",
          value: { finishedAt: now },
        });
      } else {
        await logCuradoriaSignal(user.id, parsed.contentId, "finished", {
          finishedAt: now,
        });
      }

      return NextResponse.json({
        ok: true,
        action: "mark_watched",
        contentId: parsed.contentId,
      });
    }

    return NextResponse.json(
      { ok: false, error: "Ação não suportada." },
      { status: 400 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Erro ao processar ação.";

    console.error("[acompanhando] POST error:", err);

    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
