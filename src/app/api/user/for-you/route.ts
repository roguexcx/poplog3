// src/app/api/user/for-you/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

// ─── Tipos locais ─────────────────────────────────────────────────────────────
// TMDBItem aqui é mais rico que o global (genres, vote_count, etc.)
// por isso mantemos tipos locais em vez de importar de tmdb-types

type MediaType = "movie" | "tv";
type SeedReasonType = "favorite" | "watchlist" | "watched" | "watching" | "default";

type UserTitle = {
  tmdb_id: number;
  media_type: MediaType;
  status: "watchlist" | "watched" | "watching" | "fridge" | null;
  favorite?: boolean;
};

type TMDBGenre = { id: number; name: string };

type TMDBImage = {
  file_path: string;
  iso_639_1?: string | null;
  width?: number;
  vote_average?: number;
  vote_count?: number;
};

type TMDBImagesResponse = {
  posters?: TMDBImage[];
  backdrops?: TMDBImage[];
  logos?: TMDBImage[];
};

type TMDBListResponse = {
  results?: TMDBItem[];
};

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

type Candidate = {
  item: TMDBItem;
  mediaType: MediaType;
  score: number;
  seedTitle?: string;
  seedReasonType?: SeedReasonType;
};

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
  if (title.status === "watchlist") return 4;
  if (title.status === "watched") return 3;
  if (title.status === "watching") return 2;
  return 1;
}

function getSeedReason(seed: UserTitle): SeedReasonType {
  if (seed.favorite) return "favorite";
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
  return true;
}

function shuffleArray<T>(array: T[]): T[] {
  return [...array].sort(() => Math.random() - 0.5);
}

// ─── Poster sem texto ─────────────────────────────────────────────────────────

async function getCleanPosterPath(mediaType: MediaType, id: number): Promise<string | null> {
  try {
    const data = await tmdbFetch<TMDBImagesResponse>(`/${mediaType}/${id}/images`, {
      include_image_language: "null,pt,en",
    });

    const posters: TMDBImage[] = data.posters ?? [];

    const best = posters
      .filter((p) => p.file_path && p.iso_639_1 === null)
      .sort((a, b) => {
        const scoreA = (a.vote_average ?? 0) * 10 + (a.vote_count ?? 0) + (a.width ?? 0) / 100;
        const scoreB = (b.vote_average ?? 0) * 10 + (b.vote_count ?? 0) + (b.width ?? 0) / 100;
        return scoreB - scoreA;
      });

    return best[0]?.file_path ?? null;
  } catch {
    return null;
  }
}

async function getRandomBackdropPath(mediaType: MediaType, id: number): Promise<string | null> {
  try {
    const data = await tmdbFetch<TMDBImagesResponse>(`/${mediaType}/${id}/images`, {
      include_image_language: "null",
    });

    const backdrops: TMDBImage[] = data.backdrops ?? [];

    if (backdrops.length === 0) {
      const fallbackData = await tmdbFetch<TMDBImagesResponse>(`/${mediaType}/${id}/images`);
      const fallbackBackdrops: TMDBImage[] = fallbackData.backdrops ?? [];

      if (fallbackBackdrops.length === 0) return null;

      return (
        fallbackBackdrops.sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))[0]
          ?.file_path ?? null
      );
    }

    const bestPool = backdrops
      .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0))
      .slice(0, 10);

    const chosen = bestPool[Math.floor(Math.random() * bestPool.length)];
    return chosen?.file_path ?? null;
  } catch {
    return null;
  }
}

// ─── Normalização para resposta ───────────────────────────────────────────────

async function normalizeForResponse(candidate: Candidate) {
  const { item, mediaType, seedReasonType, seedTitle } = candidate;

  const [cleanPosterPath, randomBackdropPath] = await Promise.all([
    getCleanPosterPath(mediaType, item.id),
    getRandomBackdropPath(mediaType, item.id),
  ]);

  const genre_label =
    item.genre_ids
      ?.slice(0, 2)
      .map((id) => GENRES[id])
      .filter(Boolean)
      .join(", ") ?? null;

  return {
    ...item,
    media_type: mediaType,
    clean_poster_path: cleanPosterPath,
    backdrop_path: randomBackdropPath ?? item.backdrop_path,
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
  try {
    const { titles } = await request.json();

    if (!Array.isArray(titles) || titles.length === 0) {
      return NextResponse.json({ featured: null, items: [] });
    }

    const userTitles: UserTitle[] = titles.filter(
      (item: UserTitle) => item.tmdb_id && item.media_type,
    );

    const knownKeys = new Set(userTitles.map((t) => `${t.media_type}-${t.tmdb_id}`));

    const seeds = [
      ...shuffleArray(userTitles.filter((t) => t.favorite)).slice(0, 5),
      ...shuffleArray(userTitles.filter((t) => t.status === "watchlist")).slice(0, 2),
      ...shuffleArray(userTitles.filter((t) => t.status === "watched")).slice(0, 2),
      ...shuffleArray(userTitles.filter((t) => t.status === "watching")).slice(0, 1),
    ];

    const candidateMap = new Map<string, Candidate>();

    for (const seed of seeds) {
      const seedWeight = getSignalWeight(seed);
      const mediaType: MediaType = seed.media_type === "tv" ? "tv" : "movie";
      const seedReasonType = getSeedReason(seed);

      let seedDetails: TMDBItem;
      try {
        seedDetails = await tmdbFetch<TMDBItem>(`/${mediaType}/${seed.tmdb_id}`);
      } catch {
        continue;
      }

      const seedTitle = getTitle(seedDetails);
      const seedGenres = new Set((seedDetails.genres ?? []).map((g) => g.id));

      for (const endpoint of [
        `/${mediaType}/${seed.tmdb_id}/recommendations`,
        `/${mediaType}/${seed.tmdb_id}/similar`,
      ]) {
        try {
          const data = await tmdbFetch<TMDBListResponse>(endpoint, { page: "1" });
          const results: TMDBItem[] = data.results ?? [];

          for (const raw of results.slice(0, 16)) {
            const candidate: TMDBItem = { ...raw, media_type: mediaType };
            const key = `${mediaType}-${candidate.id}`;

            if (knownKeys.has(key) || !isGoodCandidate(candidate)) continue;

            const genreOverlap = (candidate.genre_ids ?? []).filter((id) => seedGenres.has(id)).length;
            const rating = candidate.vote_average ?? 0;
            const popularity = candidate.popularity ?? 0;
            const voteCount = candidate.vote_count ?? 0;

            let score = seedWeight * 24;
            score += genreOverlap * 16;
            score += Math.min(rating, 10) * 2.2;
            score += Math.min(popularity / 12, 12);
            score += Math.min(voteCount / 800, 8);
            if (candidate.original_language === "en") score += 4;
            if (candidate.original_language === "pt") score += 3;

            const existing = candidateMap.get(key);
            if (existing) {
              existing.score += score;
            } else {
              candidateMap.set(key, { item: candidate, score, seedTitle, seedReasonType, mediaType });
            }
          }
        } catch {
          continue;
        }
      }
    }

    const allCandidates = [...candidateMap.values()].sort((a, b) => b.score - a.score);
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

    return NextResponse.json({
      featured: featuredCandidate ? await normalizeForResponse(featuredCandidate) : null,
      items: await Promise.all(balancedItems.slice(0, 4).map(normalizeForResponse)),
    });
  } catch {
    return NextResponse.json({ featured: null, items: [] }, { status: 200 });
  }
}
