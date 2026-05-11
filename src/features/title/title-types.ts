// src/features/title/title-types.ts

export interface TMDBGenre {
  id: number;
  name: string;
}

export interface TMDBCastMember {
  id: number;
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

export interface TMDBCrewMember {
  id: number;
  name: string;
  job: string;
  department: string;
  profile_path?: string | null;
}

export interface TMDBVideo {
  id: string;
  key: string;
  name: string;
  site: string;
  type: string;
  official: boolean;
  iso_639_1?: string;
}

export interface TMDBEpisode {
  id: number;
  episode_number: number;
  name: string;
  overview: string;
  runtime: number | null;
  still_path: string | null;
  air_date: string | null;
  status?: "released" | "scheduled" | "undated" | "hidden";
  available?: boolean;
}

export interface TMDBStreamingProvider {
  provider_id: number;
  provider_name: string;
  logo_path: string;
  kind: "stream" | "rent";
}

export interface TMDBSeason {
  id: number;
  season_number: number;
  name: string;
  episode_count: number;
  air_date: string | null;
  poster_path: string | null;
  overview: string;
  episodes?: TMDBEpisode[];
  status?: "released" | "scheduled" | "announced" | "hidden";
  isVisible?: boolean;
  isNavigable?: boolean;
}

export interface TMDBRelatedItem {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  media_type?: string;
}

export type TitleActionSeason = {
  season_number: number;
  episodes?: {
    episode_number: number;
    air_date?: string | null;
  }[];
};

export type RawCandidate = TMDBRelatedItem & {
  _fromRecommendations: boolean;
  _fromSimilar: boolean;
};

export interface TMDBTitleDetail {
  id: number;
  // movie
  title?: string;
  release_date?: string;
  runtime?: number;
  original_title?: string;
  // tv
  name?: string;
  original_name?: string;
  first_air_date?: string;
  last_air_date?: string;
  episode_run_time?: number[];
  number_of_seasons?: number;
  number_of_episodes?: number;
  seasons?: TMDBSeason[];
  status?: string;
  created_by?: Array<{ id: number; name: string; profile_path: string | null }>;
  networks?: Array<{ id: number; name: string; logo_path: string | null }>;
  // shared
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  genres?: TMDBGenre[];
  original_language?: string;
  keywords?: {
    keywords?: Array<{ id: number; name: string }>;
    results?: Array<{ id: number; name: string }>;
  };
  production_countries?: Array<{ iso_3166_1: string; name: string }>;
  production_companies?: Array<{ id: number; name: string; logo_path?: string | null }>;
  budget?: number;
  revenue?: number;
  belongs_to_collection?: {
    id: number;
    name: string;
    poster_path: string | null;
    backdrop_path: string | null;
  } | null;
  // appended responses
  credits?: {
    cast: TMDBCastMember[];
    crew: TMDBCrewMember[];
  };
  videos?: {
    results: TMDBVideo[];
  };
  "watch/providers"?: {
    results: {
      BR?: {
        link?: string;
        flatrate?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
        free?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
        ads?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
        rent?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
        buy?: Array<{ provider_id: number; provider_name: string; logo_path: string }>;
      };
    };
  };
  recommendations?: { results: TMDBRelatedItem[] };
  similar?: { results: TMDBRelatedItem[] };
  release_dates?: {
    results: Array<{
      iso_3166_1: string;
      release_dates: Array<{ certification: string; type: number }>;
    }>;
  };
  content_ratings?: {
    results: Array<{ iso_3166_1: string; rating: string }>;
  };
}
