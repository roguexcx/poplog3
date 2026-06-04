import type { DateRange } from "@/server/agenda/types";

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

export class DiscoverService {
  async discoverByProvider(
    _providerIds: number[],
    _region: string,
    _dateRange: DateRange,
    _mediaType: "movie" | "tv" = "tv",
  ): Promise<DiscoverMediaItem[]> {
    return [];
  }

  async discoverByKeywords(
    _keywords: number[],
    _mediaType: "movie" | "tv",
  ): Promise<DiscoverMediaItem[]> {
    return [];
  }

  async getProviderContent(
    _providerId: number,
    _region: string,
    _dateRange: DateRange,
  ): Promise<DiscoverMediaItem[]> {
    return [];
  }
}

export const discoverService = new DiscoverService();
