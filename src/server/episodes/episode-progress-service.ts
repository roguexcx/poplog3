
export type UserEpisodeRow = {
  user_id: string;
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  watched_at: string;
  runtime_minutes: number | null;
};

export type EpisodeKey = `S${string}E${string}`;

export type UserSeriesProgress = {
  seriesTmdbId: number;
  watchedCount: number;
  /** Total planejado pelo TMDB — pode incluir episódios futuros. Não usar para progresso. */
  totalEpisodes: number | null;
  /**
   * Episódios que realmente foram ao ar (air_date <= now, season > 0).
   * Fonte de verdade para cálculos de progresso, remaining e percentual.
   */
  airedEpisodes: number;
  lastWatchedAt: string | null;
  /** Set serializável "S##E##" para hidratação no client. */
  watchedKeys: EpisodeKey[];
  /** Próximo episódio sugerido — nunca futuro, nunca placeholder, nunca S00. */
  nextEpisode: {
    seasonNumber: number;
    episodeNumber: number;
    airDate: string | null;
  } | null;
};

export type ToggleEpisodeInput = {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  watched: boolean;
  runtimeMinutes?: number | null;
};

function episodeKey(season: number, episode: number): EpisodeKey {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` as EpisodeKey;
}

async function getLocalEpisodeProgressService() {
  return import("@/server/local-services/episode-progress-local.service");
}

export async function toggleEpisodeWatched(
  input: ToggleEpisodeInput
): Promise<UserSeriesProgress> {
  const local = await getLocalEpisodeProgressService();
  return local.toggleEpisodeWatched(input);
}

export async function bulkMarkEpisodesWatched(input: {
  userId: string;
  seriesTmdbId: number;
  episodes: Array<{
    seasonNumber: number;
    episodeNumber: number;
    runtimeMinutes?: number | null;
  }>;
  /** Hint para o event log — "season_marked" quando bulk de uma temporada inteira. */
  eventType?: "season_marked" | "episode_watched" | "series_completed";
}): Promise<UserSeriesProgress> {
  const local = await getLocalEpisodeProgressService();
  return local.bulkMarkEpisodesWatched(input);
}

export async function markSeasonWatched(
  userId: string,
  seriesTmdbId: number,
  seasonNumber: number
): Promise<UserSeriesProgress> {
  const local = await getLocalEpisodeProgressService();
  return local.markSeasonWatched(userId, seriesTmdbId, seasonNumber);
}

export async function clearSeasonProgress(
  userId: string,
  seriesTmdbId: number,
  seasonNumber: number
): Promise<UserSeriesProgress> {
  const local = await getLocalEpisodeProgressService();
  return local.clearSeasonProgress(userId, seriesTmdbId, seasonNumber);
}

export async function clearSeriesProgress(
  userId: string,
  seriesTmdbId: number
): Promise<void> {
  const local = await getLocalEpisodeProgressService();
  return local.clearSeriesProgress(userId, seriesTmdbId);
}

export async function getWatchedEpisodesForSeries(
  userId: string,
  seriesTmdbId: number
): Promise<UserEpisodeRow[]> {
  const local = await getLocalEpisodeProgressService();
  return local.getWatchedEpisodesForSeries(userId, seriesTmdbId);
}

/**
 * Calcula progresso de uma única série.
 * Para carregar N séries de uma vez, use getUserWatchingSeries().
 */
export async function computeUserSeriesProgress(
  userId: string,
  seriesTmdbId: number
): Promise<UserSeriesProgress> {
  const local = await getLocalEpisodeProgressService();
  return local.computeUserSeriesProgress(userId, seriesTmdbId);
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH: carrega progresso de N séries com queries fixas (independente de N)
// ─────────────────────────────────────────────────────────────────────────────

export type UserWatchingSeriesRow = UserSeriesProgress & {
  title: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  mediaStatus: string | null;
  inLibraryStatus: string | null;
};

export async function getUserWatchingSeries(
  userId: string,
  limit = 50
): Promise<UserWatchingSeriesRow[]> {
  const local = await getLocalEpisodeProgressService();
  return local.getUserWatchingSeries(userId, limit);
}

export async function markAllAiredEpisodes(
  userId: string,
  seriesTmdbId: number
): Promise<UserSeriesProgress> {
  const local = await getLocalEpisodeProgressService();
  return local.markAllAiredEpisodes(userId, seriesTmdbId);
}

export async function markEpisodesUntil(input: {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<UserSeriesProgress> {
  const local = await getLocalEpisodeProgressService();
  return local.markEpisodesUntil(input);
}

