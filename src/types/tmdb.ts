export type TMDBMediaType = "movie" | "tv";

export interface TMDBItem {
  id: number;
  media_type?: TMDBMediaType;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  last_air_date?: string | null;
  vote_average?: number;
  popularity?: number;
  genre_ids?: number[];
  number_of_seasons?: number | null;
}

export interface TMDBResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export type TMDBDetails = {
  id: number;
  overview?: string;
  genres?: { id: number; name: string }[];
  runtime?: number;
  release_date?: string;
  first_air_date?: string;
  number_of_seasons?: number;
  episode_run_time?: number[];
};
