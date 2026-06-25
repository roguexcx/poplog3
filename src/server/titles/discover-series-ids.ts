/**
 * Descoberta de IDs externos para séries de TV.
 *
 * Usado quando `titleExternalId` não tem `imdbId` para uma série,
 * o que impede Trakt e Balloonerismm de funcionarem com identidade canônica.
 *
 * Estratégias em ordem de preferência:
 *   1. Trakt /search/tmdb/{id}?type=show  — cross-reference por TMDB ID (mais preciso)
 *   2. Trakt /search/show?query={title}    — busca por nome+ano (fallback)
 *
 * Resultado é cacheado por 30 dias via Next.js fetch TTL.
 */

import { traktGet, isTraktActive } from "@/server/api-clients/trakt/client";
import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";

export type DiscoveredSeriesIds = {
  imdbId?: string;
  tvdbId?: number;
  traktId?: number;
  traktSlug?: string;
  tmdbId?: number;
};

// ─── Trakt internal types ─────────────────────────────────────────────────────

type TraktSearchByIdResult = {
  type?: string;
  show?: {
    title?: string;
    year?: number;
    ids: {
      trakt?: number;
      slug?: string;
      tvdb?: number;
      imdb?: string;
      tmdb?: number;
    };
  };
};

// ─── Strategy 1: Trakt cross-reference by TMDB ID ────────────────────────────

/**
 * Uses Trakt's cross-reference search (`GET /search/tmdb/{id}?type=show`) to
 * get the full ID bundle for a TV series given only its TMDB ID.
 *
 * This is the primary bridge between TMDB IDs (our DB) and IMDb/TVDB IDs
 * (needed by Trakt episodes and Balloonerismm fallback).
 */
export async function discoverTvSeriesIdsByTmdbId(
  tmdbId: number,
): Promise<DiscoveredSeriesIds | null> {
  if (tmdbId <= 0) return null;

  // Strategy 1: Trakt /search/tmdb
  if (isTraktActive()) {
    try {
      const results = await traktGet<TraktSearchByIdResult[]>(`/search/tmdb/${tmdbId}`, {
        params: { type: "show" },
        ttlSeconds: 30 * 86400, // 30 days — IDs rarely change
      });

      const show = results?.find((r) => r.type === "show" || r.show)?.show;
      if (show?.ids?.imdb || show?.ids?.tvdb) {
        console.log("[discover-series-ids] IDs descobertos via Trakt /search/tmdb", {
          tmdbId,
          imdbId: show.ids.imdb,
          tvdbId: show.ids.tvdb,
        });
        return {
          imdbId: show.ids.imdb,
          tvdbId: show.ids.tvdb,
          traktId: show.ids.trakt,
          traktSlug: show.ids.slug,
          tmdbId: show.ids.tmdb,
        };
      }
    } catch (err) {
      console.warn("[discover-series-ids] Trakt /search/tmdb falhou", {
        tmdbId,
        error: (err as Error)?.message,
      });
    }
  }

  // Trakt not active or returned nothing — can't resolve by TMDB ID alone without it
  return null;
}

// ─── Strategy 2: discovery by title+year ─────────────────────────────────────

/**
 * Discovers the ID bundle for a TV series by title + year.
 * Used as a last resort when `tmdbId` is unavailable or the TMDB lookup failed.
 *
 * Tries Trakt text search as the only remote fallback.
 */
export async function discoverTvSeriesIdsByTitle(
  title: string,
  year?: number | null,
): Promise<DiscoveredSeriesIds | null> {
  const normalizedTitle = normalizeSearchTerm(title);
  if (!normalizedTitle) return null;

  // Strategy 2: Trakt text search
  if (isTraktActive()) {
    try {
      const results = await traktGet<TraktSearchByIdResult[]>(`/search/show`, {
        params: { query: title, limit: 5 },
        ttlSeconds: 86400,
      });

      const match = results?.find((r) => {
        const s = r.show;
        if (!s) return false;
        const titleOk = normalizeSearchTerm(s.title ?? "") === normalizedTitle;
        const yearOk = !year || !s.year || Math.abs(s.year - year) <= 1;
        return titleOk && yearOk;
      });

      if (match?.show?.ids?.imdb || match?.show?.ids?.tvdb) {
        const ids = match.show!.ids;
        console.log("[discover-series-ids] IDs descobertos via Trakt search/show", {
          title,
          year,
          imdbId: ids.imdb,
          tvdbId: ids.tvdb,
        });
        return {
          imdbId: ids.imdb,
          tvdbId: ids.tvdb,
          traktId: ids.trakt,
          traktSlug: ids.slug,
          tmdbId: ids.tmdb,
        };
      }
    } catch (err) {
      console.warn("[discover-series-ids] Trakt text search falhou", {
        title,
        error: (err as Error)?.message,
      });
    }
  }

  return null;
}

/**
 * Master resolver: tries TMDB-based lookup first, falls back to title search.
 * Logs which method succeeded.
 */
export async function discoverTvSeriesIds(params: {
  tmdbId?: number | null;
  title?: string | null;
  year?: number | null;
}): Promise<DiscoveredSeriesIds | null> {
  // Strategy 1: TMDB ID cross-reference (most precise, no title ambiguity)
  if (params.tmdbId && params.tmdbId > 0) {
    const byTmdb = await discoverTvSeriesIdsByTmdbId(params.tmdbId);
    if (byTmdb?.imdbId || byTmdb?.tvdbId) return byTmdb;
  }

  // Strategy 2: title + year search (fallback for synthetic/missing TMDB IDs)
  if (params.title) {
    return discoverTvSeriesIdsByTitle(params.title, params.year);
  }

  return null;
}
