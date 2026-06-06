/**
 * Tipos de resposta da API Trakt.tv v2.
 * Referência: https://trakt.docs.apiary.io/
 */

export type TraktFetchOptions = {
  params?: Record<string, string | number | boolean>;
  ttlSeconds?: number;
  cache?: RequestCache;
  signal?: AbortSignal;
};

/** IDs externos retornados em objetos Trakt. */
export type TraktIds = {
  trakt?: number;
  slug?: string;
  imdb?: string;
  tmdb?: number;
  tvdb?: number;
  tvrage?: number;
};

/** Resposta de /shows/{id}/seasons (sem extended=full) */
export type TraktSeasonSummary = {
  number: number;
  ids: {
    trakt: number;
    tvdb?: number;
    tmdb?: number;
  };
};

/** Resposta de /shows/{id}/seasons?extended=full */
export type TraktSeasonFull = TraktSeasonSummary & {
  title?: string;
  overview?: string | null;
  first_aired?: string | null;
  episode_count?: number;
  aired_episodes?: number;
  rating?: number;
  votes?: number;
  network?: string;
  images?: {
    poster?: string[];
    thumb?: string[];
    fanart?: string[];
  } | null;
};

/** Episódio em /shows/{id}/seasons/{season}/episodes?extended=full,translations */
export type TraktEpisodeFull = {
  season: number;
  number: number;
  title?: string | null;
  ids: {
    trakt: number;
    tvdb?: number;
    tmdb?: number;
    imdb?: string;
  };
  overview?: string | null;
  first_aired?: string | null;
  updated_at?: string;
  rating?: number;
  votes?: number;
  runtime?: number | null;
  images?: {
    screenshot?: string[];
    thumb?: string[];
    fanart?: string[];
  } | null;
  translations?: TraktTranslation[] | null;
};

/** Resposta de /shows/{id} extended=full */
export type TraktShowFull = {
  title: string;
  year?: number;
  ids: TraktIds;
  overview?: string | null;
  first_aired?: string | null;
  airs?: {
    day?: string;
    time?: string;
    timezone?: string;
  };
  runtime?: number | null;
  certification?: string;
  network?: string;
  country?: string;
  status?: string;
  rating?: number;
  votes?: number;
  aired_episodes?: number;
  language?: string;
  genres?: string[];
  aired_seasons?: number;
  trailer?: string | null;
  homepage?: string | null;
  tagline?: string | null;
  available_translations?: string[];
  images?: {
    poster?: string[];
    fanart?: string[];
    logo?: string[];
    thumb?: string[];
    clearart?: string[];
    banner?: string[];
  } | null;
};

/** Resposta de /movies/{id} extended=full */
export type TraktMovieFull = {
  title: string;
  year?: number;
  ids: TraktIds;
  tagline?: string | null;
  overview?: string | null;
  released?: string | null;
  runtime?: number | null;
  country?: string;
  rating?: number;
  votes?: number;
  status?: string;
  language?: string;
  genres?: string[];
  certification?: string;
  trailer?: string | null;
  homepage?: string | null;
};

/** Trending item wrapper */
export type TraktTrendingItem<T> = {
  watchers: number;
  show?: T;
  movie?: T;
};

/** Popular/search result */
export type TraktSearchResult = {
  type: "movie" | "show";
  score?: number;
  show?: TraktShowFull;
  movie?: TraktMovieFull;
};

/** Item from /movies/{id}/translations/{lang} or /shows/{id}/translations/{lang} */
export type TraktTranslation = {
  title: string;
  overview: string;
  tagline?: string;
  language: string;
  country: string;
};
