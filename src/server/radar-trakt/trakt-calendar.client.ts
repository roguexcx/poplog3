import { traktGet } from "@/server/api-clients/trakt/client";
import type { TraktIds, TraktMovieFull, TraktShowFull } from "@/server/api-clients/trakt/types";

export type TraktCalendarEpisodeItem = {
  first_aired?: string | null;
  episode?: {
    season?: number;
    number?: number;
    title?: string | null;
    ids?: TraktIds;
    overview?: string | null;
  };
  show?: TraktShowFull;
};

export type TraktCalendarMovieItem = {
  released?: string | null;
  movie?: TraktMovieFull;
};

export type TraktMovieRelease = {
  country?: string;
  release_date?: string;
  release_type?: "premiere" | "limited" | "theatrical" | "digital" | "physical" | "tv" | "unknown" | string;
  note?: string | null;
};

export type TraktAnticipatedItem = {
  list_count?: number;
  show?: TraktShowFull;
  movie?: TraktMovieFull;
};

export async function fetchRadarCalendarWindow(startDate: string, days: number) {
  const params = { extended: "full" };
  const [shows, movies] = await Promise.all([
    traktGet<TraktCalendarEpisodeItem[]>(`/calendars/all/shows/${startDate}/${days}`, {
      params,
      cache: "no-store",
      ttlSeconds: 60 * 60,
      staleTtlSeconds: 24 * 60 * 60,
    }),
    traktGet<TraktCalendarMovieItem[]>(`/calendars/all/movies/${startDate}/${days}`, {
      params,
      cache: "no-store",
      ttlSeconds: 60 * 60,
      staleTtlSeconds: 24 * 60 * 60,
    }),
  ]);

  return { shows: shows ?? [], movies: movies ?? [] };
}

export async function fetchRadarMovieReleases(movieId: number | string, country: string) {
  return (
    (await traktGet<TraktMovieRelease[]>(`/movies/${movieId}/releases/${country}`, {
      ttlSeconds: 6 * 60 * 60,
      staleTtlSeconds: 7 * 24 * 60 * 60,
    })) ?? []
  );
}

export async function fetchRadarDiscovery() {
  const [shows, movies] = await Promise.all([
    traktGet<TraktAnticipatedItem[]>("/shows/anticipated", {
      params: { extended: "full", limit: 30 },
      ttlSeconds: 6 * 60 * 60,
      staleTtlSeconds: 7 * 24 * 60 * 60,
    }),
    traktGet<TraktAnticipatedItem[]>("/movies/anticipated", {
      params: { extended: "full", limit: 30 },
      ttlSeconds: 6 * 60 * 60,
      staleTtlSeconds: 7 * 24 * 60 * 60,
    }),
  ]);

  return { shows: shows ?? [], movies: movies ?? [] };
}

export async function fetchRadarUpdates(startDate: string) {
  const [shows, movies] = await Promise.all([
    traktGet<unknown[]>(`/sync/last_activities`, { ttlSeconds: 15 * 60 }),
    traktGet<unknown[]>(`/movies/updates/${startDate}`, { ttlSeconds: 15 * 60 }),
  ]);
  return { shows: shows ?? [], movies: movies ?? [] };
}
