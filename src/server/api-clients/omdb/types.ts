export type OmdbRating = {
  Source: string;
  Value: string;
};

export type OmdbTitleResponse = {
  Title?: string;
  Year?: string;
  Rated?: string;
  Released?: string;
  Runtime?: string;
  Genre?: string;
  Director?: string;
  Writer?: string;
  Actors?: string;
  Plot?: string;
  Language?: string;
  Country?: string;
  Awards?: string;
  Poster?: string;
  Ratings?: OmdbRating[];
  Metascore?: string;
  imdbRating?: string;
  imdbVotes?: string;
  imdbID?: string;
  Type?: string;
  /** Bilheteria doméstica (EUA), ex: "$37,834,891". Disponível para filmes. */
  BoxOffice?: string;
  Response?: "True" | "False";
  Error?: string;
};