// src/lib/series-normalization.ts

export type RawTmdbEpisodeLike = {
  id?: number;
  episode_number?: number;
  name?: string | null;
  overview?: string | null;
  runtime?: number | null;
  still_path?: string | null;
  air_date?: string | null;
};

export type RawTmdbSeasonLike = {
  id?: number;
  season_number?: number;
  name?: string | null;
  episode_count?: number | null;
  air_date?: string | null;
  poster_path?: string | null;
  overview?: string | null;
  episodes?: RawTmdbEpisodeLike[];
};

export type NormalizedEpisodeStatus =
  | "released"
  | "scheduled"
  | "undated"
  | "hidden";

export type NormalizedEpisode = {
  id: number;
  episode_number: number;
  name: string;
  overview: string;
  runtime: number | null;
  still_path: string | null;
  air_date: string | null;
  status: NormalizedEpisodeStatus;
  available: boolean;
};

export type NormalizedSeasonStatus =
  | "released"
  | "scheduled"
  | "announced"
  | "hidden";

export type NormalizedSeason = {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  air_date: string | null;
  poster_path: string | null;
  overview: string;
  episodes: NormalizedEpisode[];
  releasedEpisodes: NormalizedEpisode[];
  scheduledEpisodes: NormalizedEpisode[];
  undatedEpisodes: NormalizedEpisode[];
  status: NormalizedSeasonStatus;
  isVisible: boolean;
  isNavigable: boolean;
};

export type SeriesScheduleState = {
  visibleSeasons: NormalizedSeason[];
  hiddenSeasons: NormalizedSeason[];
  releasedEpisodes: NormalizedEpisode[];
  scheduledEpisodes: NormalizedEpisode[];
  undatedEpisodes: NormalizedEpisode[];
  hasOnlyUndatedFuture: boolean;
  renewalNote: string | null;
};

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayUtcNoon(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
}

export function isValidTmdbDate(value: string | null | undefined): boolean {
  return Boolean(parseDateOnly(value));
}

export function getEpisodeStatus(
  episode: RawTmdbEpisodeLike,
  today: Date = todayUtcNoon(),
): NormalizedEpisodeStatus {
  const episodeNumber = episode.episode_number ?? 0;
  if (episodeNumber <= 0) return "hidden";

  const airDate = parseDateOnly(episode.air_date);
  if (!airDate) return "undated";

  return airDate <= today ? "released" : "scheduled";
}

export function normalizeEpisode(
  episode: RawTmdbEpisodeLike,
  today: Date = todayUtcNoon(),
): NormalizedEpisode {
  const status = getEpisodeStatus(episode, today);
  return {
    id: episode.id ?? episode.episode_number ?? 0,
    episode_number: episode.episode_number ?? 0,
    name: episode.name ?? "",
    overview: episode.overview ?? "",
    runtime: episode.runtime ?? null,
    still_path: episode.still_path ?? null,
    air_date: episode.air_date ?? null,
    status,
    available: status === "released",
  };
}

export function normalizeSeason(
  season: RawTmdbSeasonLike,
  today: Date = todayUtcNoon(),
): NormalizedSeason {
  const seasonNumber = season.season_number ?? 0;
  const rawEpisodes = season.episodes ?? [];
  const normalizedEpisodes = rawEpisodes
    .map((episode) => normalizeEpisode(episode, today))
    .filter((episode) => episode.status !== "hidden");

  const releasedEpisodes = normalizedEpisodes.filter((episode) => episode.status === "released");
  const scheduledEpisodes = normalizedEpisodes.filter((episode) => episode.status === "scheduled");
  const undatedEpisodes = normalizedEpisodes.filter((episode) => episode.status === "undated");

  const hasReleased = releasedEpisodes.length > 0;
  const hasScheduled = scheduledEpisodes.length > 0;
  const hasUndatedOnly =
    !hasReleased &&
    !hasScheduled &&
    ((season.episode_count ?? 0) > 0 || undatedEpisodes.length > 0);

  const isSpecial = seasonNumber === 0;
  const isPlaceholder = seasonNumber < 0 || (!hasReleased && !hasScheduled);
  const isVisible = !isSpecial && !isPlaceholder && (hasReleased || hasScheduled);

  const status: NormalizedSeasonStatus = hasReleased
    ? "released"
    : hasScheduled
      ? "scheduled"
      : hasUndatedOnly
        ? "announced"
        : "hidden";

  return {
    id: season.id ?? seasonNumber,
    season_number: seasonNumber,
    name: season.name ?? `Temporada ${seasonNumber}`,
    episode_count: releasedEpisodes.length + scheduledEpisodes.length,
    air_date: season.air_date ?? null,
    poster_path: season.poster_path ?? null,
    overview: season.overview ?? "",
    episodes: [...releasedEpisodes, ...scheduledEpisodes].sort(
      (a, b) => a.episode_number - b.episode_number,
    ),
    releasedEpisodes,
    scheduledEpisodes,
    undatedEpisodes,
    status,
    isVisible,
    isNavigable: isVisible,
  };
}

export function normalizeSeriesSeasons(
  seasons: RawTmdbSeasonLike[] | undefined,
  status?: string | null,
  today: Date = todayUtcNoon(),
): SeriesScheduleState {
  const normalized = (seasons ?? []).map((season) => normalizeSeason(season, today));
  const visibleSeasons = normalized.filter((season) => season.isVisible);
  const hiddenSeasons = normalized.filter((season) => !season.isVisible);
  const releasedEpisodes = visibleSeasons.flatMap((season) => season.releasedEpisodes);
  const scheduledEpisodes = visibleSeasons.flatMap((season) => season.scheduledEpisodes);
  const undatedEpisodes = normalized.flatMap((season) => season.undatedEpisodes);

  const hasAnnouncedWithoutSchedule = hiddenSeasons.some(
    (season) => season.status === "announced",
  );

  const renewalStatuses = new Set(["Returning Series", "In Production", "Planned"]);
  const renewalNote =
    hasAnnouncedWithoutSchedule ||
    (renewalStatuses.has(status ?? "") && scheduledEpisodes.length === 0)
      ? "Renovada, sem nova temporada datada"
      : null;

  return {
    visibleSeasons,
    hiddenSeasons,
    releasedEpisodes,
    scheduledEpisodes,
    undatedEpisodes,
    hasOnlyUndatedFuture: hasAnnouncedWithoutSchedule && visibleSeasons.length === 0,
    renewalNote,
  };
}
