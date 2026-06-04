import type { IcsSeriesGroup } from "@/lib/ics-engine";

export const TMDB_TRENDING_FEED_ENABLED_BY_ENV = false;
export const TMDB_TRENDING_FEED_ENABLED = false;

export function isTmdbFeedEnabled(): boolean {
  return false;
}

export function setTmdbFeedEnabled(_enabled: boolean): void {}

export function resetTmdbFeedOverride(): void {}

export interface TmdbTrendingResult {
  groups: IcsSeriesGroup[];
  trendingDayIds: number[];
  trendingWeekIds: number[];
  stats: {
    fetchedDay: number;
    fetchedWeek: number;
    fetchedAiring: number;
    blockedStructural: number;
    blockedEligibility: number;
    passed: number;
  };
}

export async function fetchTmdbTrendingFeed(): Promise<TmdbTrendingResult> {
  return {
    groups: [],
    trendingDayIds: [],
    trendingWeekIds: [],
    stats: { fetchedDay: 0, fetchedWeek: 0, fetchedAiring: 0, blockedStructural: 0, blockedEligibility: 0, passed: 0 },
  };
}
