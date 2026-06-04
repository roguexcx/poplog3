import { isTitleCacheFresh } from "@/server/cache/is-title-cache-fresh";
import { isSeasonCacheFresh } from "@/server/cache/season-cache";

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

      // TMDB title sync disabled
      clearRefresh(key);
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

      // TMDB season sync disabled
      clearRefresh(key);
    }),
  );
}
