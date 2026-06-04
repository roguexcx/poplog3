/**
 * Balloonerismm Adapter — implementa CatalogAdapter usando a API Balloonerismm.
 *
 * Política de confiança:
 *   - source_confidence = "high"      quando IMDb ID confirmado no payload
 *   - source_confidence = "medium"    sem ID cruzado confirmado
 *   - source_confidence = "low"       dado incompleto ou não verificado
 *
 * Política operacional:
 *   - Nunca é primeira fonte global (BALLOONERISMM_ALLOW_PRIMARY=false por padrão)
 *   - Usado como enrichment/fallback forte, especialmente dados IMDb-first
 *   - Não deve ser chamado em massa no render — usar job/cache/hidratação sob demanda
 */

import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type {
  BalloonerismMovie,
  BalloonerismShow,
  BalloonerismSearchResult,
  BalloonerismPopularItem,
  BalloonerismCreditsResponse,
} from "@/server/api-clients/balloonerismm/types";

import type { CatalogAdapter } from "./catalog-adapter";
import type {
  CatalogTitle,
  CatalogSearchResult,
  CatalogSeason,
  CatalogEpisode,
  CatalogRatings,
  CatalogComment,
  CatalogPeople,
  CatalogVideo,
  CatalogCalendarItem,
  CatalogIds,
  SearchParams,
  GetTitleParams,
  GetSeasonsParams,
  GetEpisodesParams,
  TrendingParams,
  PopularParams,
  RelatedParams,
  RatingParams,
  CommentParams,
  PeopleParams,
  VideoParams,
  CalendarParams,
} from "../types/catalog.types";
import type { SourceMeta, SourceConfidence } from "../types/source.types";

import { normalizeTitle } from "../normalizers/normalize-title";
import { normalizeSearchResult } from "../normalizers/normalize-search";
import { normalizePeople } from "../normalizers/normalize-person";

// ─── Helpers de confiança ─────────────────────────────────────────────────────

/**
 * Calcula confidence com base no IMDb ID e completude do payload.
 * Regra do plano:
 *   - IMDb ID confirmado → high ou very_high
 *   - Sem ID cruzado confirmado → medium
 */
function resolveConfidence(imdbId: string | undefined | null, fieldCount: number): SourceConfidence {
  if (imdbId && imdbId.startsWith("tt")) {
    return fieldCount >= 5 ? "high" : "medium";
  }
  return "medium";
}

function sourceMeta(imdbId?: string | null, fieldCount = 3): SourceMeta {
  return {
    primary: "balloonerismm",
    confidence: resolveConfidence(imdbId, fieldCount),
    usedFallback: false,
    fetchedAt: new Date().toISOString(),
  };
}

// ─── Helpers de IDs ───────────────────────────────────────────────────────────

function resolveId(params: { imdbId?: string; traktId?: number; traktSlug?: string; tvdbId?: number }): string | null {
  // Balloonerismm é IMDb-first: preferir imdbId
  return params.imdbId ?? params.traktSlug ?? (params.traktId ? String(params.traktId) : null) ?? null;
}

function movieIds(item: BalloonerismMovie): CatalogIds {
  return {
    imdbId: item.imdb_id,
    tvdbId: item.ids?.tvdb,
    tmdbId: item.ids?.tmdb, // histórico apenas
  };
}

function showIds(item: BalloonerismShow): CatalogIds {
  return {
    imdbId: item.imdb_id,
    tvdbId: item.ids?.tvdb,
    tmdbId: item.ids?.tmdb,
  };
}

function countFields(obj: Record<string, unknown>): number {
  return Object.values(obj).filter((v) => v !== null && v !== undefined).length;
}

// ─── Converters ───────────────────────────────────────────────────────────────

function balloonerismMovieToTitle(movie: BalloonerismMovie): CatalogTitle {
  const meta = sourceMeta(movie.imdb_id, countFields(movie as unknown as Record<string, unknown>));
  return normalizeTitle(
    {
      ids: movieIds(movie),
      mediaType: "movie",
      title: movie.title,
      year: movie.year,
      overview: movie.overview,
      tagline: movie.tagline,
      runtime: movie.runtime,
      status: movie.status,
      genres: movie.genres,
      country: movie.country,
      language: movie.language,
      certification: movie.certification,
      rating: movie.rating,
      votes: movie.votes,
      posterRemoteUrl: movie.images?.poster,
      backdropRemoteUrl: movie.images?.backdrop,
    },
    meta,
  );
}

function balloonerismShowToTitle(show: BalloonerismShow): CatalogTitle {
  const meta = sourceMeta(show.imdb_id, countFields(show as unknown as Record<string, unknown>));
  return normalizeTitle(
    {
      ids: showIds(show),
      mediaType: "show",
      title: show.title,
      year: show.year,
      overview: show.overview,
      tagline: show.tagline,
      runtime: show.runtime,
      status: show.status,
      genres: show.genres,
      country: show.country,
      language: show.language,
      certification: show.certification,
      rating: show.rating,
      votes: show.votes,
      posterRemoteUrl: show.images?.poster,
      backdropRemoteUrl: show.images?.backdrop,
    },
    meta,
  );
}

function searchItemToResult(item: BalloonerismSearchResult | BalloonerismPopularItem): CatalogSearchResult {
  const meta = sourceMeta(item.imdb_id);
  return normalizeSearchResult(
    {
      ids: { imdbId: item.imdb_id },
      mediaType: item.media_type === "show" ? "show" : "movie",
      title: item.title,
      year: item.year,
      overview: item.overview,
      posterRemoteUrl: item.images?.poster,
    },
    meta,
  );
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const balloonerismAdapter: CatalogAdapter = {
  // ── Busca ──────────────────────────────────────────────────────────────────

  async searchTitles(params: SearchParams): Promise<CatalogSearchResult[]> {
    const path =
      params.mediaType === "movie" ? "/search/movie"
      : params.mediaType === "show" ? "/search/tv"
      : "/search/multi";
    const data = await balloonerismGet<BalloonerismSearchResult[]>(path, {
      params: { query: params.query, page: params.page ?? 1 },
      ttlSeconds: 3600,
    });
    if (!data) return [];
    return data.map(searchItemToResult);
  },

  // ── Filme ──────────────────────────────────────────────────────────────────

  async getMovie(params: GetTitleParams): Promise<CatalogTitle | null> {
    const id = resolveId(params);
    if (!id) return null;
    const data = await balloonerismGet<BalloonerismMovie>(`/movie/${id}`, { ttlSeconds: 604800 });
    if (!data) return null;
    return balloonerismMovieToTitle(data);
  },

  // ── Série ──────────────────────────────────────────────────────────────────

  async getShow(params: GetTitleParams): Promise<CatalogTitle | null> {
    const id = resolveId(params);
    if (!id) return null;
    const data = await balloonerismGet<BalloonerismShow>(`/tv/${id}`, { ttlSeconds: 86400 });
    if (!data) return null;
    return balloonerismShowToTitle(data);
  },

  // ── Temporadas — Balloonerismm não é fonte preferencial ───────────────────

  async getSeasons(_params: GetSeasonsParams): Promise<CatalogSeason[]> {
    // Balloonerismm não é fonte preferencial para temporadas (TheTVDB é superior)
    return [];
  },

  async getEpisodes(_params: GetEpisodesParams): Promise<CatalogEpisode[]> {
    // Balloonerismm não é fonte preferencial para episódios
    return [];
  },

  // ── Trending ───────────────────────────────────────────────────────────────

  async getTrending(params: TrendingParams): Promise<CatalogSearchResult[]> {
    const path = params.mediaType === "movie" ? "/popular/movie" : "/popular/tv";
    const data = await balloonerismGet<BalloonerismPopularItem[]>(path, {
      params: { limit: params.limit ?? 20, page: params.page ?? 1 },
      ttlSeconds: 3600,
    });
    if (!data) return [];
    return data.map(searchItemToResult);
  },

  // ── Popular ────────────────────────────────────────────────────────────────

  async getPopular(params: PopularParams): Promise<CatalogSearchResult[]> {
    const path = params.mediaType === "movie" ? "/popular/movie" : "/popular/tv";
    const data = await balloonerismGet<BalloonerismPopularItem[]>(path, {
      params: { limit: params.limit ?? 20, page: params.page ?? 1 },
      ttlSeconds: 21600,
    });
    if (!data) return [];
    return data.map(searchItemToResult);
  },

  // ── Relacionados ───────────────────────────────────────────────────────────

  async getRelated(params: RelatedParams): Promise<CatalogSearchResult[]> {
    const id = resolveId(params);
    if (!id) return [];
    const path = params.mediaType === "movie" ? `/movie/${id}/similar` : `/tv/${id}/similar`;
    const data = await balloonerismGet<BalloonerismSearchResult[]>(path, {
      params: { limit: 10 },
      ttlSeconds: 86400,
    });
    if (!data) return [];
    return data.map(searchItemToResult);
  },

  // ── Ratings ────────────────────────────────────────────────────────────────

  async getRatings(params: RatingParams): Promise<CatalogRatings | null> {
    const id = resolveId(params);
    if (!id) return null;
    const path = params.mediaType === "movie" ? `/movie/${id}/ratings` : `/tv/${id}/ratings`;
    const data = await balloonerismGet<{ rating?: number; votes?: number }>(path, {
      ttlSeconds: 3600,
    });
    if (!data?.rating) return null;
    const meta = sourceMeta(params.imdbId, 2);
    return {
      rating: data.rating,
      votes: data.votes,
      source: meta,
    };
  },

  // ── Comentários — Balloonerismm não é fonte de comentários sociais ────────

  async getComments(_params: CommentParams): Promise<CatalogComment[]> {
    return [];
  },

  // ── Pessoas ────────────────────────────────────────────────────────────────

  async getPeople(params: PeopleParams): Promise<CatalogPeople | null> {
    const id = resolveId(params);
    if (!id) return null;
    const path = params.mediaType === "movie" ? `/movie/${id}/credits` : `/tv/${id}/credits`;
    const data = await balloonerismGet<BalloonerismCreditsResponse>(path, {
      ttlSeconds: 2592000, // 30 dias — pessoas mudam raramente
    });
    if (!data) return null;

    const meta = sourceMeta(params.imdbId, 5);
    const cast = (data.cast ?? []).map((c) => ({
      ids: { imdbId: c.imdb_id },
      name: c.name,
      character: c.character,
      profileRemoteUrl: c.profile_path ?? undefined,
    }));
    const crew = (data.crew ?? []).map((c) => ({
      ids: { imdbId: c.imdb_id },
      name: c.name,
      job: c.job,
      department: c.department,
      profileRemoteUrl: c.profile_path ?? undefined,
    }));

    return normalizePeople(cast, crew, meta);
  },

  // ── Vídeos ─────────────────────────────────────────────────────────────────

  async getVideos(params: VideoParams): Promise<CatalogVideo[]> {
    const id = resolveId(params);
    if (!id) return [];
    const path = params.mediaType === "movie" ? `/movie/${id}/videos` : `/tv/${id}/videos`;
    const data = await balloonerismGet<Array<{ url: string; name?: string; type?: string }>>(
      path,
      { ttlSeconds: 21600 }, // 6h — URLs de vídeo têm TTL curto
    );
    if (!data) return [];
    const meta = sourceMeta(params.imdbId, 2);
    return data.map((v, i) => ({
      id: i,
      title: v.name ?? "Trailer",
      url: v.url,
      type: v.type ?? "trailer",
      source: meta,
    }));
  },

  // ── Calendário — Balloonerismm não é fonte de calendário ──────────────────

  async getCalendar(_params: CalendarParams): Promise<CatalogCalendarItem[]> {
    return [];
  },
};
