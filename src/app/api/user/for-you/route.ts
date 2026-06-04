import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import { catalogGetRelated } from "@/server/source-engine/engine";
import { isBalloonerismActive } from "@/server/api-clients/balloonerismm/client";
import type { UserTitle } from "@/types/user";

// ─── Genre map (TMDB IDs → pt-BR) ────────────────────────────────────────────

const GENRE_MAP: Record<number, string> = {
  28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia",
  80: "Crime", 99: "Documentário", 18: "Drama", 10751: "Família",
  14: "Fantasia", 36: "História", 27: "Terror", 10402: "Música",
  9648: "Mistério", 10749: "Romance", 878: "Ficção Científica",
  53: "Thriller", 10752: "Guerra", 37: "Faroeste",
  10759: "Ação & Aventura", 10762: "Infantil", 10763: "Notícias",
  10764: "Reality", 10765: "Sci-Fi & Fantasia", 10768: "Guerra & Política",
};

// ─── Seed weights ─────────────────────────────────────────────────────────────

function ratingWeight(rating: number): number {
  if (rating >= 5.0) return 80;
  if (rating >= 4.5) return 70;
  if (rating >= 4.0) return 60;
  if (rating >= 3.5) return 40;
  if (rating >= 3.0) return 30;
  return 0;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type RecItem = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  media_type?: string;
};

type ForYouItem = {
  id: number;
  title_label: string;
  original_title_label?: string | null;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  year?: string | null;
  media_type: "movie" | "tv";
  media_label?: string;
  genre_label?: string | null;
  reason?: string;
  userFeedback?: { notInterested?: boolean };
};

type WeightedSeed = {
  title: UserTitle;
  weight: number;
  rating: number | null;
  isFavorite: boolean;
};

// ─── Seed selection ───────────────────────────────────────────────────────────

const EXCLUDED_STATUSES = new Set(["abandoned", "fridge"]);

function buildWeightedSeeds(
  titles: UserTitle[],
  ratingMap: Map<string, number>,
): WeightedSeed[] {
  const seeds: WeightedSeed[] = [];

  for (const t of titles) {
    if (EXCLUDED_STATUSES.has(t.status)) continue;

    const rating = ratingMap.get(`${t.media_type}:${t.tmdb_id}`) ?? null;

    // Low ratings block entirely — don't use as seed
    if (rating !== null && rating <= 2.5) continue;

    let weight = 0;
    if (t.favorite) weight += 100;
    if (rating !== null) weight += ratingWeight(rating);
    if (t.status === "watchlist") weight += 20;
    if (t.status === "watching") weight += 15;
    if (t.status === "watched") weight += 10;

    if (weight > 0) {
      seeds.push({ title: t, weight, rating, isFavorite: t.favorite });
    }
  }

  return seeds;
}

// Picks up to 3 seeds with a random jitter applied to weights so that
// same-tier seeds rotate between refreshes while strong signals stay on top.
function pickSeeds(seeds: WeightedSeed[]): WeightedSeed[] {
  if (seeds.length === 0) return [];

  // Add up to 20 pts of jitter — keeps dominant seeds on top but rotates ties
  const jittered = seeds.map((s) => ({
    seed: s,
    effective: s.weight + Math.random() * 20,
  }));
  jittered.sort((a, b) => b.effective - a.effective);

  const picks: WeightedSeed[] = [];
  const seenTypes = new Set<string>();

  // First pass: one of each media type
  for (const { seed } of jittered) {
    if (picks.length >= 3) break;
    if (!seenTypes.has(seed.title.media_type)) {
      picks.push(seed);
      seenTypes.add(seed.title.media_type);
    }
  }

  // Fill remaining slots (same media type allowed for 3rd seed)
  for (const { seed } of jittered) {
    if (picks.length >= 3) break;
    if (!picks.includes(seed)) picks.push(seed);
  }

  return picks;
}

function buildReason(seed: WeightedSeed, titleLabel: string): string {
  if (seed.isFavorite) {
    return `Porque você favoritou "${titleLabel}"`;
  }
  if (seed.rating !== null && seed.rating >= 3.0) {
    const stars =
      seed.rating % 1 === 0
        ? `${seed.rating.toFixed(0)}`
        : `${seed.rating.toFixed(1)}`;
    return `Porque você avaliou "${titleLabel}" com ${stars} estrelas`;
  }
  return `Baseado na sua watchlist`;
}

// ─── Weighted random sampler ──────────────────────────────────────────────────

// Roulette-wheel selection without replacement.
function weightedSample<T>(
  items: T[],
  getWeight: (item: T) => number,
  n: number,
): T[] {
  const pool = [...items];
  const result: T[] = [];

  while (result.length < n && pool.length > 0) {
    const weights = pool.map((item) => Math.max(0.1, getWeight(item)));
    const total = weights.reduce((a, b) => a + b, 0);
    let r = Math.random() * total;
    let picked = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) { picked = i; break; }
    }
    result.push(pool[picked]);
    pool.splice(picked, 1);
  }

  return result;
}

// ─── Recommendations ──────────────────────────────────────────────────────────

async function fetchRecs(
  mediaType: "movie" | "tv",
  imdbId?: string | null,
): Promise<RecItem[]> {
  // 1. Try Balloonerismm (IMDb-first, needs imdbId)
  if (imdbId) {
    try {
      const results = await catalogGetRelated({
        mediaType: mediaType === "tv" ? "show" : "movie",
        imdbId,
      });
      const mapped: RecItem[] = results
        .filter((r) => typeof r.ids.tmdbId === "number")
        .map((r) => ({
          id: r.ids.tmdbId!,
          title: r.mediaType === "movie" ? r.title : undefined,
          name: r.mediaType === "show" ? r.title : undefined,
          original_title: r.originalTitle,
          overview: r.overview,
          poster_path: r.posterPath ?? null,
          backdrop_path: r.backdropPath ?? null,
          vote_average: r.voteAverage,
          release_date: r.releaseDate,
          first_air_date: r.firstAirDate,
          genre_ids: r.genreIds,
          media_type: r.mediaType === "show" ? "tv" : "movie",
        }));
      if (mapped.length > 0) return mapped;
    } catch { /* fall through to local DB */ }
  }

  // 2. Local DB fallback: popular titles of same media type
  try {
    const rows = await db.poplog3Title.findMany({
      where: { mediaType, voteAverage: { gte: 5 } },
      orderBy: { popularity: "desc" },
      take: 40,
      select: {
        tmdbId: true,
        title: true,
        originalTitle: true,
        overview: true,
        posterPath: true,
        backdropPath: true,
        voteAverage: true,
        releaseDate: true,
        firstAirDate: true,
        mediaType: true,
      },
    });
    return rows.map((row) => ({
      id: row.tmdbId,
      title: row.mediaType === "movie" ? (row.title ?? undefined) : undefined,
      name: row.mediaType === "tv" ? (row.title ?? undefined) : undefined,
      original_title: row.originalTitle ?? undefined,
      overview: row.overview ?? undefined,
      poster_path: row.posterPath ?? null,
      backdrop_path: row.backdropPath ?? null,
      vote_average: row.voteAverage ? Number(row.voteAverage) : undefined,
      release_date: row.releaseDate?.toISOString().slice(0, 10),
      first_air_date: row.firstAirDate?.toISOString().slice(0, 10),
      genre_ids: [],
      media_type: row.mediaType,
    }));
  } catch {
    return [];
  }
}

function yearFrom(r: RecItem): string | null {
  const d = r.release_date ?? r.first_air_date;
  if (!d) return null;
  const y = new Date(d).getFullYear();
  return Number.isFinite(y) ? String(y) : null;
}

function toItem(r: RecItem, mediaType: "movie" | "tv", reason: string): ForYouItem {
  const titleLabel =
    (mediaType === "movie" ? r.title : r.name) ?? r.title ?? r.name ?? "Título";
  const originalTitle =
    (mediaType === "movie" ? r.original_title : r.original_name) ?? null;
  const genreLabel = r.genre_ids?.[0] ? (GENRE_MAP[r.genre_ids[0]] ?? null) : null;

  return {
    id: r.id,
    title_label: titleLabel,
    original_title_label: originalTitle !== titleLabel ? originalTitle : null,
    overview: r.overview || undefined,
    poster_path: r.poster_path ?? null,
    backdrop_path: r.backdrop_path ?? null,
    vote_average: r.vote_average || undefined,
    year: yearFrom(r),
    media_type: mediaType,
    media_label: mediaType === "movie" ? "Filme" : "Série",
    genre_label: genreLabel,
    reason,
  };
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const titles: UserTitle[] = Array.isArray(body?.titles) ? body.titles : [];

    if (titles.length === 0) {
      return NextResponse.json({
        featured: null,
        items: [],
        usedTmdbApi: false,
        recommendationSource: "controlled_empty",
      });
    }

    const librarySet = new Set(titles.map((t) => `${t.media_type}:${t.tmdb_id}`));

    // Auth is needed for ratings + not_interested queries
    const user = await getCurrentUser().catch(() => null);

    // Load user's explicit movie/tv ratings from DB
    const ratingMap = new Map<string, number>();
    if (user) {
      try {
        const rows = await db.userRating.findMany({
          where: {
            userId: user.id,
            mediaType: { in: ["movie", "tv"] },
            ratingSource: "explicit",
          },
          select: { tmdbId: true, mediaType: true, rating: true },
        });
        for (const r of rows) {
          ratingMap.set(`${r.mediaType}:${r.tmdbId}`, Number(r.rating));
        }
      } catch { /* non-fatal */ }
    }

    // Build weighted seeds and pick up to 3 (with jitter for rotation)
    const weightedSeeds = buildWeightedSeeds(titles, ratingMap);
    const picks = pickSeeds(weightedSeeds);

    if (picks.length === 0) {
      return NextResponse.json({
        featured: null,
        items: [],
        usedTmdbApi: false,
        recommendationSource: "controlled_empty",
      });
    }

    // Resolve seed labels from Prisma cache (for reason strings)
    const seedLabels = new Map<string, string>();
    await Promise.all(
      picks.map(async (seed) => {
        const cached = await db.poplog3Title
          .findUnique({
            where: {
              tmdbId_mediaType: {
                tmdbId: seed.title.tmdb_id,
                mediaType: seed.title.media_type,
              },
            },
            select: { title: true },
          })
          .catch(() => null);
        const label =
          cached?.title ?? seed.title.title ?? "um título que você gostou";
        seedLabels.set(`${seed.title.media_type}:${seed.title.tmdb_id}`, label);
      }),
    );

    // Resolve imdbId for Balloonerismm (if active)
    const imdbIdMap = new Map<string, string>();
    if (isBalloonerismActive()) {
      await Promise.all(
        picks.map(async (seed) => {
          const key = `${seed.title.media_type}:${seed.title.tmdb_id}`;
          const ext = await db.titleExternalId
            .findFirst({
              where: {
                tmdbId: seed.title.tmdb_id,
                mediaType: seed.title.media_type,
                imdbId: { not: null },
              },
              select: { imdbId: true },
            })
            .catch(() => null);
          if (ext?.imdbId) imdbIdMap.set(key, ext.imdbId);
        }),
      );
    }

    // Fetch recommendations for all picks in parallel
    const recArrays = await Promise.all(
      picks.map((s) => {
        const key = `${s.title.media_type}:${s.title.tmdb_id}`;
        return fetchRecs(s.title.media_type, imdbIdMap.get(key));
      }),
    );

    // Aggregate, deduplicate, filter library items
    type Candidate = { rec: RecItem; mediaType: "movie" | "tv"; reason: string };
    const seen = new Set<string>();
    const candidates: Candidate[] = [];

    for (let i = 0; i < picks.length; i++) {
      const seed = picks[i];
      const key = `${seed.title.media_type}:${seed.title.tmdb_id}`;
      const label = seedLabels.get(key) ?? "um título que você gostou";
      const reason = buildReason(seed, label);

      for (const rec of recArrays[i]) {
        const mt = (rec.media_type as "movie" | "tv") ?? seed.title.media_type;
        const recKey = `${mt}:${rec.id}`;
        if (seen.has(recKey) || librarySet.has(recKey)) continue;
        seen.add(recKey);
        candidates.push({ rec, mediaType: mt, reason });
      }
    }

    if (candidates.length === 0) {
      return NextResponse.json({
        featured: null,
        items: [],
        usedTmdbApi: false,
        recommendationSource: "controlled_empty",
      });
    }

    // Query not_interested feedback for all candidates — block completely
    const notInterestedSet = new Set<string>();
    if (user) {
      try {
        const rows = await db.userTitleFeedback.findMany({
          where: {
            userId: user.id,
            feedbackType: "not_interested",
            active: true,
            tmdbId: { in: candidates.map((c) => c.rec.id) },
          },
          select: { tmdbId: true, mediaType: true },
        });
        for (const row of rows) {
          notInterestedSet.add(`${row.mediaType}:${row.tmdbId}`);
        }
      } catch { /* non-fatal */ }
    }

    // Quality pool: remove not_interested and very low-rated titles
    const pool = candidates
      .filter((c) => !notInterestedSet.has(`${c.mediaType}:${c.rec.id}`))
      .filter((c) => (c.rec.vote_average ?? 0) >= 4)
      .sort((a, b) => (b.rec.vote_average ?? 0) - (a.rec.vote_average ?? 0))
      .slice(0, 20);

    if (pool.length === 0) {
      return NextResponse.json({
        featured: null,
        items: [],
        usedTmdbApi: false,
        recommendationSource: "controlled_empty",
      });
    }

    // Determine recommendation source for debug
    const hadBalloonerismm = isBalloonerismActive() && imdbIdMap.size > 0;
    const recommendationSource = hadBalloonerismm ? "balloonerismm" : "local_db";

    // Weighted random sample of 5 from the pool
    const selected = weightedSample(
      pool,
      (c) => (c.rec.vote_average ?? 5) - 4,
      Math.min(5, pool.length),
    );

    const items: ForYouItem[] = selected.map(({ rec, mediaType, reason }) =>
      toItem(rec, mediaType, reason),
    );

    // Featured = highest vote_average among items with a backdrop
    const withBackdrop = items
      .map((it, i) => ({ it, i }))
      .filter(({ it }) => it.backdrop_path);

    const pickedIdx =
      withBackdrop.length > 0
        ? withBackdrop.sort(
            (a, b) => (b.it.vote_average ?? 0) - (a.it.vote_average ?? 0),
          )[0].i
        : 0;

    const featured = items[pickedIdx] ?? null;
    const rest = items.filter((_, i) => i !== pickedIdx);

    return NextResponse.json({
      featured,
      items: rest,
      usedTmdbApi: false,
      recommendationSource,
    });
  } catch (err) {
    console.error("[/api/user/for-you]", err);
    return NextResponse.json({
      featured: null,
      items: [],
      usedTmdbApi: false,
      recommendationSource: "controlled_empty",
    });
  }
}
