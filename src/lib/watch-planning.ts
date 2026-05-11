export type WatchPlanningMediaType = "movie" | "tv";

export type WatchPlanningMode = "episodes" | "time" | "hybrid";

export type WatchPlanningSort =
  | "finish_fastest"
  | "fewest_episodes"
  | "highest_progress"
  | "stalled_longest"
  | "newest_episode"
  | "oldest_episode"
  | "most_popular"
  | "best_rated"
  | "best_value";

export type WatchPlanningInput = {
  id: number | string;
  tmdbId: number;
  mediaType: WatchPlanningMediaType;
  status?: string | null;
  title?: string | null;
  runtime?: number | null;
  episodeRunTime?: number[] | null;
  totalEpisodes?: number | null;
  watchedEpisodes?: number | null;
  remainingEpisodes?: number | null;
  nextEpisode?: unknown | null;
  lastWatchedAt?: string | null;
  latestReleasedEpisodeAt?: string | null;
  popularity?: number | null;
  voteAverage?: number | null;
};

export type WatchEpisodeProgressInput = {
  season: number | string;
  episode: number | string;
  watched_at?: string | null;
};

export type WatchAvailableEpisodeInput = {
  episode_number: number | string;
  name?: string | null;
  still_path?: string | null;
  air_date?: string | null;
};

export type WatchSeasonEpisodesInput<T extends WatchAvailableEpisodeInput = WatchAvailableEpisodeInput> = {
  season: number | string;
  eps: T[];
};

export type SeriesContinuationState<T extends WatchAvailableEpisodeInput = WatchAvailableEpisodeInput> = {
  totalEpisodes: number;
  watchedEpisodes: number;
  remainingEpisodes: number;
  currentSeason: number | null;
  nextEpisode: (T & { season: number; episode_number: number }) | null;
  watchedInCurrentSeason: number;
  totalInCurrentSeason: number;
  lastEpisodeWatchedAt: string | null;
  latestReleasedEpisodeAt: string | null;
  isContinuationComplete: boolean;
};

export type WatchPlanningMetrics = {
  id: number | string;
  tmdbId: number;
  mediaType: WatchPlanningMediaType;
  progressMode: "episodes" | "runtime" | "unknown";
  totalEpisodes: number | null;
  watchedEpisodes: number | null;
  remainingEpisodes: number | null;
  progressPercent: number | null;
  averageEpisodeMinutes: number | null;
  runtimeMinutes: number | null;
  totalMinutes: number | null;
  watchedMinutes: number | null;
  remainingMinutes: number | null;
  isRuntimeEstimated: boolean;
  lastWatchedAt: string | null;
  latestReleasedEpisodeAt: string | null;
  daysStalled: number | null;
  hasNewEpisode: boolean;
  canFinishToday: boolean;
  popularity: number;
  voteAverage: number;
  valueScore: number;
  hybridScore: number;
};

export type WatchPlanningItem<T> = T & {
  watchPlan: WatchPlanningMetrics;
};

const DEFAULT_EPISODE_MINUTES = 45;
const DEFAULT_MOVIE_MINUTES = 110;
const FINISH_TODAY_LIMIT_MINUTES = 240;
const NEW_EPISODE_WINDOW_DAYS = 14;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function validPositiveNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function toPositiveInteger(value: number | string | null | undefined): number | null {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isInteger(number) && number > 0 ? number : null;
}

function maxIsoDate(values: Array<string | null | undefined>): string | null {
  const valid = values
    .filter((value): value is string => Boolean(value && !Number.isNaN(new Date(value).getTime())))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
  return valid[0] ?? null;
}

function daysSinceDate(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return null;
  return Math.max(0, Math.floor((Date.now() - time) / 86_400_000));
}

function isRecentDate(value: string | null | undefined, windowDays: number): boolean {
  const days = daysSinceDate(value);
  return days !== null && days <= windowDays;
}

export function buildSeriesContinuationState<T extends WatchAvailableEpisodeInput>(
  seasonList: Array<WatchSeasonEpisodesInput<T>>,
  progressRows: WatchEpisodeProgressInput[],
): SeriesContinuationState<T> {
  const seasons = seasonList
    .map((season) => ({
      season: toPositiveInteger(season.season),
      eps: season.eps
        .map((episode) => ({
          ...episode,
          episode_number: toPositiveInteger(episode.episode_number),
        }))
        .filter((episode): episode is T & { episode_number: number } => episode.episode_number !== null)
        .sort((a, b) => a.episode_number - b.episode_number),
    }))
    .filter((season): season is { season: number; eps: Array<T & { episode_number: number }> } =>
      season.season !== null && season.eps.length > 0,
    )
    .sort((a, b) => a.season - b.season);

  const episodeKeys = new Set(
    seasons.flatMap((season) =>
      season.eps.map((episode) => `${season.season}-${episode.episode_number}`),
    ),
  );

  const validProgress = progressRows
    .map((progress) => ({
      season: toPositiveInteger(progress.season),
      episode: toPositiveInteger(progress.episode),
      watched_at: progress.watched_at ?? null,
    }))
    .filter((progress): progress is { season: number; episode: number; watched_at: string | null } =>
      progress.season !== null &&
      progress.episode !== null &&
      episodeKeys.has(`${progress.season}-${progress.episode}`),
    );

  const watchedKeys = new Set(validProgress.map((progress) => `${progress.season}-${progress.episode}`));
  const totalEpisodes = episodeKeys.size;
  const watchedEpisodes = watchedKeys.size;

  const latestWatchedPosition = [...watchedKeys]
    .map((key) => {
      const [season, episode] = key.split("-").map(Number);
      return { season, episode };
    })
    .sort((a, b) => b.season - a.season || b.episode - a.episode)[0] ?? null;

  const firstSeason = seasons[0]?.season ?? null;
  const currentSeason = latestWatchedPosition?.season ?? firstSeason;
  let nextEpisode: (T & { season: number; episode_number: number }) | null = null;

  for (const season of seasons) {
    if (latestWatchedPosition && season.season < latestWatchedPosition.season) continue;

    const candidate = season.eps.find((episode) => {
      if (!latestWatchedPosition) return !watchedKeys.has(`${season.season}-${episode.episode_number}`);
      if (season.season === latestWatchedPosition.season && episode.episode_number <= latestWatchedPosition.episode) {
        return false;
      }
      return !watchedKeys.has(`${season.season}-${episode.episode_number}`);
    });

    if (candidate) {
      nextEpisode = { ...candidate, season: season.season };
      break;
    }
  }

  const remainingEpisodes = nextEpisode
    ? seasons.reduce((total, season) => {
        if (!nextEpisode || season.season < nextEpisode.season) return total;
        return total + season.eps.filter((episode) => {
          if (season.season === nextEpisode!.season && episode.episode_number < nextEpisode!.episode_number) return false;
          return !watchedKeys.has(`${season.season}-${episode.episode_number}`);
        }).length;
      }, 0)
    : 0;

  const selectedSeason = nextEpisode?.season ?? currentSeason;
  const currentSeasonData = selectedSeason
    ? seasons.find((season) => season.season === selectedSeason)
    : null;
  const totalInCurrentSeason = currentSeasonData?.eps.length ?? 0;
  const watchedInCurrentSeason = currentSeasonData
    ? currentSeasonData.eps.filter((episode) => watchedKeys.has(`${currentSeasonData.season}-${episode.episode_number}`)).length
    : 0;

  const lastEpisodeWatchedAt = maxIsoDate(validProgress.map((progress) => progress.watched_at));
  const latestReleasedEpisodeAt = maxIsoDate(
    seasons.flatMap((season) => season.eps.map((episode) => episode.air_date ?? null)),
  );

  return {
    totalEpisodes,
    watchedEpisodes,
    remainingEpisodes,
    currentSeason: selectedSeason ?? null,
    nextEpisode,
    watchedInCurrentSeason,
    totalInCurrentSeason,
    lastEpisodeWatchedAt,
    latestReleasedEpisodeAt,
    isContinuationComplete: watchedEpisodes > 0 && nextEpisode === null,
  };
}

function getAverageEpisodeMinutes(input: WatchPlanningInput): {
  minutes: number | null;
  estimated: boolean;
} {
  const runtimes = (input.episodeRunTime ?? [])
    .map(validPositiveNumber)
    .filter((value): value is number => value !== null);

  if (runtimes.length > 0) {
    return {
      minutes: Math.round(runtimes.reduce((sum, value) => sum + value, 0) / runtimes.length),
      estimated: false,
    };
  }

  return { minutes: DEFAULT_EPISODE_MINUTES, estimated: true };
}

function getProgressPercent(watched: number, total: number): number | null {
  if (total <= 0) return null;
  return clamp(Math.round((watched / total) * 100), 0, 100);
}

function scoreValue(metrics: Pick<WatchPlanningMetrics, "remainingMinutes" | "remainingEpisodes" | "progressPercent" | "voteAverage">): number {
  const remainingMinutes = metrics.remainingMinutes ?? 999;
  const remainingEpisodes = metrics.remainingEpisodes ?? 99;
  const progress = metrics.progressPercent ?? 0;
  const rating = metrics.voteAverage || 0;

  const timeScore = clamp(1 - remainingMinutes / 600, 0, 1) * 35;
  const episodeScore = clamp(1 - remainingEpisodes / 24, 0, 1) * 20;
  const progressScore = (progress / 100) * 25;
  const ratingScore = (rating / 10) * 20;

  return Math.round(timeScore + episodeScore + progressScore + ratingScore);
}

function scoreHybrid(metrics: WatchPlanningMetrics): number {
  const remainingMinutes = metrics.remainingMinutes ?? 999;
  const remainingEpisodes = metrics.remainingEpisodes ?? 99;
  const progress = metrics.progressPercent ?? 0;
  const popularity = Math.log10((metrics.popularity || 0) + 1) / 3;
  const rating = metrics.voteAverage / 10;
  const stalled = metrics.daysStalled !== null ? clamp(metrics.daysStalled / 180, 0, 1) : 0;
  const freshness = metrics.hasNewEpisode ? 1 : 0;

  const finishScore = clamp(1 - remainingMinutes / 720, 0, 1) * 30;
  const quantityScore = clamp(1 - remainingEpisodes / 30, 0, 1) * 15;
  const progressScore = (progress / 100) * 20;
  const appealScore = clamp(popularity, 0, 1) * 10 + rating * 10;
  const recencyScore = freshness * 10 + stalled * 5;

  return Math.round(finishScore + quantityScore + progressScore + appealScore + recencyScore);
}

export function buildWatchPlanningMetrics(input: WatchPlanningInput): WatchPlanningMetrics {
  const popularity = validPositiveNumber(input.popularity) ?? 0;
  const voteAverage = validPositiveNumber(input.voteAverage) ?? 0;
  const lastWatchedAt = maxIsoDate([input.lastWatchedAt]);
  const latestReleasedEpisodeAt = maxIsoDate([input.latestReleasedEpisodeAt]);
  const daysStalled = daysSinceDate(lastWatchedAt);

  if (input.mediaType === "movie") {
    const runtime = validPositiveNumber(input.runtime);
    const runtimeMinutes = runtime ?? DEFAULT_MOVIE_MINUTES;
    const isWatched = input.status === "watched";
    const watchedMinutes = isWatched ? runtimeMinutes : 0;
    const remainingMinutes = isWatched ? 0 : runtimeMinutes;
    const progressPercent = isWatched ? 100 : 0;

    const base: WatchPlanningMetrics = {
      id: input.id,
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      progressMode: runtime ? "runtime" : "unknown",
      totalEpisodes: null,
      watchedEpisodes: null,
      remainingEpisodes: null,
      progressPercent,
      averageEpisodeMinutes: null,
      runtimeMinutes,
      totalMinutes: runtimeMinutes,
      watchedMinutes,
      remainingMinutes,
      isRuntimeEstimated: !runtime,
      lastWatchedAt,
      latestReleasedEpisodeAt: null,
      daysStalled,
      hasNewEpisode: false,
      canFinishToday: remainingMinutes > 0 && remainingMinutes <= FINISH_TODAY_LIMIT_MINUTES,
      popularity,
      voteAverage,
      valueScore: 0,
      hybridScore: 0,
    };

    const valueScore = scoreValue(base);
    return { ...base, valueScore, hybridScore: scoreHybrid({ ...base, valueScore }) };
  }

  const totalEpisodes = Math.max(0, input.totalEpisodes ?? 0);
  const watchedEpisodes = clamp(input.watchedEpisodes ?? 0, 0, totalEpisodes);
  const remainingEpisodes = totalEpisodes > 0
    ? Math.max(0, input.remainingEpisodes ?? (totalEpisodes - watchedEpisodes))
    : null;
  const progressPercent = totalEpisodes > 0 ? getProgressPercent(watchedEpisodes, totalEpisodes) : null;
  const runtime = getAverageEpisodeMinutes(input);
  const totalMinutes = totalEpisodes > 0 && runtime.minutes ? totalEpisodes * runtime.minutes : null;
  const watchedMinutes = runtime.minutes ? watchedEpisodes * runtime.minutes : null;
  const remainingMinutes = remainingEpisodes !== null && runtime.minutes ? remainingEpisodes * runtime.minutes : null;
  const hasNewEpisode = Boolean(
    input.nextEpisode &&
    remainingEpisodes !== null &&
    remainingEpisodes > 0 &&
    isRecentDate(latestReleasedEpisodeAt, NEW_EPISODE_WINDOW_DAYS),
  );

  const base: WatchPlanningMetrics = {
    id: input.id,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    progressMode: totalEpisodes > 0 ? "episodes" : "unknown",
    totalEpisodes: totalEpisodes > 0 ? totalEpisodes : null,
    watchedEpisodes: totalEpisodes > 0 ? watchedEpisodes : null,
    remainingEpisodes,
    progressPercent,
    averageEpisodeMinutes: runtime.minutes,
    runtimeMinutes: null,
    totalMinutes,
    watchedMinutes,
    remainingMinutes,
    isRuntimeEstimated: runtime.estimated,
    lastWatchedAt,
    latestReleasedEpisodeAt,
    daysStalled,
    hasNewEpisode,
    canFinishToday: Boolean(remainingMinutes && remainingMinutes > 0 && remainingMinutes <= FINISH_TODAY_LIMIT_MINUTES),
    popularity,
    voteAverage,
    valueScore: 0,
    hybridScore: 0,
  };

  const valueScore = scoreValue(base);
  return { ...base, valueScore, hybridScore: scoreHybrid({ ...base, valueScore }) };
}

export function withWatchPlanning<T>(
  item: T,
  input: WatchPlanningInput,
): WatchPlanningItem<T> {
  return { ...item, watchPlan: buildWatchPlanningMetrics(input) };
}

function compareNullableNumber(a: number | null, b: number | null, direction: "asc" | "desc" = "asc"): number {
  const fallback = direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const av = a ?? fallback;
  const bv = b ?? fallback;
  return direction === "asc" ? av - bv : bv - av;
}

export function sortWatchPlanningItems<T extends { watchPlan: WatchPlanningMetrics }>(
  items: T[],
  sort: WatchPlanningSort,
  mode: WatchPlanningMode = "hybrid",
): T[] {
  const sorted = [...items];

  sorted.sort((a, b) => {
    const am = a.watchPlan;
    const bm = b.watchPlan;

    if (sort === "finish_fastest") return compareNullableNumber(am.remainingMinutes, bm.remainingMinutes);
    if (sort === "fewest_episodes") return compareNullableNumber(am.remainingEpisodes, bm.remainingEpisodes);
    if (sort === "highest_progress") return compareNullableNumber(am.progressPercent, bm.progressPercent, "desc");
    if (sort === "stalled_longest") return compareNullableNumber(am.daysStalled, bm.daysStalled, "desc");
    if (sort === "newest_episode") return (new Date(bm.latestReleasedEpisodeAt ?? 0).getTime()) - (new Date(am.latestReleasedEpisodeAt ?? 0).getTime());
    if (sort === "oldest_episode") return (new Date(am.latestReleasedEpisodeAt ?? 8_640_000_000_000_000).getTime()) - (new Date(bm.latestReleasedEpisodeAt ?? 8_640_000_000_000_000).getTime());
    if (sort === "most_popular") return bm.popularity - am.popularity;
    if (sort === "best_rated") return bm.voteAverage - am.voteAverage;
    if (sort === "best_value") {
      const primary = mode === "episodes"
        ? compareNullableNumber(am.remainingEpisodes, bm.remainingEpisodes)
        : mode === "time"
          ? compareNullableNumber(am.remainingMinutes, bm.remainingMinutes)
          : bm.hybridScore - am.hybridScore;
      return primary || bm.valueScore - am.valueScore;
    }

    return bm.hybridScore - am.hybridScore;
  });

  return sorted;
}

export function formatWatchMinutes(minutes: number | null, estimated = false): string | null {
  if (minutes === null || !Number.isFinite(minutes) || minutes < 0) return null;
  const rounded = Math.round(minutes);
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  const value = hours <= 0 ? `${mins}min` : mins === 0 ? `${hours}h` : `${hours}h${String(mins).padStart(2, "0")}`;
  return estimated ? `~${value}` : value;
}

export function formatStalledTime(days: number | null): string | null {
  if (days === null) return null;
  if (days < 7) return `${days || 1} dia${days === 1 ? "" : "s"}`;
  if (days < 60) {
    const weeks = Math.max(1, Math.round(days / 7));
    return `${weeks} semana${weeks === 1 ? "" : "s"}`;
  }
  if (days < 365) {
    const months = Math.max(1, Math.round(days / 30));
    return `${months} mes${months === 1 ? "" : "es"}`;
  }
  const years = Math.max(1, Math.round(days / 365));
  return `${years} ano${years === 1 ? "" : "s"}`;
}

export function getWatchPlanningBadges(metrics: WatchPlanningMetrics): string[] {
  const badges: string[] = [];
  const remainingLabel = formatWatchMinutes(metrics.remainingMinutes, metrics.isRuntimeEstimated);

  if (metrics.remainingEpisodes !== null && metrics.remainingEpisodes > 0) {
    const episodeLabel = metrics.remainingEpisodes === 1 ? "1 episódio" : `${metrics.remainingEpisodes} episódios`;
    const prefix = metrics.remainingEpisodes <= 3 ? "Falta apenas" : "Faltam";
    badges.push(`${prefix} ${episodeLabel}${remainingLabel ? ` (${remainingLabel})` : ""}`);
  } else if (remainingLabel && (metrics.remainingMinutes ?? 0) > 0) {
    badges.push(`Faltam ${remainingLabel}`);
  }

  if (metrics.hasNewEpisode) badges.push("episódio novo disponível");
  if (metrics.canFinishToday) badges.push("dá pra terminar hoje");

  if (metrics.mediaType === "movie" && metrics.totalMinutes) {
    const runtime = formatWatchMinutes(metrics.totalMinutes, metrics.isRuntimeEstimated);
    if (runtime) badges.push(`filme de ${runtime}`);
  } else if ((metrics.totalMinutes ?? 0) >= 240) {
    const total = formatWatchMinutes(metrics.totalMinutes, metrics.isRuntimeEstimated);
    if (total) badges.push(`maratona de ${total}`);
  }

  return badges;
}
