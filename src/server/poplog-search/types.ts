/**
 * Tipos da camada de busca unificada do POPLOG.
 * Entidades normalizadas (filme/série/pessoa) servidas com cache local.
 */

export type PoplogSearchEntityType = "movie" | "tv" | "person";

export type PoplogSearchQueryType = "text" | "imdb" | "tmdb" | "trakt" | "slug";

export type PoplogSearchEntity = {
  type: PoplogSearchEntityType;
  id: string;
  title?: string | null;
  name?: string | null;
  originalTitle?: string | null;
  originalName?: string | null;
  year?: number | null;
  overview?: string | null;
  posterUrl?: string | null;
  profileImage?: string | null;
  href: string | null;
  score?: number | null;
  /** Departamento principal da pessoa (ex.: "Acting", "Directing"). */
  knownForDepartment?: string | null;
  /** Trabalhos de destaque da pessoa, quando a fonte traz. */
  knownFor?: Array<{
    id?: string | number | null;
    title?: string | null;
    name?: string | null;
    mediaType?: "movie" | "tv" | null;
    year?: number | null;
    posterUrl?: string | null;
    href?: string | null;
  }> | null;
  externalIds?: {
    imdbId?: string | null;
    tmdbId?: number | null;
    traktId?: number | string | null;
    traktSlug?: string | null;
  };
  sources?: {
    trakt?: boolean;
    balloonerismm?: boolean;
    localCache?: boolean;
  };
};

export type PoplogSearchEntitiesResult = {
  query: string;
  queryNormalized: string;
  queryType: PoplogSearchQueryType;
  results: PoplogSearchEntity[];
  grouped: {
    movies: PoplogSearchEntity[];
    tv: PoplogSearchEntity[];
    people: PoplogSearchEntity[];
  };
  meta: {
    cache: "missing" | "fresh" | "stale" | "expired";
    usedStaleFallback?: boolean;
    sources: {
      trakt?: boolean;
      balloonerismm?: boolean;
    };
  };
};
