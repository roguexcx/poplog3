/**
 * TheTVDB Adapter — implementa CatalogAdapter usando a API TheTVDB v4.
 *
 * Domínio preferencial:
 *   - Séries, temporadas, episódios, status, datas futuras
 *   - Ordens alternativas (aired, DVD, absolute, streaming/Netflix-like)
 *   - nextAired, lastAired, status de produção
 *   - Imagens de séries (fanart, poster, banner)
 *
 * Não compete com Trakt em: busca geral, trending, popular, ratings sociais.
 * Entra como fonte especializada quando a área for TV.
 */

import { tvdbGet } from "@/server/api-clients/tvdb/client";
import type {
  TvdbSeriesExtended,
  TvdbSeasonExtended,
  TvdbEpisode,
  TvdbCharacter,
  TvdbSeason,
} from "@/server/api-clients/tvdb/types";

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
import type { SourceMeta } from "../types/source.types";

import { normalizeTitle } from "../normalizers/normalize-title";
import { normalizeSearchResult } from "../normalizers/normalize-search";
import { normalizeSeason } from "../normalizers/normalize-season";
import { normalizeEpisode } from "../normalizers/normalize-episode";
import { normalizePeople } from "../normalizers/normalize-person";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HIGH: SourceMeta = { primary: "tvdb", confidence: "high", usedFallback: false };
const MED: SourceMeta = { primary: "tvdb", confidence: "medium", usedFallback: false };

function tvdbSeriesIds(series: TvdbSeriesExtended): CatalogIds {
  const imdb = series.remoteIds?.find((r) => r.sourceName === "IMDB")?.id;
  return {
    tvdbId: series.id,
    imdbId: imdb,
  };
}

function tvdbEpisodeIds(ep: TvdbEpisode): CatalogIds {
  const imdb = ep.remoteIds?.find((r) => r.sourceName === "IMDB")?.id;
  return {
    tvdbId: ep.id,
    imdbId: imdb,
  };
}

function selectBestPoster(artworks?: TvdbSeriesExtended["artworks"]): string | undefined {
  if (!artworks?.length) return undefined;
  // type 2 = poster
  const posters = artworks.filter((a) => a.type === 2).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return posters[0]?.image ?? undefined;
}

function selectBestBackdrop(artworks?: TvdbSeriesExtended["artworks"]): string | undefined {
  if (!artworks?.length) return undefined;
  // type 3 = background/fanart
  const bgs = artworks.filter((a) => a.type === 3).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return bgs[0]?.image ?? undefined;
}

function mapTvdbStatus(status?: TvdbSeriesExtended["status"]): string | undefined {
  if (!status?.name) return undefined;
  const map: Record<string, string> = {
    Continuing: "returning series",
    Ended: "ended",
    Upcoming: "in_production",
    "Pilot Ordered": "pilot",
  };
  return map[status.name] ?? status.name.toLowerCase();
}

function resolveShowId(params: GetTitleParams | GetSeasonsParams | GetEpisodesParams): string | null {
  if ("tvdbId" in params && params.tvdbId) return String(params.tvdbId);
  if ("imdbId" in params && params.imdbId) return `remoteId:${params.imdbId}`;
  return null;
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const tvdbAdapter: CatalogAdapter = {
  // ── Busca — TVDB tem busca limitada, usar como complemento ──────────────────

  async searchTitles(params: SearchParams): Promise<CatalogSearchResult[]> {
    type TvdbSearchResult = {
      objectID?: string;
      tvdb_id?: string;
      type?: string;
      name?: string;
      translations?: Record<string, string>;
      overview?: string;
      overviews?: Record<string, string>;
      image_url?: string;
      year?: string;
      remote_ids?: Array<{ id: string; sourceName: string }>;
    };

    const data = await tvdbGet<TvdbSearchResult[]>("/search", {
      params: {
        query: params.query,
        type: params.mediaType === "movie" ? "movie" : params.mediaType === "show" ? "series" : "series,movie",
        limit: 20,
      },
      ttlSeconds: 3600,
    });
    if (!data) return [];

    return data.map((item) => {
      const imdb = item.remote_ids?.find((r) => r.sourceName === "IMDB")?.id;
      return normalizeSearchResult(
        {
          ids: {
            tvdbId: item.tvdb_id ? Number(item.tvdb_id) : undefined,
            imdbId: imdb,
          },
          mediaType: item.type === "movie" ? "movie" : "show",
          title: item.translations?.eng ?? item.name ?? "",
          year: item.year ? Number(item.year) : undefined,
          overview: item.overviews?.eng ?? item.overview,
          posterRemoteUrl: item.image_url,
        },
        MED,
      );
    });
  },

  // ── Filme — TVDB tem suporte limitado a filmes ─────────────────────────────

  async getMovie(_params: GetTitleParams): Promise<CatalogTitle | null> {
    // TVDB não é fonte preferencial para filmes — retorna null para ceder ao Trakt
    return null;
  },

  // ── Série ──────────────────────────────────────────────────────────────────

  async getShow(params: GetTitleParams): Promise<CatalogTitle | null> {
    const tvdbId = params.tvdbId;
    if (!tvdbId) return null; // Sem tvdbId não conseguimos consultar diretamente

    const data = await tvdbGet<TvdbSeriesExtended>(`/series/${tvdbId}/extended`, {
      params: { meta: "translations", short: "false" },
      ttlSeconds: 86400,
    });
    if (!data) return null;

    const ids = tvdbSeriesIds(data);
    return normalizeTitle(
      {
        ids,
        mediaType: "show",
        title: data.name,
        year: data.year ? Number(data.year) : undefined,
        overview: data.overview ?? undefined,
        runtime: data.averageRuntime ?? data.runtime ?? undefined,
        status: mapTvdbStatus(data.status),
        genres: data.genres?.map((g) => g.name) ?? undefined,
        country: data.originalCountry ?? undefined,
        language: data.originalLanguage ?? undefined,
        posterRemoteUrl: selectBestPoster(data.artworks) ?? data.image ?? undefined,
        backdropRemoteUrl: selectBestBackdrop(data.artworks),
      },
      HIGH,
    );
  },

  // ── Temporadas ─────────────────────────────────────────────────────────────

  async getSeasons(params: GetSeasonsParams): Promise<CatalogSeason[]> {
    const tvdbId = params.tvdbId;
    if (!tvdbId) return [];

    // Busca série com temporadas incluídas
    const data = await tvdbGet<TvdbSeriesExtended>(`/series/${tvdbId}/extended`, {
      params: { meta: "translations" },
      ttlSeconds: 86400,
    });
    if (!data?.seasons) return [];

    // Retorna apenas a ordem oficial (aired order = type "official")
    // Filtra season 0 (especiais) por padrão
    const officialSeasons = data.seasons.filter(
      (s: TvdbSeason) => s.number > 0 && (!s.type || s.type.type === "official"),
    );

    return officialSeasons.map((s: TvdbSeason) =>
      normalizeSeason(
        {
          ids: { tvdbId: s.id },
          number: s.number,
          title: s.name ?? undefined,
          posterRemoteUrl: s.image ?? undefined,
        },
        HIGH,
      ),
    );
  },

  // ── Episódios ──────────────────────────────────────────────────────────────

  async getEpisodes(params: GetEpisodesParams): Promise<CatalogEpisode[]> {
    const tvdbId = params.tvdbId;
    if (!tvdbId) return [];

    type EpisodesPage = { series?: TvdbSeriesExtended; episodes?: TvdbEpisode[] };

    const data = await tvdbGet<EpisodesPage>(
      `/series/${tvdbId}/episodes/official`,
      {
        params: { season: params.season, page: 0 },
        ttlSeconds: 86400,
      },
    );
    if (!data?.episodes) return [];

    return data.episodes.map((ep) =>
      normalizeEpisode(
        {
          ids: tvdbEpisodeIds(ep),
          season: ep.seasonNumber ?? params.season,
          number: ep.number ?? 0,
          title: ep.name ?? undefined,
          overview: ep.overview ?? undefined,
          firstAired: ep.aired ?? undefined,
          runtime: ep.runtime ?? undefined,
        },
        HIGH,
      ),
    );
  },

  // ── Trending / Popular — TVDB não tem endpoints próprios, cede ao Trakt ────

  async getTrending(_params: TrendingParams): Promise<CatalogSearchResult[]> {
    return [];
  },

  async getPopular(_params: PopularParams): Promise<CatalogSearchResult[]> {
    return [];
  },

  async getRelated(_params: RelatedParams): Promise<CatalogSearchResult[]> {
    return [];
  },

  async getRatings(_params: RatingParams): Promise<CatalogRatings | null> {
    return null;
  },

  async getComments(_params: CommentParams): Promise<CatalogComment[]> {
    return [];
  },

  // ── Pessoas ────────────────────────────────────────────────────────────────

  async getPeople(params: PeopleParams): Promise<CatalogPeople | null> {
    const tvdbId = params.tvdbId;
    if (!tvdbId) return null;

    const data = await tvdbGet<TvdbSeriesExtended>(`/series/${tvdbId}/extended`, {
      params: { meta: "translations" },
      ttlSeconds: 2592000,
    });
    if (!data?.characters) return null;

    const cast = data.characters
      .filter((c: TvdbCharacter) => c.type === 1 && c.peopleId) // type 1 = actor
      .sort((a: TvdbCharacter, b: TvdbCharacter) => (a.sort ?? 99) - (b.sort ?? 99))
      .map((c: TvdbCharacter) => ({
        ids: { tvdbId: c.peopleId },
        name: c.peopleName ?? "",
        character: c.name ?? undefined,
        profileRemoteUrl: c.personImgURL ?? c.image ?? undefined,
      }));

    return normalizePeople(cast, [], MED);
  },

  // ── Vídeos ─────────────────────────────────────────────────────────────────

  async getVideos(params: VideoParams): Promise<CatalogVideo[]> {
    const tvdbId = params.tvdbId;
    if (!tvdbId) return [];

    const data = await tvdbGet<TvdbSeriesExtended>(`/series/${tvdbId}/extended`, {
      ttlSeconds: 21600,
    });
    if (!data?.trailers) return [];

    return data.trailers.map((t) => ({
      id: t.id,
      title: t.name ?? "Trailer",
      url: t.url,
      type: "trailer",
      source: MED,
    }));
  },

  // ── Calendário — TheTVDB tem dados de nextAired, mas sem endpoint dedicado ─

  async getCalendar(_params: CalendarParams): Promise<CatalogCalendarItem[]> {
    // Implementar futuramente usando updates incrementais do TVDB
    return [];
  },
};
