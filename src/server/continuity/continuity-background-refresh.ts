import { isTitleCacheFresh } from "@/server/cache/is-title-cache-fresh";
import { isSeasonCacheFresh } from "@/server/cache/season-cache";
import { syncTmdbSeason } from "@/server/sync/sync-tmdb-season";
import { syncTmdbTitle } from "@/server/sync/sync-tmdb-title";

type MediaType = "movie" | "tv";

type RefreshTitleTarget = {
  tmdbId: number;
  mediaType: MediaType;
  lastSyncedAt?: string | null;
};

type RefreshSeasonTarget = {
  seriesTmdbId: number;
  seasonNumber: number | null | undefined;
  lastSyncedAt?: string | null;
};

const TITLE_REFRESH_TTL_DAYS = 7;
const SEASON_REFRESH_TTL_DAYS = 7;
const DEDUPE_TTL_MS = 10 * 60 * 1000;
const pendingRefreshes = new Map<string, number>();

function shouldStartRefresh(key: string) {
  const pendingUntil = pendingRefreshes.get(key);
  if (pendingUntil && pendingUntil > Date.now()) return false;

  pendingRefreshes.set(key, Date.now() + DEDUPE_TTL_MS);
  return true;
}

function clearRefresh(key: string) {
  pendingRefreshes.delete(key);
}

function uniqueBy<T>(items: T[], getKey: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];

  for (const item of items) {
    const key = getKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }

  return result;
}

export function scheduleContinuityTitleRefresh(input: {
  context: string;
  targets: RefreshTitleTarget[];
  max?: number;
}) {
  const targets = uniqueBy(input.targets, (target) => `${target.mediaType}-${target.tmdbId}`)
    .filter(
      (target) =>
        Number.isFinite(target.tmdbId) &&
        target.tmdbId > 0 &&
        !isTitleCacheFresh(target.lastSyncedAt, TITLE_REFRESH_TTL_DAYS),
    )
    .slice(0, input.max ?? 4);

  if (targets.length === 0) return;

  void Promise.allSettled(
    targets.map(async (target) => {
      const key = `title:${target.mediaType}:${target.tmdbId}`;
      if (!shouldStartRefresh(key)) return;

      const startedAt = Date.now();
      try {
        const result = await syncTmdbTitle(target.mediaType, target.tmdbId, {
          force: false,
        });
        console.log("[continuity-background-refresh/title]", {
          context: input.context,
          mediaType: target.mediaType,
          tmdbId: target.tmdbId,
          source: result.source,
          cache_status: result.cache_status,
          duration: Date.now() - startedAt,
        });
      } catch (error) {
        console.warn("[continuity-background-refresh/title] failed", {
          context: input.context,
          mediaType: target.mediaType,
          tmdbId: target.tmdbId,
          error: error instanceof Error ? error.message : String(error),
        });
        clearRefresh(key);
      }
    }),
  );
}

export function scheduleContinuitySeasonRefresh(input: {
  context: string;
  targets: RefreshSeasonTarget[];
  max?: number;
}) {
  const targets = uniqueBy(
    input.targets,
    (target) => `${target.seriesTmdbId}:${target.seasonNumber ?? "x"}`,
  )
    .filter(
      (target) =>
        Number.isFinite(target.seriesTmdbId) &&
        target.seriesTmdbId > 0 &&
        Number.isFinite(target.seasonNumber) &&
        (target.seasonNumber ?? 0) > 0 &&
        !isSeasonCacheFresh(target.lastSyncedAt, SEASON_REFRESH_TTL_DAYS),
    )
    .slice(0, input.max ?? 6);

  if (targets.length === 0) return;

  void Promise.allSettled(
    targets.map(async (target) => {
      const seasonNumber = Number(target.seasonNumber);
      const key = `season:${target.seriesTmdbId}:${seasonNumber}`;
      if (!shouldStartRefresh(key)) return;

      const startedAt = Date.now();
      try {
        const result = await syncTmdbSeason(target.seriesTmdbId, seasonNumber, {
          force: false,
        });
        console.log("[continuity-background-refresh/season]", {
          context: input.context,
          seriesTmdbId: target.seriesTmdbId,
          seasonNumber,
          source: result.source,
          cache_status: result.cache_status,
          duration: Date.now() - startedAt,
        });
      } catch (error) {
        console.warn("[continuity-background-refresh/season] failed", {
          context: input.context,
          seriesTmdbId: target.seriesTmdbId,
          seasonNumber,
          error: error instanceof Error ? error.message : String(error),
        });
        clearRefresh(key);
      }
    }),
  );
}
