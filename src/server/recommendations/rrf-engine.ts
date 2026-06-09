/**
 * rrf-engine.ts — Legacy RRF utilities (kept for reference / potential future use).
 *
 * The active recommendation engine is balloon-engine.ts.
 * Balloonerismm is now the sole relevance source; Trakt is the hydration layer.
 * applyRRF is no longer used in the recommendation pipelines.
 */

import { balloonerismGet, isBalloonerismActive } from "@/server/api-clients/balloonerismm/client";

// ─── Balloonerismm related/similar response ────────────────────────────────────

export type BalloonRelatedItem = {
  id: string;            // IMDb ID: "tt..."
  title: string;
  original_title?: string;
  overview?: string;
  poster_path?: string;  // full URL (not a TMDB relative path)
  vote_average?: number;
  vote_count?: number;
  release_date?: string;   // "YYYY-MM-DD" (movies)
  first_air_date?: string; // "YYYY-MM-DD" (shows)
  genre_ids?: number[];
};

type BalloonRelatedResponse = { results?: BalloonRelatedItem[] } | BalloonRelatedItem[];

// ─── Normalized source item for RRF ──────────────────────────────────────────

export type RRFSourceItem = {
  imdbId: string;
  tmdbId?: number;       // available from Trakt when present; absent for Balloon-only
  title: string;
  overview?: string | null;
  posterUrl?: string | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  year?: string | null;
  genreIds?: number[];
};

// ─── RRF output ──────────────────────────────────────────────────────────────

export type RRFResult = RRFSourceItem & {
  rrfScore: number;
  sourcesCount: number;
  sources: string[];
};

// ─── Fetch Balloonerismm ───────────────────────────────────────────────────────

/**
 * Fetches both /recommendations and /similar for a title from Balloonerismm.
 * Returns deduplicated items (by IMDb ID), recommendations-first.
 * Returns [] when Balloonerismm is inactive or imdbId is missing.
 */
export async function fetchBalloonerismm(
  imdbId: string | null | undefined,
  mediaType: "movie" | "tv",
): Promise<BalloonRelatedItem[]> {
  if (!imdbId || !isBalloonerismActive()) return [];

  const kind = mediaType === "movie" ? "movie" : "tv";

  const [recsResult, simResult] = await Promise.allSettled([
    balloonerismGet<BalloonRelatedResponse>(
      `/${kind}/${encodeURIComponent(imdbId)}/recommendations`,
      { ttlSeconds: 86_400 },
    ),
    balloonerismGet<BalloonRelatedResponse>(
      `/${kind}/${encodeURIComponent(imdbId)}/similar`,
      { ttlSeconds: 86_400 },
    ),
  ]);

  function extractItems(
    r: PromiseSettledResult<BalloonRelatedResponse | null>,
  ): BalloonRelatedItem[] {
    if (r.status === "rejected" || !r.value) return [];
    const v = r.value;
    const items = Array.isArray(v) ? v : (v.results ?? []);
    return items.filter(
      (i): i is BalloonRelatedItem =>
        typeof (i as BalloonRelatedItem)?.id === "string" &&
        (i as BalloonRelatedItem).id.startsWith("tt"),
    );
  }

  const all = [...extractItems(recsResult), ...extractItems(simResult)];

  const seen = new Set<string>();
  return all.filter((i) => {
    if (seen.has(i.id)) return false;
    seen.add(i.id);
    return true;
  });
}

// ─── RRF engine ──────────────────────────────────────────────────────────────

const RRF_K = 60;
const MULTI_SOURCE_BONUS = 0.35; // +35% per extra source (matches HTML test engine)

/**
 * Applies Reciprocal Rank Fusion across multiple ranked source lists.
 *
 * Items are keyed by imdbId. The same movie from two sources is merged into
 * one result with a combined score and multi-source bonus. Items without
 * imdbId cannot participate in RRF deduplication and must be handled by the
 * caller.
 *
 * @param sources  Named map of ranked lists (e.g. { Trakt: [...], Balloonerismm: [...] })
 * @returns        Deduplicated, sorted results with rrfScore, sourcesCount, sources[]
 */
export function applyRRF(sources: Record<string, RRFSourceItem[]>): RRFResult[] {
  type Entry = RRFSourceItem & {
    totalScore: number;
    sourcesCount: number;
    sources: string[];
  };

  const map = new Map<string, Entry>();

  for (const [sourceName, items] of Object.entries(sources)) {
    if (!items.length) continue;

    items.forEach((item, idx) => {
      if (!item.imdbId) return;

      const rrfScore = 1 / (RRF_K + idx + 1);

      if (!map.has(item.imdbId)) {
        map.set(item.imdbId, {
          imdbId:      item.imdbId,
          tmdbId:      item.tmdbId,
          title:       item.title,
          overview:    item.overview   ?? null,
          posterUrl:   item.posterUrl  ?? null,
          voteAverage: item.voteAverage ?? null,
          voteCount:   item.voteCount   ?? null,
          year:        item.year        ?? null,
          genreIds:    item.genreIds    ?? [],
          totalScore:  0,
          sourcesCount: 0,
          sources:     [],
        });
      }

      const entry = map.get(item.imdbId)!;
      entry.totalScore  += rrfScore;
      entry.sourcesCount++;
      entry.sources.push(sourceName);

      // Prefer canonical tmdbId from Trakt (always positive)
      if (!entry.tmdbId && item.tmdbId && item.tmdbId > 0) entry.tmdbId = item.tmdbId;
      // First-seen wins for optional fields
      if (!entry.posterUrl   && item.posterUrl)   entry.posterUrl   = item.posterUrl;
      if (entry.voteAverage  == null && item.voteAverage  != null) entry.voteAverage  = item.voteAverage;
      if (entry.voteCount    == null && item.voteCount    != null) entry.voteCount    = item.voteCount;
      if (!entry.year        && item.year)        entry.year        = item.year;
      if (!entry.genreIds?.length && item.genreIds?.length) entry.genreIds = item.genreIds;
    });
  }

  const ranked = Array.from(map.values()).map((entry): RRFResult => {
    const bonus = 1 + (entry.sourcesCount - 1) * MULTI_SOURCE_BONUS;
    return {
      imdbId:      entry.imdbId,
      tmdbId:      entry.tmdbId,
      title:       entry.title,
      overview:    entry.overview,
      posterUrl:   entry.posterUrl,
      voteAverage: entry.voteAverage,
      voteCount:   entry.voteCount,
      year:        entry.year,
      genreIds:    entry.genreIds,
      rrfScore:    entry.totalScore * bonus,
      sourcesCount: entry.sourcesCount,
      sources:     entry.sources,
    };
  });

  ranked.sort((a, b) => b.rrfScore - a.rrfScore);
  return ranked;
}
