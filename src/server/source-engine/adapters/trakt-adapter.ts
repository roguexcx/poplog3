/**
 * Trakt.tv Adapter — implementa CatalogAdapter usando a API Trakt v2.
 *
 * Domínio preferencial:
 *   - Séries: seasons, episode list, episode count por temporada
 *   - Identificadores cruzados: slug ↔ imdbId ↔ traktId ↔ tvdbId
 *   - Lookup de número de seasons quando TVDB e Balloonerismm falham
 *
 * Trakt identifica shows pelo imdbId diretamente nos endpoints:
 *   GET /shows/{imdbId}/seasons?extended=full
 *   GET /shows/{imdbId}/seasons/{n}/episodes?extended=full
 *
 * Rate limit público: 1.000 req / 5 min por IP.
 * Activar via TRAKT_ACTIVE=true + TRAKT_CLIENT_ID.
 */

import { traktGet } from "@/server/api-clients/trakt/client";
import type {
  TraktShowFull,
  TraktMovieFull,
  TraktSeasonFull,
  TraktEpisodeFull,
  TraktSearchResult,
} from "@/server/api-clients/trakt/types";

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
  SearchParams,
  GetTitleParams,
  GetSeasonsParams,
  GetEpisodesParams,
  TrendingParams,
  PopularParams,
  DiscoverParams,
  RelatedParams,
  RatingParams,
  CommentParams,
  PeopleParams,
  VideoParams,
  CalendarParams,
} from "../types/catalog.types";
import type { SourceMeta } from "../types/source.types";

import { normalizeTitle } from "../normalizers/normalize-title";
import { normalizeSearchResult } from "../normalizers/normalize-search";
import { normalizeSeason } from "../normalizers/normalize-season";
import { normalizeEpisode } from "../normalizers/normalize-episode";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HIGH: SourceMeta = { primary: "trakt", confidence: "high", usedFallback: false };
const MED: SourceMeta = { primary: "trakt", confidence: "medium", usedFallback: false };

/** Resolve o identificador Trakt mais confiável para um show/movie. */
function traktId(params: GetTitleParams): string | null {
  if (params.imdbId) return params.imdbId;
  if (params.traktSlug) return params.traktSlug;
  if (params.traktId) return String(params.traktId);
  return null;
}

function mapTraktStatus(status?: string | null): string | undefined {
  if (!status) return undefined;
  const map: Record<string, string> = {
    "returning series": "returning series",
    "ended": "ended",
    "canceled": "ended",
    "in production": "in_production",
    "pilot": "pilot",
    "planned": "planned",
  };
  return map[status.toLowerCase()] ?? status.toLowerCase();
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const traktAdapter: CatalogAdapter = {
  // ── Busca ──────────────────────────────────────────────────────────────────

  async searchTitles(params: SearchParams): Promise<CatalogSearchResult[]> {
    const type = params.mediaType === "movie" ? "movie" : params.mediaType === "show" ? "show" : "movie,show";
    const results = await traktGet<TraktSearchResult[]>(`/search/${type}`, {
      params: { query: params.query, limit: 20 },
      ttlSeconds: 3600,
    });
    if (!results) return [];

    return results
      .map((item) => {
        const entry = item.show ?? item.movie;
        if (!entry) return null;
        return normalizeSearchResult(
          {
            ids: {
              traktId: entry.ids.trakt,
              traktSlug: entry.ids.slug,
              imdbId: entry.ids.imdb,
              tmdbId: entry.ids.tmdb,
              tvdbId: (entry as TraktShowFull).ids?.tvdb,
            },
            mediaType: item.type === "movie" ? "movie" : "show",
            title: entry.title,
            year: entry.year,
            overview: entry.overview ?? undefined,
          },
          MED,
        );
      })
      .filter((r): r is CatalogSearchResult => r !== null);
  },

  // ── Filmes ─────────────────────────────────────────────────────────────────

  async getMovie(params: GetTitleParams): Promise<CatalogTitle | null> {
    const id = traktId(params);
    if (!id) return null;

    const movie = await traktGet<TraktMovieFull>(`/movies/${id}`, {
      params: { extended: "full" },
      ttlSeconds: 86400,
    });
    if (!movie) return null;

    return normalizeTitle(
      {
        ids: {
          traktId: movie.ids.trakt,
          traktSlug: movie.ids.slug,
          imdbId: movie.ids.imdb,
          tmdbId: movie.ids.tmdb,
        },
        mediaType: "movie",
        title: movie.title,
        year: movie.year,
        overview: movie.overview ?? undefined,
        runtime: movie.runtime ?? undefined,
        status: movie.status ?? undefined,
        genres: movie.genres,
        country: movie.country,
        language: movie.language,
        rating: movie.rating,
        votes: movie.votes,
      },
      HIGH,
    );
  },

  // ── Séries ─────────────────────────────────────────────────────────────────

  async getShow(params: GetTitleParams): Promise<CatalogTitle | null> {
    const id = traktId(params);
    if (!id) return null;

    const show = await traktGet<TraktShowFull>(`/shows/${id}`, {
      params: { extended: "full" },
      ttlSeconds: 86400,
    });
    if (!show) return null;

    const normalized = normalizeTitle(
      {
        ids: {
          traktId: show.ids.trakt,
          traktSlug: show.ids.slug,
          imdbId: show.ids.imdb,
          tmdbId: show.ids.tmdb,
          tvdbId: show.ids.tvdb,
        },
        mediaType: "show",
        title: show.title,
        year: show.year,
        overview: show.overview ?? undefined,
        tagline: show.tagline ?? undefined,
        runtime: show.runtime ?? undefined,
        status: mapTraktStatus(show.status),
        genres: show.genres,
        country: show.country,
        language: show.language,
        rating: show.rating,
        votes: show.votes,
        numberOfSeasons: show.aired_seasons ?? undefined,
      },
      HIGH,
    );

    // Enrich with Trakt-specific rich fields
    return {
      ...normalized,
      trailerUrl: show.trailer ?? null,
      homepage: show.homepage ?? null,
      airedEpisodes: show.aired_episodes ?? null,
      availableTranslations: show.available_translations ?? [],
      network: show.network ?? null,
      logoUrl: show.images?.logo?.[0] ?? null,
    };
  },

  // ── Temporadas ─────────────────────────────────────────────────────────────

  async getSeasons(params: GetSeasonsParams): Promise<CatalogSeason[]> {
    const id = params.imdbId;
    if (!id) return [];

    const seasons = await traktGet<TraktSeasonFull[]>(`/shows/${id}/seasons`, {
      params: { extended: "episodes,images" },
      ttlSeconds: 86400,
    });
    if (!seasons) return [];

    return seasons
      .filter((s) => s.number > 0) // exclui especiais (season 0)
      .map((s) =>
        normalizeSeason(
          {
            ids: { traktId: s.ids.trakt, tvdbId: s.ids.tvdb, tmdbId: s.ids.tmdb },
            number: s.number,
            title: s.title,
            posterRemoteUrl: s.images?.poster?.[0] ?? s.images?.thumb?.[0],
          },
          HIGH,
        ),
      );
  },

  // ── Episódios ──────────────────────────────────────────────────────────────

  async getEpisodes(params: GetEpisodesParams): Promise<CatalogEpisode[]> {
    const id = params.imdbId;
    if (!id) return [];

    const episodes = await traktGet<TraktEpisodeFull[]>(
      `/shows/${id}/seasons/${params.season}/episodes`,
      {
        params: { extended: "full,images,translations" },
        ttlSeconds: 86400,
      },
    );
    if (!episodes) return [];

    return episodes
      .filter((ep) => ep.number > 0)
      .map((ep) => {
        // Extract best PT-BR translation from the translations array (when available)
        const ptBr = ep.translations?.find(
          (t) => t.language === "pt" && t.country === "br",
        );
        const pt = ep.translations?.find((t) => t.language === "pt");
        const bestPtTr = ptBr ?? pt;

        const title = bestPtTr?.title?.trim() || ep.title || undefined;
        const overview = bestPtTr?.overview?.trim() || ep.overview || undefined;
        const hasPtBrText = Boolean(bestPtTr?.title || bestPtTr?.overview);
        const titleLanguage = hasPtBrText ? "pt-BR" : "eng";
        const overviewLanguage = hasPtBrText ? "pt-BR" : "eng";

        return normalizeEpisode(
          {
            ids: {
              traktId: ep.ids.trakt,
              tvdbId: ep.ids.tvdb,
              tmdbId: ep.ids.tmdb,
              imdbId: ep.ids.imdb,
            },
            season: ep.season,
            number: ep.number,
            title,
            originalTitle: hasPtBrText ? ep.title ?? undefined : undefined,
            overview,
            originalOverview: hasPtBrText ? ep.overview ?? undefined : undefined,
            titleLanguage,
            overviewLanguage,
            textLanguage: titleLanguage,
            firstAired: ep.first_aired ?? undefined,
            runtime: ep.runtime ?? undefined,
            stillRemoteUrl: ep.images?.screenshot?.[0] ?? ep.images?.thumb?.[0] ?? ep.images?.fanart?.[0],
            stillSource: "trakt",
            imageCandidates: [
              ...(ep.images?.screenshot ?? []).map((url) => ({
                source: "trakt" as const,
                url,
                kind: "screenshot",
                confidence: "medium" as const,
              })),
              ...(ep.images?.thumb ?? []).map((url) => ({
                source: "trakt" as const,
                url,
                kind: "thumb",
                confidence: "medium" as const,
              })),
            ],
          },
          HIGH,
        );
      });
  },

  // ── Trending / Popular ─────────────────────────────────────────────────────

  async getTrending(params: TrendingParams): Promise<CatalogSearchResult[]> {
    type TraktTrending = { watchers: number; show?: TraktShowFull; movie?: TraktMovieFull };
    const endpoint = params.mediaType === "movie" ? "/movies/trending" : "/shows/trending";
    const results = await traktGet<TraktTrending[]>(endpoint, {
      params: { limit: params.limit ?? 20 },
      ttlSeconds: 3600,
    });
    if (!results) return [];

    return results
      .map((item) => {
        const entry = item.show ?? item.movie;
        if (!entry) return null;
        return normalizeSearchResult(
          {
            ids: {
              traktId: entry.ids.trakt,
              traktSlug: entry.ids.slug,
              imdbId: entry.ids.imdb,
              tmdbId: entry.ids.tmdb,
            },
            mediaType: item.show ? "show" : "movie",
            title: entry.title,
            year: entry.year,
          },
          MED,
        );
      })
      .filter((r): r is CatalogSearchResult => r !== null);
  },

  async getPopular(_params: PopularParams): Promise<CatalogSearchResult[]> {
    return [];
  },

  async getDiscover(_params: DiscoverParams): Promise<CatalogSearchResult[]> {
    return [];
  },

  async getRelated(params: RelatedParams): Promise<CatalogSearchResult[]> {
    const id = params.imdbId ?? params.traktSlug ?? (params.traktId ? String(params.traktId) : null);
    if (!id) return [];

    const type = params.mediaType === "movie" ? "movies" : "shows";
    const results = await traktGet<Array<TraktShowFull | TraktMovieFull>>(`/${type}/${id}/related`, {
      params: { limit: 12 },
      ttlSeconds: 86400,
    });
    if (!results) return [];

    return results.map((entry) =>
      normalizeSearchResult(
        {
          ids: {
            traktId: entry.ids.trakt,
            traktSlug: entry.ids.slug,
            imdbId: entry.ids.imdb,
            tmdbId: entry.ids.tmdb,
          },
          mediaType: params.mediaType,
          title: entry.title,
          year: entry.year,
        },
        MED,
      ),
    );
  },

  async getRatings(params: RatingParams): Promise<CatalogRatings | null> {
    const id = params.imdbId;
    if (!id) return null;
    const type = params.mediaType === "movie" ? "movies" : "shows";
    const show = await traktGet<{ rating?: number; votes?: number }>(`/${type}/${id}/ratings`, {
      ttlSeconds: 3600,
    });
    if (!show) return null;
    return {
      rating: show.rating,
      votes: show.votes,
      source: MED,
    };
  },

  async getComments(_params: CommentParams): Promise<CatalogComment[]> {
    return [];
  },

  async getPeople(_params: PeopleParams): Promise<CatalogPeople | null> {
    return null;
  },

  async getVideos(_params: VideoParams): Promise<CatalogVideo[]> {
    return [];
  },

  async getCalendar(_params: CalendarParams): Promise<CatalogCalendarItem[]> {
    return [];
  },
};
