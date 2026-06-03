import { listUserTitleStates } from "@/server/repositories";

export type ContinuityStateRow = {
  tmdb_id: number;
  media_type: "tv" | "movie";
  status: string | null;
  computed_state: string | null;
  watched_episodes: number;
  aired_episodes: number | null;
  total_episodes: number | null;
  progress_pct: number | null;
  next_season: number | null;
  next_episode: number | null;
  next_episode_air_date: string | null;
  last_watched_at: string | null;
  watched_keys: string[] | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
  last_event_at: string;
};

const STATE_CACHE_TTL_MS = 1_500;
const STATE_CACHE_MAX_ENTRIES = 300;

type StateCacheEntry = {
  expiresAt: number;
  promise: Promise<ContinuityStateRow[]>;
};

const stateCache = new Map<string, StateCacheEntry>();

function pruneStateCache() {
  if (stateCache.size < STATE_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  for (const [key, entry] of stateCache) {
    if (entry.expiresAt <= now) stateCache.delete(key);
  }
}

export async function getContinuityStateRows(
  userId: string,
): Promise<ContinuityStateRow[]> {
  const cached = stateCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  pruneStateCache();

  const promise = (async () => {
    const result = await listUserTitleStates({ userId, limit: 500 });

    if (!result.ok) {
      console.error("[continuity-state-cache] user_title_state query failed", {
        message: result.error,
      });
      return [];
    }

    return result.data.map((row) => ({
      tmdb_id: row.tmdbId,
      media_type: row.mediaType as "tv" | "movie",
      status: row.status ?? null,
      computed_state: row.computedState ?? null,
      watched_episodes: row.watchedEpisodes,
      aired_episodes: row.airedEpisodes,
      total_episodes: row.totalEpisodes ?? null,
      progress_pct: row.progressPct,
      next_season: row.nextSeason ?? null,
      next_episode: row.nextEpisode ?? null,
      next_episode_air_date: row.nextEpisodeAirDate instanceof Date
        ? row.nextEpisodeAirDate.toISOString().slice(0, 10)
        : row.nextEpisodeAirDate ?? null,
      last_watched_at: row.lastWatchedAt instanceof Date
        ? row.lastWatchedAt.toISOString()
        : row.lastWatchedAt ?? null,
      watched_keys: Array.isArray(row.watchedKeys) ? row.watchedKeys as string[] : null,
      best_provider_name: row.bestProviderName ?? null,
      best_provider_type: row.bestProviderType ?? null,
      best_provider_logo: row.bestProviderLogo ?? null,
      last_event_at: row.lastEventAt instanceof Date
        ? row.lastEventAt.toISOString()
        : new Date().toISOString(),
    })) as ContinuityStateRow[];
  })();

  stateCache.set(userId, {
    expiresAt: Date.now() + STATE_CACHE_TTL_MS,
    promise,
  });

  return promise;
}
