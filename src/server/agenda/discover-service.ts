import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { CACHE_TTL } from "@/server/cache/cache-config";
import type { DateRange } from "@/server/agenda/types";

const WITHOUT_TALK_AND_NEWS = "10767,10763";

export type DiscoverMediaItem = {
  id: number;
  media_type?: "movie" | "tv";
  title?: string;
  name?: string;
  original_language?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
};

type TmdbPageResult<T> = {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
};

function withDateRange(
  mediaType: "movie" | "tv",
  dateRange?: DateRange,
): Record<string, string> {
  if (!dateRange) return {};

  if (mediaType === "movie") {
    return {
      "primary_release_date.gte": dateRange.start,
      "primary_release_date.lte": dateRange.end,
    };
  }

  return {
    "air_date.gte": dateRange.start,
    "air_date.lte": dateRange.end,
  };
}

export class DiscoverService {
  async discoverByProvider(
    providerIds: number[],
    region: string,
    dateRange: DateRange,
    mediaType: "movie" | "tv" = "tv",
  ): Promise<DiscoverMediaItem[]> {
    if (providerIds.length === 0) return [];

    const response = await tmdbFetch<TmdbPageResult<DiscoverMediaItem>>(
      `/discover/${mediaType}`,
      {
        params: {
          ...withDateRange(mediaType, dateRange),
          with_watch_providers: providerIds.join("|"),
          watch_region: region,
          "vote_count.gte": 10,
          sort_by: "popularity.desc",
          without_genres: mediaType === "tv" ? WITHOUT_TALK_AND_NEWS : undefined,
          page: 1,
        },
        revalidate: CACHE_TTL.tmdb.discoverProvider,
      },
    );

    return response.results;
  }

  async discoverByKeywords(
    keywords: number[],
    mediaType: "movie" | "tv",
  ): Promise<DiscoverMediaItem[]> {
    if (keywords.length === 0) return [];

    const response = await tmdbFetch<TmdbPageResult<DiscoverMediaItem>>(
      `/discover/${mediaType}`,
      {
        params: {
          with_keywords: keywords.join("|"),
          "vote_count.gte": 20,
          sort_by: "popularity.desc",
          without_genres: mediaType === "tv" ? WITHOUT_TALK_AND_NEWS : undefined,
          page: 1,
        },
        revalidate: CACHE_TTL.tmdb.discoverCalendar,
      },
    );

    return response.results.map((item) => ({ ...item, media_type: mediaType }));
  }

  async getProviderContent(
    providerId: number,
    region: string,
    dateRange: DateRange,
  ): Promise<DiscoverMediaItem[]> {
    return this.discoverByProvider([providerId], region, dateRange, "tv");
  }
}

export const discoverService = new DiscoverService();
