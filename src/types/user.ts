export type MediaType = "movie" | "tv";

/** Nível de granularidade de uma avaliação POPLOG. */
export type RatingMediaType = "movie" | "tv" | "season" | "episode";

/** Como a nota foi gerada. */
export type RatingSource =
  | "explicit"       // usuário deu a nota manualmente
  | "inferred"       // derivada de notas de episódios/temporadas
  | "imported"       // importada de fonte externa
  | "system_estimate"; // estimativa do sistema (poucos dados)

/** Avaliação pessoal do usuário para um item. */
export type UserRatingData = {
  rating: number;          // 0–5, incrementos de 0.5
  ratingSource: RatingSource;
  createdAt: string;
  updatedAt: string;
};

/** Agregado público da comunidade POPLOG para um item. */
export type CommunityRatingData = {
  averageRating: number | null;      // média geral (explícita + inferida)
  explicitAvgRating: number | null;  // média só de notas explícitas
  ratingCount: number;
  explicitRatingCount: number;
  inferredRatingCount: number;
  confidenceLevel: "low" | "medium" | "high";
};

export type UserTitle = {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  poplogId?: string | number | null;
  externalIds?: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: number;
    traktId?: number | string;
    balloonerismmId?: string;
    slug?: string;
  };
  identityUsed?: string;
  linkIdUsed?: string | number;
  imdb_id?: string | null;
  status: string;
  favorite: boolean;
  liked?: boolean | null;
  created_at: string;
  watched_at: string | null;
  title: string | null;
  release_year: number | null;
  fridge?: boolean | null;
  stream_status?: string | null;
  stream_status_checked_at?: string | null;
};
