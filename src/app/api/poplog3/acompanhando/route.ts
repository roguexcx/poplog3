import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserTitleStatus, upsertUserTitleStatus } from "@/server/library/library-service";
import { isValidSeason, mapSeriesStatus } from "@/lib/series";
import {
  isLocalCuradoriaEnabled,
  isLocalCuradoriaStateEnabled,
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
  const match = /^tmdb-(movie|tv)-(-?\d+)$/.exec(contentId);

  if (!match) return null;

  const mediaType = match[1] as MediaType;
  const tmdbId = Number(match[2]);

  if (!Number.isFinite(tmdbId) || tmdbId === 0) return null;

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

async function getLocalCuradoriaStateService() {
  return import("@/server/local-services/curadoria-state-local.service");
}

async function getLocalTitleCacheService() {
  return import("@/server/local-services/title-cache-local.service");
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

async function getLocalOverlayBase(userId: string, parsed: ParsedContentId) {
  const [userTitle, titleCache] = await Promise.all([
    getUserTitleStatus(userId, parsed.tmdbId, parsed.mediaType),
    getLocalTitleCacheService().then((service) =>
      service.getCachedTitle(parsed.mediaType, parsed.tmdbId),
    ),
  ]);

  if (!userTitle || !titleCache) {
    throw new Error("Título não encontrado na biblioteca.");
  }

  const titleRecord = titleCache as Record<string, unknown>;
  const title = typeof titleRecord.title === "string"
    ? titleRecord.title
    : typeof titleRecord.name === "string"
      ? titleRecord.name
      : null;
  const genres = "genres" in titleCache ? titleCache.genres : null;
  const year = "year" in titleCache
    ? titleCache.year
    : (titleCache.release_date ?? titleCache.first_air_date)?.split("-")[0];

  return {
    userId,
    contentId: parsed.contentId,
    contentType: parsed.contentType,
    title: title ?? "Sem título",
    posterPath: titleCache.poster_path ?? null,
    backdropPath: titleCache.backdrop_path ?? null,
    status: LIBRARY_TO_WATCH_STATUS[userTitle.status] ?? "watching",
    runtime: "runtime" in titleCache ? titleCache.runtime ?? null : null,
    tmdbRating: titleCache.vote_average ?? null,
    userRating: userTitle.rating ?? null,
    addedToWatchlistAt: userTitle.created_at ?? null,
    startedAt: userTitle.started_at ?? null,
    finishedAt: userTitle.finished_at ?? null,
    genres,
    year: typeof year === "number" ? year : year ? Number(year) : null,
  };
}

function toLocalOverlayPatch(patch: Record<string, unknown>) {
  return {
    priorityScore: typeof patch.priority_score === "number" ? patch.priority_score : undefined,
    priorityLastCalculatedAt: typeof patch.priority_last_calculated_at === "string"
      ? patch.priority_last_calculated_at
      : undefined,
    snoozedUntil: typeof patch.snoozed_until === "string" ? patch.snoozed_until : undefined,
    snoozeCount: typeof patch.snooze_count === "number" ? patch.snooze_count : undefined,
    heroShownCount: typeof patch.hero_shown_count === "number" ? patch.hero_shown_count : undefined,
    heroLastShownAt: typeof patch.hero_last_shown_at === "string" ? patch.hero_last_shown_at : undefined,
    dominantColor: typeof patch.dominant_color === "string" ? patch.dominant_color : undefined,
    rediscoveryEligible: typeof patch.rediscovery_eligible === "boolean"
      ? patch.rediscovery_eligible
      : undefined,
    newEpisodeAvailable: typeof patch.new_episode_available === "boolean"
      ? patch.new_episode_available
      : undefined,
    newEpisodeAvailableSince: typeof patch.new_episode_available_since === "string"
      ? patch.new_episode_available_since
      : undefined,
    streamingPlatform: typeof patch.streaming_platform === "string" ? patch.streaming_platform : undefined,
    streamingAvailableSince: typeof patch.streaming_available_since === "string"
      ? patch.streaming_available_since
      : undefined,
    availableOnVod: typeof patch.available_on_vod === "boolean" ? patch.available_on_vod : undefined,
    vodAvailableSince: typeof patch.vod_available_since === "string" ? patch.vod_available_since : undefined,
  };
}

async function upsertCuradoriaOverlay(
  userId: string,
  parsed: ParsedContentId,
  patch: Record<string, unknown>
) {
  if (isLocalCuradoriaStateEnabled()) {
    const local = await getLocalCuradoriaStateService();
    await local.upsertCuradoriaState({
      ...(await getLocalOverlayBase(userId, parsed)),
      ...toLocalOverlayPatch(patch),
    });
    return;
  }
  // No fallback — requires local curadoria state service
}

async function readCuradoriaPreference(userId: string): Promise<CuradoriaPreferencesResult> {
  const local = await getLocalUserPreferencesService();
  try {
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

async function readCuradoriaOverlays(userId: string, contentIds: string[]) {
  if (contentIds.length === 0) return { data: [], error: null };

  if (isLocalCuradoriaStateEnabled()) {
    try {
      const local = await getLocalCuradoriaStateService();
      return {
        data: await local.getCuradoriaStates({ userId, contentIds, limit: contentIds.length }),
        error: null,
      };
    } catch (error) {
      return {
        data: [],
        error: { message: error instanceof Error ? error.message : String(error) },
      };
    }
  }

  return { data: [], error: null };
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

function toJsonRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readPrismaNumberArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  if (value.every((item) => typeof item === "number")) return value as number[];
  return null;
}

async function getLocalAcompanhandoResponse(userId: string): Promise<NextResponse> {
  const { db } = await import("@/server/db/client");

  const userTitleRows = await db.userTitle.findMany({
    where: {
      userId,
      status: { in: ["watching", "watchlist", "abandoned", "fridge"] },
    },
    orderBy: { createdAt: "desc" },
    take: 120,
  });

  if (userTitleRows.length === 0) {
    const preferencesResult = await readCuradoriaPreference(userId);
    if (preferencesResult.error) {
      console.error("[acompanhando:local] preferences error:", preferencesResult.error);
    }
    return NextResponse.json({ ok: true, items: [], preferences: preferencesResult.data ?? null });
  }

  const uniqueTmdbIds = [...new Set(userTitleRows.map((r) => r.tmdbId))];
  const seriesIds = [...new Set(userTitleRows.filter((r) => r.mediaType === "tv").map((r) => r.tmdbId))];
  const mediaTypes = [...new Set(userTitleRows.map((r) => r.mediaType))];
  const contentIds = userTitleRows.map((r) => toContentId(r.mediaType, r.tmdbId));

  const titleRows = await db.poplog3Title.findMany({
    where: { tmdbId: { in: uniqueTmdbIds } },
    select: {
      tmdbId: true,
      mediaType: true,
      title: true,
      originalTitle: true,
      posterPath: true,
      backdropPath: true,
      year: true,
      runtime: true,
      episodeRunTime: true,
      voteAverage: true,
      genres: true,
      numberOfSeasons: true,
      numberOfEpisodes: true,
      tmdbPayload: true,
    },
  });

  const titleMetaMap = new Map<string, (typeof titleRows)[0]>();
  for (const row of titleRows) {
    titleMetaMap.set(`${row.tmdbId}:${row.mediaType}`, row);
  }

  const [
    preferencesResult,
    watchedEpisodeRows,
    episodeCatalogRows,
    overlayResult,
    availabilityRows,
  ] = await Promise.all([
    readCuradoriaPreference(userId),

    db.userEpisode.findMany({
      where: { userId, seriesTmdbId: { in: seriesIds } },
      select: {
        seriesTmdbId: true,
        seasonNumber: true,
        episodeNumber: true,
        watchedAt: true,
        runtimeMinutes: true,
      },
    }),

    db.poplog3Episode.findMany({
      where: { seriesTmdbId: { in: seriesIds } },
      select: {
        seriesTmdbId: true,
        seasonNumber: true,
        episodeNumber: true,
        name: true,
        airDate: true,
        runtime: true,
        stillPath: true,
      },
    }),

    readCuradoriaOverlays(userId, contentIds),

    db.catalogAvailability.findMany({
      where: {
        tmdbId: { in: uniqueTmdbIds.map((id) => BigInt(id)) },
        mediaType: { in: mediaTypes },
        providerRegion: { in: ["BR", "US"] },
      },
      select: {
        tmdbId: true,
        mediaType: true,
        providerName: true,
        providerType: true,
        providerRegion: true,
        checkedAt: true,
      },
    }),
  ]);

  if (preferencesResult.error) {
    console.error("[acompanhando:local] preferences error:", preferencesResult.error);
  }
  if (overlayResult.error) {
    console.error("[acompanhando:local] overlays error:", overlayResult.error);
  }

  const watchedBySeries = new Map<number, DbUserEpisode[]>();
  for (const row of watchedEpisodeRows) {
    const list = watchedBySeries.get(row.seriesTmdbId) ?? [];
    list.push({
      series_tmdb_id: row.seriesTmdbId,
      season_number: row.seasonNumber,
      episode_number: row.episodeNumber,
      watched_at: row.watchedAt.toISOString(),
      runtime_minutes: row.runtimeMinutes,
    });
    watchedBySeries.set(row.seriesTmdbId, list);
  }

  const episodesBySeries = new Map<number, DbEpisode[]>();
  for (const row of episodeCatalogRows) {
    const list = episodesBySeries.get(row.seriesTmdbId) ?? [];
    list.push({
      series_tmdb_id: row.seriesTmdbId,
      season_number: row.seasonNumber,
      episode_number: row.episodeNumber,
      name: row.name,
      air_date: row.airDate ? row.airDate.toISOString().slice(0, 10) : null,
      runtime: row.runtime,
      still_path: row.stillPath,
    });
    episodesBySeries.set(row.seriesTmdbId, list);
  }

  const overlayByContentId = new Map<string, DbCuradoriaOverlay>();
  for (const ov of (overlayResult.data ?? []) as DbCuradoriaOverlay[]) {
    overlayByContentId.set(ov.content_id, ov);
  }

  const availabilityByContentId = new Map<string, AvailabilityOverlay>();
  for (const row of availabilityRows) {
    if (!row.tmdbId) continue;
    const tmdbIdNum = Number(row.tmdbId);
    const contentId = toContentId(row.mediaType, tmdbIdNum);
    const current = availabilityByContentId.get(contentId) ?? {
      streaming_platform: null,
      streaming_available_since: null,
      available_on_vod: false,
      vod_available_since: null,
    };
    const isSubscription =
      row.providerRegion === "BR" &&
      (["subscription", "free", "ads"] as string[]).includes(row.providerType);
    const isVod =
      (["rent", "buy"] as string[]).includes(row.providerType) &&
      (row.providerRegion === "BR" || row.providerRegion === "US");

    availabilityByContentId.set(contentId, {
      streaming_platform: current.streaming_platform ?? (isSubscription ? row.providerName : null),
      streaming_available_since:
        current.streaming_available_since ?? (isSubscription ? row.checkedAt.toISOString() : null),
      available_on_vod: current.available_on_vod || isVod,
      vod_available_since:
        current.vod_available_since ?? (isVod ? row.checkedAt.toISOString() : null),
    });
  }

  const items: UserWatching[] = [];

  for (const ut of userTitleRows) {
    const watchStatus = LIBRARY_TO_WATCH_STATUS[ut.status];
    if (!watchStatus) continue;

    const titleRow = titleMetaMap.get(`${ut.tmdbId}:${ut.mediaType}`);
    if (!titleRow) continue;

    const meta: DbTitleMeta = {
      tmdb_id: ut.tmdbId,
      media_type: ut.mediaType,
      title: titleRow.title,
      original_title: titleRow.originalTitle,
      poster_path: titleRow.posterPath,
      backdrop_path: titleRow.backdropPath,
      year: titleRow.year,
      runtime: titleRow.runtime,
      episode_run_time: readPrismaNumberArray(titleRow.episodeRunTime),
      vote_average: titleRow.voteAverage === null ? null : Number(titleRow.voteAverage),
      genres: titleRow.genres,
      number_of_seasons: titleRow.numberOfSeasons,
      number_of_episodes: titleRow.numberOfEpisodes,
      tmdb_payload: toJsonRecord(titleRow.tmdbPayload),
    };

    const contentId = toContentId(ut.mediaType, ut.tmdbId);
    const contentType: ContentType = ut.mediaType === "tv" ? "serie" : "filme";
    const overlay = overlayByContentId.get(contentId);
    const availabilityOverlay = availabilityByContentId.get(contentId);

    const watchedEpisodes = watchedBySeries.get(ut.tmdbId) ?? [];
    const episodeRows = episodesBySeries.get(ut.tmdbId) ?? [];

    const episodeContext =
      ut.mediaType === "tv"
        ? getEpisodeContext({ meta, watchedEpisodes, episodeRows, overlay })
        : null;

    const sortedWatched = sortEpisodes(watchedEpisodes);
    const lastWatchedEpisode = sortedWatched.at(-1) ?? null;

    const rawSeriesStatus =
      typeof meta.tmdb_payload?.status === "string" ? meta.tmdb_payload.status : null;

    items.push({
      id: ut.id,
      user_id: ut.userId,
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
      new_episode_available_since: episodeContext?.newEpisodeAvailableSince ?? null,

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
      user_rating: ut.rating ? Math.round(ut.rating) : null,

      last_watched_at: lastWatchedEpisode?.watched_at ?? ut.updatedAt.toISOString(),

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

      added_to_watchlist_at: ut.createdAt.toISOString(),
      started_at: ut.startedAt ? ut.startedAt.toISOString() : null,
      finished_at: ut.finishedAt ? ut.finishedAt.toISOString() : null,
      genres: normalizeGenres(meta.genres),
      year: meta.year ?? null,

      belongs_to_collection: extractCollection(meta),

      created_at: ut.createdAt.toISOString(),
      updated_at: ut.updatedAt.toISOString(),
    });
  }

  return NextResponse.json({
    ok: true,
    items,
    preferences: preferencesResult.data ?? null,
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

  return getLocalAcompanhandoResponse(user.id);
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

      if (isLocalCuradoriaStateEnabled()) {
        await upsertCuradoriaOverlay(user.id, parsed, {
          snoozed_until: snoozedUntil,
          snooze_count: 1,
        });
      }

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

    if (body.action === "log_signal") {
      if (isLocalCuradoriaStateEnabled() && body.signal === "clicked_hero") {
        await upsertCuradoriaOverlay(user.id, parsed, {
          hero_last_shown_at: new Date().toISOString(),
        });
      }

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

      await logLocalCuradoriaAction({
        userId: user.id,
        parsed,
        signal: "finished",
        value: { finishedAt: now },
      });

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
