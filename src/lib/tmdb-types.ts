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

  vote_average?: number;

  popularity?: number;

  genre_ids?: number[];
}

export interface TMDBResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}