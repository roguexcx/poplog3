import { normalizeRuntimeMinutes } from "./runtime-utils";
import { calculateSeriesRuntimeStats, type EpisodeRuntimeInput } from "./series-runtime";

export type ProgressRuntimeEpisodeInput = EpisodeRuntimeInput & {
  watched?: boolean;
  seasonNumber?: number | null;
};

export type ProgressRuntimeStats = {
  totalWatchedMinutes: number;
  remainingMinutes: number | null;
  remainingSeasonMinutes: number | null;
  episodesRemaining: number;
  seasonEpisodesRemaining: number;
  averageRuntimeMinutes: number | null;
  runtimeSource: "tmdb" | "real" | "tmdb_array" | "estimated" | null;
  estimated: boolean;
};

export function calculateProgressRuntimeStats(input: {
  episodes?: ProgressRuntimeEpisodeInput[] | null;
  episodeRunTime?: number[] | null;
  currentSeasonNumber?: number | null;
}): ProgressRuntimeStats {
  const episodes = input.episodes ?? [];

  const runtimeStats = calculateSeriesRuntimeStats({
    episodes,
    episodeRunTime: input.episodeRunTime,
  });

  const avgRuntime = runtimeStats.averageRuntimeMinutes;

  const watchedEpisodes = episodes.filter((episode) => episode.watched === true);

  const totalWatchedMinutes = watchedEpisodes.reduce((total, episode) => {
    const runtime = normalizeRuntimeMinutes(episode.runtimeMinutes);

    return total + (runtime ?? avgRuntime ?? 0);
  }, 0);

  const remainingEpisodes = episodes.filter((episode) => {
    if (episode.watched === true) return false;
    if (episode.seasonNumber === 0) return false;
    return true;
  });

  const seasonRemainingEpisodes =
    input.currentSeasonNumber == null
      ? []
      : remainingEpisodes.filter(
          (episode) => episode.seasonNumber === input.currentSeasonNumber
        );

  return {
    totalWatchedMinutes,
    remainingMinutes:
      avgRuntime === null ? null : remainingEpisodes.length * avgRuntime,
    remainingSeasonMinutes:
      avgRuntime === null ? null : seasonRemainingEpisodes.length * avgRuntime,
    episodesRemaining: remainingEpisodes.length,
    seasonEpisodesRemaining: seasonRemainingEpisodes.length,
    averageRuntimeMinutes: avgRuntime,
    runtimeSource: runtimeStats.source,
    estimated: runtimeStats.estimated,
  };
}