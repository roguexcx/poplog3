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

import { tvdbGet, tvdbGetWithLinks } from "@/server/api-clients/tvdb/client";
import type {
  TvdbSeriesExtended,
  TvdbSeries,
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
import { normalizePeople } from "../normalizers/normalize-person";

// ─── Season type fallback chain ───────────────────────────────────────────────

/**
 * Season types tried in priority order when fetching episodes.
 * "default" maps to the series' configured default ordering (usually "official").
 * If default returns nothing, we fall back through the chain until we find episodes.
 */
const SEASON_TYPE_FALLBACKS = [
  "default",
  "official",
  "regional",
  "dvd",
  "absolute",
  "alternate",
] as const;

type TvdbSeasonTypeName = (typeof SEASON_TYPE_FALLBACKS)[number];

// ─── Diagnostic type ──────────────────────────────────────────────────────────

export type TvdbEpisodeFetchDiag = {
  seriesId: number;
  seasonType: TvdbSeasonTypeName;
  seasonNumber: number | undefined;
  pagesConsulted: number;
  totalEpisodesReturned: number;
  fallbackApplied: boolean;
  fallbackReason?: string;
  nonfatalErrors: string[];
  translationWarning?: string;
};

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

function bestTvdbEpisodeArtwork(ep: TvdbEpisode): {
  url?: string;
  width?: number;
  height?: number;
  language?: string;
  kind?: string;
} {
  const artwork = [...(ep.artwork ?? []), ...(ep.artworks ?? [])]
    .filter((item) => item.image || item.thumbnail)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  return {
    url: ep.image ?? ep.thumbnail ?? artwork?.image ?? artwork?.thumbnail ?? undefined,
    width: artwork?.width,
    height: artwork?.height,
    language: artwork?.language ?? undefined,
    kind: artwork ? `tvdb-artwork-${artwork.type}` : "episode-image",
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

// ─── Remote ID lookup ─────────────────────────────────────────────────────────

/**
 * Resolves a TVDB series ID given an external remote ID (IMDb, Trakt, etc.).
 * Uses /search/remoteid/{id} which maps external identifiers to TVDB entries.
 *
 * Returns null when TVDB is inactive, the ID cannot be found, or an error occurs.
 * Result is cached for 7 days since TVDB IDs rarely change.
 */
export async function findTvdbSeriesByRemoteId(remoteId: string): Promise<number | null> {
  // TVDB v4 /search/remoteid returns an array where each element wraps the result
  // under a type-specific key. Observed formats (may vary by API version):
  //   Current : [{ series: { id: 253463, name: "...", ... } }]
  //   Legacy  : [{ type: "series", tvdb_id: "253463", objectID: "..." }]
  type RawItem = Record<string, unknown>;

  const data = await tvdbGet<RawItem[]>(
    `/search/remoteid/${encodeURIComponent(remoteId)}`,
    { ttlSeconds: 7 * 86400 },
  );
  if (!Array.isArray(data) || data.length === 0) return null;

  for (const item of data) {
    if (!item || typeof item !== "object") continue;

    // Current format: item has a 'series' property with the nested series object
    if (item.series && typeof item.series === "object") {
      const s = item.series as Record<string, unknown>;
      if (typeof s.id === "number" && s.id > 0) return s.id;
      const n = Number(s.id);
      if (Number.isFinite(n) && n > 0) return n;
    }

    // Legacy format: item has tvdb_id / objectID at the top level
    if (item.type === "series" || item.type === "show") {
      const raw = item.tvdb_id ?? item.objectID;
      const n = Number(raw);
      if (Number.isFinite(n) && n > 0) return n;
    }
  }

  return null;
}

// ─── Core episode fetcher ─────────────────────────────────────────────────────

/**
 * Fetches and normalizes episodes from TheTVDB v4.
 *
 * Correctness guarantees:
 *   - Uses the structural endpoint WITHOUT language suffix for episode data:
 *       GET /series/{id}/episodes/{seasonType}?page={p}&season={n}
 *   - Paginates automatically until links.next is null (never truncates at page 0).
 *   - Tries season types in fallback order: default → official → regional → dvd → absolute → alternate.
 *   - Enriches with pt-BR translations in a separate pass (non-destructive):
 *       GET /series/{id}/episodes/{seasonType}/por?page={p}
 *   - Never discards an episode because translation is missing.
 *   - Returns diagnostic metadata alongside episodes for logging and debugging.
 *
 * This is the authoritative TVDB episode fetcher used throughout the engine.
 */
export async function fetchTvdbSeriesEpisodes(
  seriesId: number,
  options: {
    seasonNumber?: number;
    preferredSeasonType?: TvdbSeasonTypeName;
    maxPages?: number;
  } = {},
): Promise<{ episodes: CatalogEpisode[]; diag: TvdbEpisodeFetchDiag }> {
  const { seasonNumber, preferredSeasonType, maxPages = 20 } = options;
  const nonfatalErrors: string[] = [];
  let translationWarning: string | undefined;

  // Build ordered list of season types to try
  const typesToTry: TvdbSeasonTypeName[] = preferredSeasonType
    ? [preferredSeasonType, ...SEASON_TYPE_FALLBACKS.filter((t) => t !== preferredSeasonType)]
    : [...SEASON_TYPE_FALLBACKS];

  let structuralEpisodes: TvdbEpisode[] = [];
  let usedSeasonType: TvdbSeasonTypeName = typesToTry[0];
  let pagesConsulted = 0;
  let fallbackApplied = false;
  let fallbackReason: string | undefined;

  // ── Phase 1: structural fetch — no language suffix ─────────────────────────
  for (const seasonType of typesToTry) {
    const baseParams: Record<string, string | number | boolean> = {};
    if (seasonNumber !== undefined) baseParams.season = seasonNumber;

    const collected: TvdbEpisode[] = [];
    let page = 0;
    let hasMore = true;

    while (hasMore && page < maxPages) {
      const { data, links } = await tvdbGetWithLinks<{
        series?: TvdbSeries;
        episodes?: TvdbEpisode[];
      }>(`/series/${seriesId}/episodes/${seasonType}`, {
        params: { ...baseParams, page },
        ttlSeconds: 86400,
      }).catch((err: Error) => {
        nonfatalErrors.push(`${seasonType} p${page}: ${err.message}`);
        return { data: null, links: null };
      });

      pagesConsulted++;
      const pageEps = data?.episodes ?? [];
      collected.push(...pageEps);

      // Stop if no episodes on this page (safety) or no next page
      if (pageEps.length === 0 || !links?.next) {
        hasMore = false;
      }
      page++;
    }

    if (collected.length > 0) {
      structuralEpisodes = collected;
      usedSeasonType = seasonType;

      if (seasonType !== typesToTry[0]) {
        fallbackApplied = true;
        fallbackReason = `${typesToTry[0]} vazio; usando ${seasonType}`;
        console.warn(`[tvdb-adapter] fetchTvdbSeriesEpisodes fallback: ${fallbackReason}`, {
          seriesId,
          seasonNumber,
        });
      }
      break;
    }

    nonfatalErrors.push(`seasonType=${seasonType}: 0 episódios`);
  }

  if (structuralEpisodes.length === 0) {
    const diag: TvdbEpisodeFetchDiag = {
      seriesId,
      seasonType: usedSeasonType,
      seasonNumber,
      pagesConsulted,
      totalEpisodesReturned: 0,
      fallbackApplied: false,
      fallbackReason: "todas as ordens retornaram vazio",
      nonfatalErrors,
    };
    console.warn("[tvdb-adapter] fetchTvdbSeriesEpisodes: nenhum episódio obtido", diag);
    return { episodes: [], diag };
  }

  // ── Phase 2: translation enrichment — pt-BR, non-destructive ─────────────
  // Uses the lang endpoint which returns translated names/overviews.
  // We do NOT pass ?season= here because the lang endpoint may not support it.
  const ptMap = new Map<number, { name?: string | null; overview?: string | null }>();

  try {
    let ptPage = 0;
    let ptHasMore = true;

    while (ptHasMore && ptPage < maxPages) {
      const { data: ptData, links: ptLinks } = await tvdbGetWithLinks<{
        series?: TvdbSeries;
        episodes?: TvdbEpisode[];
      }>(`/series/${seriesId}/episodes/${usedSeasonType}/por`, {
        params: { page: ptPage },
        ttlSeconds: 86400,
      }).catch(() => ({ data: null, links: null }));

      const ptEps = ptData?.episodes ?? [];

      // Stop immediately if the translation endpoint returns nothing on page 0
      if (ptEps.length === 0 && ptPage === 0) break;

      for (const ep of ptEps) {
        if (ep.id && (ep.name || ep.overview)) {
          ptMap.set(ep.id, { name: ep.name, overview: ep.overview });
        }
      }

      ptHasMore = Boolean(ptLinks?.next) && ptEps.length > 0;
      ptPage++;
    }

    if (ptMap.size === 0) {
      translationWarning = `pt-BR vazio para seasonType=${usedSeasonType}`;
      console.warn(`[tvdb-adapter] ${translationWarning}`, { seriesId });
    } else {
      console.log("[tvdb-adapter] pt-BR translations carregadas", {
        seriesId,
        seasonType: usedSeasonType,
        count: ptMap.size,
      });
    }
  } catch (ptErr) {
    translationWarning = `pt-BR erro: ${ptErr instanceof Error ? ptErr.message : String(ptErr)}`;
    console.warn(`[tvdb-adapter] ${translationWarning}`, { seriesId });
  }

  // ── Phase 2.5: individual episode image enrichment when structural data lacks stills ──
  const episodesNeedingImages = structuralEpisodes.filter((ep) => {
    const image = bestTvdbEpisodeArtwork(ep);
    return ep.id && !image.url;
  });

  if (episodesNeedingImages.length > 0) {
    await Promise.all(
      episodesNeedingImages.map(async (ep) => {
        const detailed = await tvdbGet<TvdbEpisode>(`/episodes/${ep.id}`, {
          ttlSeconds: 86400,
        }).catch(() => null);
        if (!detailed) return;
        Object.assign(ep, {
          image: ep.image ?? detailed.image,
          thumbnail: ep.thumbnail ?? detailed.thumbnail,
          artwork: ep.artwork ?? detailed.artwork,
          artworks: ep.artworks ?? detailed.artworks,
        });
      }),
    );
  }

  // ── Phase 3: normalize ────────────────────────────────────────────────────
  const src: SourceMeta = {
    primary: "tvdb",
    confidence: "high",
    usedFallback: fallbackApplied,
    fetchedAt: new Date().toISOString(),
  };

  const episodes = structuralEpisodes
    .filter((ep) => (ep.number ?? 0) > 0)
    .map((ep) => {
      const pt = ptMap.get(ep.id);
      const artwork = bestTvdbEpisodeArtwork(ep);
      return normalizeEpisode(
        {
          ids: tvdbEpisodeIds(ep),
          season: ep.seasonNumber ?? seasonNumber ?? 0,
          number: ep.number ?? 0,
          absoluteNumber: ep.absoluteNumber ?? ep.airedOrder ?? undefined,
          // Use pt-BR translation when available; never discard for lack of translation
          title: (pt?.name ?? ep.name) ?? undefined,
          originalTitle: ep.name ?? undefined,
          overview: (pt?.overview ?? ep.overview) ?? undefined,
          originalOverview: ep.overview ?? undefined,
          titleLanguage: pt?.name ? "por-BR" : "eng",
          overviewLanguage: pt?.overview ? "por-BR" : "eng",
          textLanguage: pt ? "por-BR" : "eng",
          firstAired: ep.aired ?? undefined,
          runtime: ep.runtime ?? undefined,
          stillRemoteUrl: artwork.url,
          stillSource: "tvdb",
          stillWidth: artwork.width,
          stillHeight: artwork.height,
          stillLanguage: artwork.language,
          imageCandidates: artwork.url
            ? [{
                source: "tvdb",
                url: artwork.url,
                width: artwork.width,
                height: artwork.height,
                language: artwork.language,
                kind: artwork.kind,
                confidence: "high",
              }]
            : [],
        },
        src,
      );
    });

  const diag: TvdbEpisodeFetchDiag = {
    seriesId,
    seasonType: usedSeasonType,
    seasonNumber,
    pagesConsulted,
    totalEpisodesReturned: episodes.length,
    fallbackApplied,
    fallbackReason,
    nonfatalErrors,
    translationWarning,
  };

  console.log("[tvdb-adapter] fetchTvdbSeriesEpisodes completo", {
    seriesId,
    seasonNumber: seasonNumber ?? "all",
    seasonType: usedSeasonType,
    pages: pagesConsulted,
    episodesRaw: structuralEpisodes.length,
    episodesNormalized: episodes.length,
    ptTranslations: ptMap.size,
    fallback: fallbackApplied ? fallbackReason : false,
  });

  return { episodes, diag };
}

// ─── Adapter ──────────────────────────────────────────────────────────────────

export const tvdbAdapter: CatalogAdapter = {
  // ── Busca — TVDB como complemento; suporta remote ID search ─────────────────

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

    const query = params.query.trim();

    // Primary: text search
    const data = await tvdbGet<TvdbSearchResult[]>("/search", {
      params: {
        query,
        type:
          params.mediaType === "movie"
            ? "movie"
            : params.mediaType === "show"
              ? "series"
              : "series,movie",
        limit: 10,
      },
      ttlSeconds: 3600,
    });

    const results: TvdbSearchResult[] = data ?? [];

    // Secondary: if no text results and query looks like an external ID, try remote ID endpoint
    if (results.length === 0 && /^(tt\d+|tvdb:\d+|\d{5,})/i.test(query)) {
      const byRemote = await tvdbGet<TvdbSearchResult[]>(
        `/search/remoteid/${encodeURIComponent(query)}`,
        { ttlSeconds: 86400 },
      );
      if (byRemote?.length) results.push(...byRemote);
    }

    return results
      .filter((item) => {
        if (!params.mediaType) return true;
        const t = item.type?.toLowerCase();
        if (params.mediaType === "movie") return t === "movie";
        return t === "series" || t === "show";
      })
      .map((item) => {
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
    if (!tvdbId) return null;

    const data = await tvdbGet<TvdbSeriesExtended>(`/series/${tvdbId}/extended`, {
      params: { meta: "translations", short: "false" },
      ttlSeconds: 86400,
    });
    if (!data) return null;

    const ids = tvdbSeriesIds(data);
    const normalized = normalizeTitle(
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
        productionCompanies: data.companies?.map((c) => ({ name: c.name })) ?? undefined,
      },
      HIGH,
    );

    const logo = data.artworks
      ?.filter((a) => a.type === 22)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0]?.image;
    const trailerUrl = data.trailers?.[0]?.url ?? null;
    const primaryNetwork = data.networks?.[0]?.name ?? null;

    return {
      ...normalized,
      trailerUrl: trailerUrl ?? null,
      logoUrl: logo ?? null,
      network: primaryNetwork,
      networks: data.networks?.map((n) => n.name) ?? [],
    };
  },

  // ── Temporadas ─────────────────────────────────────────────────────────────

  async getSeasons(params: GetSeasonsParams): Promise<CatalogSeason[]> {
    const tvdbId = params.tvdbId;
    if (!tvdbId) return [];

    const data = await tvdbGet<TvdbSeriesExtended>(`/series/${tvdbId}/extended`, {
      params: { meta: "translations" },
      ttlSeconds: 86400,
    });
    if (!data?.seasons) return [];

    // Accept "official" (standard aired order) and "default" (series-level alias).
    // Older TVDB responses may omit the type field — include those too.
    let filtered = data.seasons.filter(
      (s: TvdbSeason) =>
        s.number > 0 &&
        (!s.type || s.type.type === "official" || s.type.type === "default"),
    );

    // If nothing passed the filter (unusual ordering), fall back to all numbered seasons
    if (filtered.length === 0) {
      filtered = data.seasons.filter((s) => s.number > 0);
    }

    // Deduplicate by number (keep first — TVDB may list a season across multiple orderings)
    const seen = new Set<number>();
    const unique = filtered.filter((s) => {
      if (seen.has(s.number)) return false;
      seen.add(s.number);
      return true;
    });

    return unique.map((s: TvdbSeason) =>
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

  // ── Episódios — delegates to fetchTvdbSeriesEpisodes ──────────────────────

  async getEpisodes(params: GetEpisodesParams): Promise<CatalogEpisode[]> {
    const tvdbId = params.tvdbId;
    if (!tvdbId) return [];

    const { episodes, diag } = await fetchTvdbSeriesEpisodes(tvdbId, {
      seasonNumber: params.season,
    });

    if (diag.nonfatalErrors.length > 0) {
      console.warn("[tvdb-adapter] getEpisodes erros não-fatais", {
        tvdbId,
        season: params.season,
        errors: diag.nonfatalErrors,
      });
    }

    // Filter strictly to the requested season; TVDB may return adjacent seasons
    // on the last page of a paginated response when season filter is applied.
    return episodes.filter((ep) => ep.season === params.season);
  },

  // ── Trending / Popular — TVDB não tem endpoints próprios, cede ao Trakt ────

  async getTrending(_params: TrendingParams): Promise<CatalogSearchResult[]> {
    return [];
  },

  async getPopular(_params: PopularParams): Promise<CatalogSearchResult[]> {
    return [];
  },

  async getDiscover(_params: DiscoverParams): Promise<CatalogSearchResult[]> {
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
    return [];
  },
};
