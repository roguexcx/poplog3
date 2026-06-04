import type { SourceMeta } from "./source.types";

export type CatalogIds = {
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  traktId?: number | string;
  traktSlug?: string;
  balloonerismmId?: string;
  slug?: string;
};

export type CatalogTitle = {
  ids: CatalogIds;
  mediaType: "movie" | "show";
  title: string;
  year?: number;
  overview?: string;
  tagline?: string;
  runtime?: number;
  status?: string;
  genres?: string[];
  country?: string;
  language?: string;
  certification?: string;
  rating?: number;
  votes?: number;
  posterPath?: string;
  backdropPath?: string;
  source: SourceMeta;
};

export type CatalogSearchResult = {
  ids: CatalogIds;
  mediaType: "movie" | "show";
  title: string;
  originalTitle?: string;
  year?: number;
  releaseDate?: string;
  firstAirDate?: string;
  overview?: string;
  posterPath?: string;
  backdropPath?: string | null;
  genres?: string[];
  genreIds?: number[];
  voteAverage?: number;
  voteCount?: number;
  source: SourceMeta;
};

export type CatalogSeason = {
  ids: CatalogIds;
  number: number;
  title?: string;
  posterPath?: string;
  source: SourceMeta;
};

export type CatalogEpisode = {
  ids: CatalogIds;
  season: number;
  number: number;
  title?: string;
  overview?: string;
  firstAired?: string;
  runtime?: number;
  stillPath?: string;
  source: SourceMeta;
};

export type CatalogRatings = {
  rating?: number;
  votes?: number;
  source: SourceMeta;
};

export type CatalogComment = {
  id: string;
  text: string;
  source: SourceMeta;
};

export type CatalogPersonEntry = {
  ids: CatalogIds;
  name: string;
  character?: string;
  job?: string;
  department?: string;
  profileRemoteUrl?: string;
};

export type CatalogPeople = {
  cast: CatalogPersonEntry[];
  crew: CatalogPersonEntry[];
  source: SourceMeta;
};

export type CatalogVideo = {
  id: number;
  title: string;
  url: string;
  type: string;
  source: SourceMeta;
};

export type CatalogCalendarItem = {
  ids?: CatalogIds;
  title?: string;
  date?: string;
  source?: SourceMeta;
};

// ── Param types ────────────────────────────────────────────────────────────────

export type SearchParams = {
  query: string;
  mediaType?: "movie" | "show";
  page?: number;
};

export type GetTitleParams = {
  tmdbId?: number;
  imdbId?: string;
  tvdbId?: number;
  traktId?: number;
  traktSlug?: string;
};

export type GetSeasonsParams = {
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  season?: number;
};

export type GetEpisodesParams = {
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  season: number;
};

export type TrendingParams = {
  mediaType: "movie" | "show";
  limit?: number;
  page?: number;
};

export type PopularParams = {
  mediaType: "movie" | "show";
  limit?: number;
  page?: number;
};

export type RelatedParams = {
  mediaType: "movie" | "show";
  tmdbId?: number;
  imdbId?: string;
  traktId?: number;
  traktSlug?: string;
};

export type RatingParams = {
  mediaType: "movie" | "show";
  imdbId?: string;
  traktId?: number;
  tvdbId?: number;
};

export type CommentParams = {
  mediaType: "movie" | "show";
  tmdbId?: number;
};

export type PeopleParams = {
  mediaType: "movie" | "show";
  tvdbId?: number;
  imdbId?: string;
  traktId?: number;
  traktSlug?: string;
};

export type VideoParams = {
  mediaType: "movie" | "show";
  tvdbId?: number;
  imdbId?: string;
};

export type CalendarParams = {
  mediaType?: "movie" | "show";
  startDate?: string;
  days?: number;
};
