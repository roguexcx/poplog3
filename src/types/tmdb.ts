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
  personalScore?: number;
  feedbackPenaltyApplied?: number;
  userFeedback?: {
    notInterested?: boolean;
    activeTypes?: string[];
  };
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

// ─── Imagens ─────────────────────────────────────────────────────────────────
// Resposta do endpoint /{movie|tv}/{id}/images do TMDB.

export interface TMDBImage {
  file_path: string;
  iso_639_1?: string | null;
  width?: number;
  height?: number;
  vote_average?: number;
  vote_count?: number;
  aspect_ratio?: number;
}

export interface TMDBImagesResponse {
  id?: number;
  backdrops?: TMDBImage[];
  posters?: TMDBImage[];
  logos?: TMDBImage[];
  stills?: TMDBImage[];
  profiles?: TMDBImage[];
}
