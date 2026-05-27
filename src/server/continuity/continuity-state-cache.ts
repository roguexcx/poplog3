import { supabaseAdmin } from "@/server/supabase/admin";

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
    const { data, error } = await supabaseAdmin
      .from("user_title_state")
      .select(
        [
          "tmdb_id",
          "media_type",
          "status",
          "computed_state",
          "watched_episodes",
          "aired_episodes",
          "total_episodes",
          "progress_pct",
          "next_season",
          "next_episode",
          "next_episode_air_date",
          "last_watched_at",
          "watched_keys",
          "best_provider_name",
          "best_provider_type",
          "best_provider_logo",
          "last_event_at",
        ].join(", "),
      )
      .eq("user_id", userId)
      .order("last_event_at", { ascending: false })
      .limit(500);

      if (error) {
        console.error("[continuity-state-cache] user_title_state query failed", {
          message: error.message,
          code: error.code,
          details: error.details,
        });
        return [];
      }

      return (data ?? []) as unknown as ContinuityStateRow[];
  })();

  stateCache.set(userId, {
    expiresAt: Date.now() + STATE_CACHE_TTL_MS,
    promise,
  });

  return promise;
}
