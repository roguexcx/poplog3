import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserFeedbackMap, feedbackKey } from "@/lib/personalization/feedback";
import { resolveEditorialPolicy } from "@/lib/personalization/editorial-policy";
import {
  scoreTitleForUser,
  type LegacyTitleSignalMap,
  type UserRatingSignalMap,
} from "@/lib/personalization/scoring";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";

// ─── Types ────────────────────────────────────────────────────────────────────

type MediaType = "movie" | "tv";
type SeedReasonType = "favorite" | "watchlist" | "watched" | "watching" | "default";

type UserTitle = {
  tmdb_id: number;
  media_type: MediaType;
  status: "watchlist" | "watched" | "watching" | "fridge" | null;
  favorite?: boolean;
  rating?: number | null;
};

type UserRatingSignal = {
  tmdb_id: number;
  media_type: MediaType;
  rating: number;
};

type TMDBGenre = { id: number; name: string };

type TMDBItem = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  original_language?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  vote_count?: number;
  popularity?: number;
  release_date?: string;
  first_air_date?: string;
  genre_ids?: number[];
  genres?: TMDBGenre[];
  media_type?: MediaType;
};

type CachedTitleRow = {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  original_title: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  first_air_date: string | null;
  genres: Array<number | string | { id?: number; name?: string }> | null;
  popularity: number | null;
  vote_average: number | null;
  vote_count: number | null;
  original_language: string | null;
};

type Candidate = {
  item: TMDBItem;
  mediaType: MediaType;
  score: number;
  seedTitle?: string;
  seedReasonType?: SeedReasonType;
};

type ForYouResponse = {
  featured: Awaited<ReturnType<typeof normalizeForResponse>> | null;
  items: Array<Awaited<ReturnType<typeof normalizeForResponse>>>;
};

type ForYouCachePayload = {
  inputKey: string;
  response: ForYouResponse;
  generatedAt: string;
};

const FOR_YOU_CACHE_TTL_MS = 30 * 60_000;

// ─── Géneros ──────────────────────────────────────────────────────────────────

const GENRES: Record<number, string> = {
  28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia",
  80: "Crime", 99: "Documentário", 18: "Drama", 10751: "Família",
  14: "Fantasia", 36: "História", 27: "Terror", 10402: "Música",
  9648: "Mistério", 10749: "Romance", 878: "Ficção científica",
  10770: "Cinema TV", 53: "Suspense", 10752: "Guerra", 37: "Faroeste",
  10759: "Ação e aventura", 10762: "Infantil", 10763: "Notícias",
  10764: "Reality", 10765: "Sci-fi e fantasia", 10766: "Novela",
  10767: "Talk show", 10768: "Guerra e política",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getTitle(item: TMDBItem): string {
  return item.title ?? item.name ?? item.original_title ?? item.original_name ?? "Título sem nome";
}

function getOriginalTitle(item: TMDBItem): string | null {
  return item.original_title ?? item.original_name ?? null;
}

function getSignalWeight(title: UserTitle): number {
  if (title.favorite) return 5;
  if (typeof title.rating === "number" && title.rating >= 4) return 4.5;
  if (title.status === "watchlist") return 4;
  if (title.status === "watched") return 3;
  if (title.status === "watching") return 2;
  return 1;
}

function getSeedReason(seed: UserTitle): SeedReasonType {
  if (seed.favorite) return "favorite";
  if (typeof seed.rating === "number" && seed.rating >= 4) return "watched";
  if (seed.status === "watchlist") return "watchlist";
  if (seed.status === "watched") return "watched";
  if (seed.status === "watching") return "watching";
  return "default";
}

function formatReason(type?: SeedReasonType, seedTitle?: string): string {
  if (!seedTitle) return "Combina com você";
  if (type === "favorite") return `Porque você curte ${seedTitle}`;
  if (type === "watchlist") return `Porque você se interessou por ${seedTitle}`;
  if (type === "watched") return `Porque você viu ${seedTitle}`;
  if (type === "watching") return `Porque você acompanha ${seedTitle}`;
  return `Combina com ${seedTitle}`;
}

const ALLOWED_LANGUAGES = new Set(["en", "pt", "es", "fr", "it", "ja", "ko"]);

function isGoodCandidate(item: TMDBItem): boolean {
  if (!item.backdrop_path && !item.poster_path) return false;
  if ((item.vote_average ?? 0) < 5.8) return false;
  if ((item.vote_count ?? 0) < 80) return false;
  if ((item.popularity ?? 0) < 8) return false;
  if (item.original_language && !ALLOWED_LANGUAGES.has(item.original_language)) return false;

  // Excluir títulos não lançados: sem data de lançamento conhecida OU data futura
  const releaseDate = item.release_date ?? item.first_air_date ?? null;
  if (!releaseDate) return false;
  const releaseTime = new Date(releaseDate).getTime();
  if (Number.isFinite(releaseTime) && releaseTime > Date.now()) return false;

  return true;
}

function shuffleArray<T>(array: T[]): T[] {
  return [...array].sort(() => Math.random() - 0.5);
}

function buildInputKey(titles: UserTitle[]) {
  const normalized = titles
    .filter((item) => item.tmdb_id && item.media_type)
    .map((item) => ({
      tmdb_id: item.tmdb_id,
      media_type: item.media_type,
      status: item.status,
      favorite: Boolean(item.favorite),
    }))
    .sort((a, b) =>
      `${a.media_type}:${a.tmdb_id}`.localeCompare(`${b.media_type}:${b.tmdb_id}`),
    );

  return createHash("sha1").update(JSON.stringify(normalized)).digest("hex");
}

async function getUserRatingSignals(userId: string): Promise<UserRatingSignal[]> {
  const { data, error } = await supabaseAdmin
    .from("user_ratings")
    .select("tmdb_id, media_type, rating")
    .eq("user_id", userId)
    .in("media_type", ["movie", "tv"]);

  if (error) {
    console.warn("[home/for-you] rating signal read failed", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => ({
      tmdb_id: Number(row.tmdb_id),
      media_type: row.media_type as MediaType,
      rating: Number(row.rating),
    }))
    .filter(
      (row): row is UserRatingSignal =>
        Number.isInteger(row.tmdb_id) &&
        row.tmdb_id > 0 &&
        (row.media_type === "movie" || row.media_type === "tv") &&
        Number.isFinite(row.rating),
    );
}

function buildRatingSignalMap(ratings: UserRatingSignal[]): UserRatingSignalMap {
  return new Map(ratings.map((rating) => [feedbackKey(rating.tmdb_id, rating.media_type), rating.rating]));
}

function buildLegacySignalMap(titles: UserTitle[]): LegacyTitleSignalMap {
  return new Map(
    titles.map((title) => [
      feedbackKey(title.tmdb_id, title.media_type),
      { favorite: Boolean(title.favorite), status: title.status },
    ]),
  );
}

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

function extractGenreIds(genres: CachedTitleRow["genres"]): number[] {
  if (!Array.isArray(genres)) return [];

  return genres
    .map((genre) => {
      if (typeof genre === "number") return genre;
      if (typeof genre === "string") {
        const parsed = Number(genre);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return typeof genre.id === "number" ? genre.id : null;
    })
    .filter((id): id is number => typeof id === "number");
}

function cachedTitleToItem(row: CachedTitleRow): TMDBItem {
  return {
    id: row.tmdb_id,
    title: row.media_type === "movie" ? row.title ?? undefined : undefined,
    name: row.media_type === "tv" ? row.title ?? undefined : undefined,
    original_title: row.media_type === "movie" ? row.original_title ?? undefined : undefined,
    original_name: row.media_type === "tv" ? row.original_title ?? undefined : undefined,
    original_language: row.original_language ?? undefined,
    overview: row.overview ?? undefined,
    poster_path: row.poster_path,
    backdrop_path: row.backdrop_path,
    vote_average: row.vote_average ?? 0,
    vote_count: row.vote_count ?? 0,
    popularity: row.popularity ?? 0,
    release_date: row.release_date ?? undefined,
    first_air_date: row.first_air_date ?? undefined,
    genre_ids: extractGenreIds(row.genres),
    media_type: row.media_type,
  };
}

async function buildLocalCandidateMap(
  seeds: UserTitle[],
  knownKeys: Set<string>,
): Promise<Map<string, Candidate>> {
  const candidateMap = new Map<string, Candidate>();
  const seedIds = Array.from(new Set(seeds.map((seed) => seed.tmdb_id)));

  if (seedIds.length === 0) return candidateMap;

  const selectColumns =
    "tmdb_id, media_type, title, original_title, overview, poster_path, backdrop_path, release_date, first_air_date, genres, popularity, vote_average, vote_count, original_language";

  const [seedResult, candidateResult] = await Promise.all([
    supabaseAdmin
      .from("poplog3_titles")
      .select(selectColumns)
      .in("tmdb_id", seedIds),
    supabaseAdmin
      .from("poplog3_titles")
      .select(selectColumns)
      .not("poster_path", "is", null)
      .gte("vote_average", 5.8)
      .gte("popularity", 8)
      .order("popularity", { ascending: false })
      .limit(120),
  ]);

  if (seedResult.error) {
    console.warn("[home/for-you] seed title cache read failed", seedResult.error.message);
  }
  if (candidateResult.error) {
    console.warn("[home/for-you] candidate title cache read failed", candidateResult.error.message);
  }

  const seedRows = (seedResult.data ?? []) as CachedTitleRow[];
  const seedByKey = new Map(seedRows.map((row) => [`${row.media_type}-${row.tmdb_id}`, row]));
  const preferredGenreIds = new Set<number>();
  for (const row of seedRows) {
    for (const genreId of extractGenreIds(row.genres)) preferredGenreIds.add(genreId);
  }

  const fallbackSeed = seeds[0];
  const fallbackSeedTitle = fallbackSeed
    ? getTitle(cachedTitleToItem(seedByKey.get(`${fallbackSeed.media_type}-${fallbackSeed.tmdb_id}`) ?? {
        tmdb_id: fallbackSeed.tmdb_id,
        media_type: fallbackSeed.media_type,
        title: null,
        original_title: null,
        overview: null,
        poster_path: null,
        backdrop_path: null,
        release_date: null,
        first_air_date: null,
        genres: null,
        popularity: null,
        vote_average: null,
        vote_count: null,
        original_language: null,
      }))
    : undefined;

  for (const row of (candidateResult.data ?? []) as CachedTitleRow[]) {
    const item = cachedTitleToItem(row);
    const key = `${row.media_type}-${row.tmdb_id}`;
    if (knownKeys.has(key) || !isGoodCandidate(item)) continue;

    const genreOverlap = item.genre_ids?.filter((id) => preferredGenreIds.has(id)).length ?? 0;
    const bestSeed = seeds.find((seed) => {
      const seedRow = seedByKey.get(`${seed.media_type}-${seed.tmdb_id}`);
      if (!seedRow) return false;
      const seedGenres = new Set(extractGenreIds(seedRow.genres));
      return item.genre_ids?.some((id) => seedGenres.has(id));
    }) ?? fallbackSeed;
    const seedWeight = bestSeed ? getSignalWeight(bestSeed) : 1;
    const rating = item.vote_average ?? 0;
    const popularity = item.popularity ?? 0;
    const voteCount = item.vote_count ?? 0;

    let score = seedWeight * 18;
    score += genreOverlap * 18;
    score += Math.min(rating, 10) * 2.4;
    score += Math.min(popularity / 10, 14);
    score += Math.min(voteCount / 700, 8);
    if (item.original_language === "pt") score += 4;
    if (item.original_language === "en") score += 3;

    candidateMap.set(key, {
      item,
      score,
      seedTitle: bestSeed
        ? getTitle(cachedTitleToItem(seedByKey.get(`${bestSeed.media_type}-${bestSeed.tmdb_id}`) ?? row))
        : fallbackSeedTitle,
      seedReasonType: bestSeed ? getSeedReason(bestSeed) : undefined,
      mediaType: row.media_type,
    });
  }

  return candidateMap;
}

// ─── Imagens ──────────────────────────────────────────────────────────────────

async function resolveImagesForCandidate(
  _mediaType: MediaType,
  item: TMDBItem,
): Promise<{ cleanPosterPath: string | null; backdropPath: string | null }> {
  return {
    cleanPosterPath: item.poster_path ?? null,
    backdropPath: item.backdrop_path ?? null,
  };
}

// ─── Normalização para resposta ───────────────────────────────────────────────

async function normalizeForResponse(candidate: Candidate) {
  const { item, mediaType, seedReasonType, seedTitle } = candidate;

  const { cleanPosterPath, backdropPath } = await resolveImagesForCandidate(mediaType, item);

  const genre_label =
    item.genre_ids
      ?.slice(0, 2)
      .map((id) => GENRES[id])
      .filter(Boolean)
      .join(", ") ?? null;

  return {
    ...item,
    media_type: mediaType,
    poster_path: cleanPosterPath,
    clean_poster_path: cleanPosterPath,
    backdrop_path: backdropPath,
    title_label: getTitle(item),
    original_title_label: getOriginalTitle(item),
    year: item.release_date?.split("-")[0] ?? item.first_air_date?.split("-")[0] ?? null,
    media_label: mediaType === "tv" ? "Série" : "Filme",
    genre_label,
    reason: formatReason(seedReasonType, seedTitle),
  };
}

// ─── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  const stageRef = { value: totalStartedAt };

  try {
    const user = await getCurrentUser();
    markStage(perf, stageRef, "auth");

    const { titles } = await request.json();
    markStage(perf, stageRef, "request_parse");

    if (!Array.isArray(titles) || titles.length === 0) {
      return NextResponse.json({ featured: null, items: [] });
    }

    const userTitles: UserTitle[] = titles.filter(
      (item: UserTitle) => item.tmdb_id && item.media_type,
    );
    const sectionKey = "home_for_you";

    const [feedbackMap, ratingSignals] = user
      ? await Promise.all([getUserFeedbackMap(user.id), getUserRatingSignals(user.id)])
      : [undefined, [] as UserRatingSignal[]];
    const ratingMap = buildRatingSignalMap(ratingSignals);
    const legacySignalMap = buildLegacySignalMap(userTitles);
    const ratingSeeds: UserTitle[] = ratingSignals
      .filter((rating) => rating.rating >= 4)
      .map((rating) => ({
        tmdb_id: rating.tmdb_id,
        media_type: rating.media_type,
        status: "watched",
        favorite: false,
        rating: rating.rating,
      }));
    const inputKey = buildInputKey([...userTitles, ...ratingSeeds]);
    markStage(perf, stageRef, "preference_read");

    if (user) {
      const cached = await readContinuitySectionCache<ForYouCachePayload>(sectionKey, {
        userId: user.id,
        region: "BR",
        language: "pt-BR",
      });
      markStage(perf, stageRef, "cache_read");

      if (cached?.status === "hit" && cached.payload.inputKey === inputKey) {
        console.log("[home/for-you/perf]", {
          cacheStatus: "persistent_hit",
          returned: cached.payload.response.items.length,
          ...perf,
          total: Date.now() - totalStartedAt,
        });
        return NextResponse.json(cached.payload.response);
      }
    }

    const knownKeys = new Set([
      ...userTitles.map((t) => `${t.media_type}-${t.tmdb_id}`),
      ...ratingSignals.map((t) => `${t.media_type}-${t.tmdb_id}`),
    ]);

    const seeds = [
      ...shuffleArray(userTitles.filter((t) => t.favorite)).slice(0, 5),
      ...shuffleArray(ratingSeeds).slice(0, 5),
      ...shuffleArray(userTitles.filter((t) => t.status === "watchlist")).slice(0, 2),
      ...shuffleArray(userTitles.filter((t) => t.status === "watched")).slice(0, 2),
      ...shuffleArray(userTitles.filter((t) => t.status === "watching")).slice(0, 1),
    ];

    const candidateMap = await buildLocalCandidateMap(seeds, knownKeys);
    markStage(perf, stageRef, "local_candidates");

    const allCandidates = [...candidateMap.values()]
      .map((candidate, index) => {
        const scoredItem = scoreTitleForUser(
          {
            ...candidate.item,
            media_type: candidate.mediaType,
            personalScore: candidate.score,
          },
          index,
          {
            userId: user?.id,
            feedbackMap,
            ratingMap,
            legacySignalMap,
            context: "for_you",
            mediaType: candidate.mediaType,
            getBaseScore: () => candidate.score,
          },
        );

        return {
          ...candidate,
          item: scoredItem,
          score: scoredItem.personalScore ?? candidate.score,
        };
      })
      .sort((a, b) => b.score - a.score)
      // Exclude hard blocks from for_you; direct search/title pages can still show them.
      .filter((candidate) => {
        const key = feedbackKey(candidate.item.id, candidate.mediaType);
        const rows = feedbackMap?.get(key) ?? [];
        const feedbackInput = rows.map((r) => ({
          feedback_type: r.feedback_type,
          weight: r.weight,
          updated_at: r.updated_at,
          active: r.active,
        }));
        const policy = resolveEditorialPolicy({
          feedback: feedbackInput,
          legacy: legacySignalMap.get(key) ?? null,
          rating: ratingMap.get(key) ?? null,
          surface: "for_you",
        });
        return !policy.shouldExclude;
      });
    markStage(perf, stageRef, "scoring");

    const movieCandidates = allCandidates.filter((c) => c.mediaType === "movie");
    const tvCandidates = allCandidates.filter((c) => c.mediaType === "tv");

    const preferTv = Math.random() >= 0.5;
    const featuredCandidate = preferTv
      ? (tvCandidates[0] ?? movieCandidates[0] ?? allCandidates[0])
      : (movieCandidates[0] ?? tvCandidates[0] ?? allCandidates[0]);

    const usedKeys = new Set<string>();

    if (featuredCandidate) {
      usedKeys.add(`${featuredCandidate.mediaType}-${featuredCandidate.item.id}`);
    }

    const sideMovies = movieCandidates.filter((c) => !usedKeys.has(`${c.mediaType}-${c.item.id}`));
    const sideTv = tvCandidates.filter((c) => !usedKeys.has(`${c.mediaType}-${c.item.id}`));

    const balancedItems: Candidate[] = [];

    while (balancedItems.length < 4 && (sideMovies.length || sideTv.length)) {
      const nextMovie = sideMovies.shift();
      const nextTv = sideTv.shift();

      if (balancedItems.length < 4 && nextMovie) balancedItems.push(nextMovie);
      if (balancedItems.length < 4 && nextTv) balancedItems.push(nextTv);
    }

    if (balancedItems.length < 4) {
      const usedInBalanced = new Set(balancedItems.map((c) => `${c.mediaType}-${c.item.id}`));
      const fallback = allCandidates.filter(
        (c) =>
          !usedKeys.has(`${c.mediaType}-${c.item.id}`) &&
          !usedInBalanced.has(`${c.mediaType}-${c.item.id}`),
      );

      balancedItems.push(...fallback.slice(0, 4 - balancedItems.length));
    }

    const response: ForYouResponse = {
      featured: featuredCandidate ? await normalizeForResponse(featuredCandidate) : null,
      items: await Promise.all(balancedItems.slice(0, 4).map(normalizeForResponse)),
    };
    markStage(perf, stageRef, "response_build");

    if (user) {
      await writeContinuitySectionCache({
        sectionKey,
        userId: user.id,
        region: "BR",
        language: "pt-BR",
        ttlMs: FOR_YOU_CACHE_TTL_MS,
        payload: {
          inputKey,
          response,
          generatedAt: new Date().toISOString(),
        } satisfies ForYouCachePayload,
      });
      markStage(perf, stageRef, "cache_write");
    }

    console.log("[home/for-you/perf]", {
      cacheStatus: "persistent_miss",
      seeds: seeds.length,
      candidates: candidateMap.size,
      returned: response.items.length,
      external_sync: 0,
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json(response);
  } catch (error) {
    console.error("[home/for-you] unhandled error", error);
    return NextResponse.json({ featured: null, items: [] }, { status: 200 });
  }
}
