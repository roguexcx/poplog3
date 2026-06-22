export type RuntimeEpisode = {
  seasonNumber: number;
  episodeNumber: number;
  airDate: Date | string | null;
  runtime: number | null;
};

export type RemainingRuntime = {
  minutes: number | null;
  airedEpisodes: number;
  remainingEpisodes: number;
  averageEpisodeMinutes: number | null;
  estimated: boolean;
  unavailable: boolean;
};

function episodeKey(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function positiveMinutes(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function hasAired(airDate: Date | string | null, now: number): boolean {
  if (!airDate) return false;
  const time = airDate instanceof Date ? airDate.getTime() : new Date(airDate).getTime();
  return Number.isFinite(time) && time <= now;
}

export function calculateRemainingSeriesRuntime(input: {
  episodes: RuntimeEpisode[];
  watchedKeys: string[];
  fallbackEpisodeRuntime?: number | null;
  now?: number;
}): RemainingRuntime {
  const now = input.now ?? Date.now();
  const watched = new Set(input.watchedKeys.map((key) => key.toUpperCase()));
  const aired = input.episodes.filter((episode) =>
    episode.seasonNumber > 0 && hasAired(episode.airDate, now)
  );
  const remaining = aired.filter((episode) =>
    !watched.has(episodeKey(episode.seasonNumber, episode.episodeNumber))
  );
  const knownRuntimes = aired
    .map((episode) => positiveMinutes(episode.runtime))
    .filter((runtime): runtime is number => runtime !== null);
  const fallback = positiveMinutes(input.fallbackEpisodeRuntime)
    ?? (knownRuntimes.length
      ? Math.round(knownRuntimes.reduce((sum, runtime) => sum + runtime, 0) / knownRuntimes.length)
      : null);

  // Sem catálogo de episódios não é possível concluir que a série está em dia.
  // O caller ainda pode aplicar um fallback baseado em contadores materializados.
  if (input.episodes.length === 0) {
    return {
      minutes: null,
      airedEpisodes: 0,
      remainingEpisodes: 0,
      averageEpisodeMinutes: fallback,
      estimated: false,
      unavailable: true,
    };
  }

  if (remaining.length === 0) {
    return {
      minutes: 0,
      airedEpisodes: aired.length,
      remainingEpisodes: 0,
      averageEpisodeMinutes: fallback,
      estimated: false,
      unavailable: false,
    };
  }

  const runtimes = remaining.map((episode) => positiveMinutes(episode.runtime));
  if (runtimes.some((runtime) => runtime === null) && fallback === null) {
    return {
      minutes: null,
      airedEpisodes: aired.length,
      remainingEpisodes: remaining.length,
      averageEpisodeMinutes: null,
      estimated: false,
      unavailable: true,
    };
  }

  return {
    minutes: runtimes.reduce<number>((sum, runtime) => sum + (runtime ?? fallback ?? 0), 0),
    airedEpisodes: aired.length,
    remainingEpisodes: remaining.length,
    averageEpisodeMinutes: fallback,
    estimated: runtimes.some((runtime) => runtime === null),
    unavailable: false,
  };
}
