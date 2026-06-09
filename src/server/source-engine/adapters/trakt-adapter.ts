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
  TraktPeople,
  TraktVideoItem,
  TraktStudio,
  TraktEpisodeSummary,
  TraktNetwork,
} from "@/server/api-clients/trakt/types";
import { normalizeNetworkSlug } from "@/lib/networks/normalize";

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

function ptBrTranslationTitle(entry: TraktShowFull | TraktMovieFull): string | null {
  const translations = entry.translations;
  if (!Array.isArray(translations)) return null;
  return (
    translations.find((t) => t.language === "pt" && t.country === "br" && t.title)?.title ??
    translations.find((t) => t.language === "pt" && t.title)?.title ??
    null
  );
}

function normalizeGenreToId(genre: string | null | undefined): number | undefined {
  if (!genre) return undefined;
  const key = genre.toLowerCase().replace(/[-_]+/g, " ");
  const map: Record<string, number> = {
    action: 28,
    adventure: 12,
    animation: 16,
    comedy: 35,
    crime: 80,
    documentary: 99,
    drama: 18,
    family: 10751,
    fantasy: 14,
    history: 36,
    horror: 27,
    music: 10402,
    mystery: 9648,
    romance: 10749,
    "science fiction": 878,
    "sci fi": 878,
    thriller: 53,
    war: 10752,
    western: 37,
    reality: 10764,
    soap: 10766,
    talk: 10767,
  };
  return map[key];
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const traktAdapter: CatalogAdapter = {
  // ── Busca ──────────────────────────────────────────────────────────────────

  async searchTitles(params: SearchParams): Promise<CatalogSearchResult[]> {
    const type = params.mediaType === "movie" ? "movie" : params.mediaType === "show" ? "show" : "movie,show";
    const results = await traktGet<TraktSearchResult[]>(`/search/${type}`, {
      params: { query: params.query, limit: 20, extended: "full,images" },
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
              slug: entry.ids.slug,
              imdbId: entry.ids.imdb,
              tmdbId: entry.ids.tmdb,
              tvdbId: (entry as TraktShowFull).ids?.tvdb,
            },
            mediaType: item.type === "movie" ? "movie" : "show",
            title: entry.title,
            year: entry.year,
            overview: entry.overview ?? undefined,
            posterRemoteUrl: entry.images?.poster?.[0] ?? null,
            backdropRemoteUrl: entry.images?.fanart?.[0] ?? entry.images?.thumb?.[0] ?? null,
            genres: entry.genres,
            voteAverage: entry.rating,
            voteCount: entry.votes,
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
      params: { extended: "full,images,translations" },
      ttlSeconds: 86400,
    });
    if (!movie) return null;

    return normalizeTitle(
      {
          ids: {
            traktId: movie.ids.trakt,
            traktSlug: movie.ids.slug,
            slug: movie.ids.slug,
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
        posterRemoteUrl: movie.images?.poster?.[0] ?? undefined,
        backdropRemoteUrl: movie.images?.fanart?.[0] ?? movie.images?.thumb?.[0] ?? undefined,
      },
      HIGH,
    );
  },

  // ── Séries ─────────────────────────────────────────────────────────────────

  async getShow(params: GetTitleParams): Promise<CatalogTitle | null> {
    const id = traktId(params);
    if (!id) return null;

    const show = await traktGet<TraktShowFull>(`/shows/${id}`, {
      params: { extended: "full,images,translations" },
      ttlSeconds: 86400,
    });
    if (!show) return null;

    const normalized = normalizeTitle(
      {
          ids: {
            traktId: show.ids.trakt,
            traktSlug: show.ids.slug,
            slug: show.ids.slug,
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
        numberOfEpisodes: show.aired_episodes ?? undefined,
        posterRemoteUrl: show.images?.poster?.[0] ?? undefined,
        backdropRemoteUrl: show.images?.fanart?.[0] ?? show.images?.thumb?.[0] ?? undefined,
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
            episodeCount: s.episode_count,
          },
          HIGH,
        ),
      );
  },

  // ── Episódios ──────────────────────────────────────────────────────────────

  async getEpisodes(params: GetEpisodesParams): Promise<CatalogEpisode[]> {
    const id = params.imdbId;
    if (!id) return [];

    // Trakt API: GET /shows/{id}/seasons/{n} returns episode array for that season.
    // (No "/episodes" suffix — that path doesn't exist; would return 405.)
    const episodes = await traktGet<TraktEpisodeFull[]>(
      `/shows/${id}/seasons/${params.season}`,
      {
        // extended=full: full data; images: episode stills; translations=pt: pt-BR inline
        params: { extended: "full,images,translations", translations: "pt" },
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
            episodeType: ep.episode_type ?? undefined,
            voteAverage: ep.rating ?? undefined,
            voteCount: ep.votes ?? undefined,
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
      params: { limit: params.limit ?? 20, extended: "full,images" },
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
              slug: entry.ids.slug,
              imdbId: entry.ids.imdb,
              tmdbId: entry.ids.tmdb,
            },
            mediaType: item.show ? "show" : "movie",
            title: entry.title,
            year: entry.year,
            overview: entry.overview ?? undefined,
            posterRemoteUrl: entry.images?.poster?.[0] ?? null,
            backdropRemoteUrl: entry.images?.fanart?.[0] ?? entry.images?.thumb?.[0] ?? null,
            genres: entry.genres,
            voteAverage: entry.rating,
            voteCount: entry.votes,
          },
          MED,
        );
      })
      .filter((r): r is CatalogSearchResult => r !== null);
  },

  async getPopular(params: PopularParams): Promise<CatalogSearchResult[]> {
    const endpoint = params.mediaType === "movie" ? "/movies/popular" : "/shows/popular";
    const results = await traktGet<Array<TraktShowFull | TraktMovieFull>>(endpoint, {
      params: { limit: params.limit ?? 20, extended: "full,images" },
      ttlSeconds: 3600,
    });
    if (!results) return [];

    return results.map((entry) =>
      normalizeSearchResult(
        {
          ids: {
            traktId: entry.ids.trakt,
            traktSlug: entry.ids.slug,
            slug: entry.ids.slug,
            imdbId: entry.ids.imdb,
            tmdbId: entry.ids.tmdb,
            tvdbId: (entry as TraktShowFull).ids?.tvdb,
          },
          mediaType: params.mediaType,
          title: entry.title,
          year: entry.year,
          releaseDate: params.mediaType === "movie" ? (entry as TraktMovieFull).released ?? undefined : undefined,
          firstAirDate: params.mediaType === "show" ? (entry as TraktShowFull).first_aired ?? undefined : undefined,
          overview: entry.overview ?? undefined,
          posterRemoteUrl: entry.images?.poster?.[0] ?? null,
          backdropRemoteUrl: entry.images?.fanart?.[0] ?? entry.images?.thumb?.[0] ?? null,
          genres: entry.genres,
          voteAverage: entry.rating,
          voteCount: entry.votes,
        },
        MED,
      )
    );
  },

  async getDiscover(params: DiscoverParams): Promise<CatalogSearchResult[]> {
    const popular = await this.getPopular({ mediaType: params.mediaType, limit: 50, page: params.page });
    return popular.filter((item) => item.genreIds?.includes(params.genreId) || item.genres?.some((genre) => normalizeGenreToId(genre) === params.genreId));
  },

  async getRelated(params: RelatedParams): Promise<CatalogSearchResult[]> {
    const id = params.imdbId ?? params.traktSlug ?? (params.traktId ? String(params.traktId) : null);
    if (!id) return [];

    const type = params.mediaType === "movie" ? "movies" : "shows";
    const results = await traktGet<Array<TraktShowFull | TraktMovieFull>>(`/${type}/${id}/related`, {
      params: { limit: 24, extended: "full,images,translations" },
      ttlSeconds: 86400,
    });
    if (!results) return [];

    return results.map((entry) => {
      const localizedTitle = ptBrTranslationTitle(entry);
      return normalizeSearchResult(
        {
          ids: {
            traktId: entry.ids.trakt,
            traktSlug: entry.ids.slug,
            slug: entry.ids.slug,
            imdbId: entry.ids.imdb,
            tmdbId: entry.ids.tmdb,
          },
          mediaType: params.mediaType,
          title: localizedTitle ?? entry.title,
          originalTitle: localizedTitle ? entry.title : undefined,
          year: entry.year,
          posterRemoteUrl: entry.images?.poster?.[0] ?? null,
          backdropRemoteUrl: entry.images?.fanart?.[0] ?? entry.images?.thumb?.[0] ?? null,
        },
        MED,
      );
    });
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

  async getPeople(params: PeopleParams): Promise<CatalogPeople | null> {
    const id = params.imdbId ?? params.traktSlug ?? (params.traktId ? String(params.traktId) : null);
    if (!id) return null;
    const type = params.mediaType === "movie" ? "movies" : "shows";

    const data = await traktGet<TraktPeople>(`/${type}/${id}/people`, {
      params: { extended: "full" },
      ttlSeconds: 86400 * 7,
    });
    if (!data) return null;

    const cast = (data.cast ?? []).slice(0, 20).map((entry) => ({
      ids: { traktId: entry.person.ids.trakt, imdbId: entry.person.ids.imdb, tmdbId: entry.person.ids.tmdb },
      name: entry.person.name,
      character: entry.characters?.[0] ?? entry.character ?? undefined,
      profileRemoteUrl: entry.person.images?.headshot?.[0] ?? undefined,
    }));

    const crew: CatalogPeople["crew"] = [];
    const crewDepts = data.crew ?? {};
    for (const [dept, entries] of Object.entries(crewDepts)) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries.slice(0, 5)) {
        crew.push({
          ids: { traktId: entry.person.ids.trakt, imdbId: entry.person.ids.imdb, tmdbId: entry.person.ids.tmdb },
          name: entry.person.name,
          job: entry.jobs?.[0] ?? entry.job ?? dept,
          department: dept,
          profileRemoteUrl: entry.person.images?.headshot?.[0] ?? undefined,
        });
      }
    }

    return { cast, crew, source: MED };
  },

  async getVideos(params: VideoParams): Promise<CatalogVideo[]> {
    const id = params.imdbId;
    if (!id) return [];
    const type = params.mediaType === "movie" ? "movies" : "shows";

    const data = await traktGet<TraktVideoItem[]>(`/${type}/${id}/videos`, {
      ttlSeconds: 86400 * 3,
    });
    if (!data || !Array.isArray(data)) return [];

    return data.slice(0, 5).map((video, index) => ({
      id: index + 1,
      title: video.name,
      url: video.site === "YouTube" ? `https://www.youtube.com/watch?v=${video.key}` : video.key,
      type: video.type.toLowerCase(),
      thumbnailUrl: video.thumbnail ?? (video.site === "YouTube" ? `https://img.youtube.com/vi/${video.key}/hqdefault.jpg` : null),
      source: MED,
    }));
  },

  async getCalendar(_params: CalendarParams): Promise<CatalogCalendarItem[]> {
    return [];
  },
};

// ── Trakt show enrichment helpers (exported for use in title page) ─────────────

export type TraktShowEnrichment = {
  studios?: Array<{ name: string; country?: string }>;
  certifications?: Record<string, string>;
  network?: { name: string; slug: string; country?: string } | null;
  nextEpisode?: {
    season: number;
    number: number;
    title?: string | null;
    firstAired?: string | null;
    episodeType?: string | null;
  } | null;
  lastEpisode?: {
    season: number;
    number: number;
    title?: string | null;
    firstAired?: string | null;
    episodeType?: string | null;
  } | null;
};

export async function getTraktShowEnrichment(imdbId: string): Promise<TraktShowEnrichment> {
  const [studiosRaw, nextRaw, lastRaw, summaryRaw] = await Promise.all([
    traktGet<TraktStudio[]>(`/shows/${imdbId}/studios`, { ttlSeconds: 86400 * 7 }).catch(() => null),
    traktGet<TraktEpisodeSummary>(`/shows/${imdbId}/next_episode`, { params: { extended: "full" }, ttlSeconds: 3600 }).catch(() => null),
    traktGet<TraktEpisodeSummary>(`/shows/${imdbId}/last_episode`, { params: { extended: "full" }, ttlSeconds: 86400 }).catch(() => null),
    traktGet<TraktShowFull>(`/shows/${imdbId}`, { params: { extended: "full" }, ttlSeconds: 86400 }).catch(() => null),
  ]);

  const networkName = summaryRaw?.network ?? null;
  const networkCountry = summaryRaw?.country ?? undefined;

  return {
    studios: Array.isArray(studiosRaw)
      ? studiosRaw.map((s) => ({ name: s.name, country: s.country }))
      : undefined,
    certifications: summaryRaw?.certification ? { us: summaryRaw.certification } : undefined,
    network: networkName
      ? { name: networkName, slug: normalizeNetworkSlug(networkName), country: networkCountry }
      : null,
    nextEpisode: nextRaw
      ? { season: nextRaw.season, number: nextRaw.number, title: nextRaw.title, firstAired: nextRaw.first_aired, episodeType: nextRaw.episode_type }
      : null,
    lastEpisode: lastRaw
      ? { season: lastRaw.season, number: lastRaw.number, title: lastRaw.title, firstAired: lastRaw.first_aired, episodeType: lastRaw.episode_type }
      : null,
  };
}

/** Busca e cacheia a lista canônica de redes da API Trakt. TTL de 30 dias. */
export async function getTraktNetworks(): Promise<TraktNetwork[]> {
  const raw = await traktGet<TraktNetwork[]>(`/networks`, { ttlSeconds: 86400 * 30 }).catch(() => null);
  return Array.isArray(raw) ? raw : [];
}

export async function getTraktMovieEnrichment(imdbId: string): Promise<{
  studios?: Array<{ name: string; country?: string }>;
  certifications?: Record<string, string>;
}> {
  const [studiosRaw, summaryRaw] = await Promise.all([
    traktGet<TraktStudio[]>(`/movies/${imdbId}/studios`, { ttlSeconds: 86400 * 7 }).catch(() => null),
    traktGet<TraktMovieFull>(`/movies/${imdbId}`, { params: { extended: "full" }, ttlSeconds: 86400 }).catch(() => null),
  ]);

  return {
    studios: Array.isArray(studiosRaw)
      ? studiosRaw.map((s) => ({ name: s.name, country: s.country }))
      : undefined,
    certifications: summaryRaw?.certification ? { us: summaryRaw.certification } : undefined,
  };
}
