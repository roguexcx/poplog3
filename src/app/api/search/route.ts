// src/app/api/search/route.ts

import { NextResponse } from "next/server";
import {
  getRandomTitleImagePath,
  LOCALIZED_POSTER_RANDOMIZATION_LANGUAGES,
  RANDOMIZATION_ENABLED,
} from "@/lib/images";

// ─── Tipo local (específico desta rota, não vale exportar para tmdb-types) ────

type TMDBSearchItem = {
  id: number;
  media_type: "movie" | "tv" | string;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  release_date?: string;
  first_air_date?: string;
};

// ─── TMDB fetch local (precisa de include_adult e page, fora do tmdbFetch padrão) ─

const TMDB_BASE_URL = "https://api.themoviedb.org/3";

async function searchTMDB(query: string, language: "pt-BR" | "en-US"): Promise<TMDBSearchItem[]> {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) throw new Error("TMDB_API_KEY não configurada");

  const url = new URL(`${TMDB_BASE_URL}/search/multi`);
  url.searchParams.set("api_key", apiKey);
  url.searchParams.set("query", query);
  url.searchParams.set("language", language);
  url.searchParams.set("include_adult", "false");
  url.searchParams.set("page", "1");

  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`Erro TMDB: ${res.status}`);

  const data = await res.json();
  return (data.results ?? []) as TMDBSearchItem[];
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function normalizeText(value?: string): string {
  return (
    value
      ?.toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim() ?? ""
  );
}

function getYear(item: TMDBSearchItem): number {
  const date = item.release_date ?? item.first_air_date;
  const year = date?.slice(0, 4);
  return year ? Number(year) : 0;
}

function getTitleScore(item: TMDBSearchItem, query: string): number {
  const q = normalizeText(query);
  if (!q) return 0;

  const titles = [item.title, item.name, item.original_title, item.original_name]
    .map(normalizeText)
    .filter(Boolean);

  if (titles.some((t) => t === q)) return 120;
  if (titles.some((t) => t.startsWith(q))) return 100;
  if (titles.some((t) => t.includes(q))) return 70;
  return 0;
}

function getResultScore(item: TMDBSearchItem, query: string): number {
  const year = getYear(item);
  return (
    getTitleScore(item, query) +
    Math.min(item.popularity ?? 0, 100) +
    Math.min((item.vote_count ?? 0) / 100, 80) +
    (item.poster_path ? 12 : 0) +
    (item.backdrop_path ? 8 : 0) +
    (year >= 2010 ? Math.min((year - 2010) * 1.5, 30) : 0)
  );
}

// ─── Merge de resultados pt-BR + en-US ────────────────────────────────────────

function mergeResults(items: TMDBSearchItem[]): TMDBSearchItem[] {
  const map = new Map<string, TMDBSearchItem>();

  for (const item of items) {
    const key = `${item.media_type}-${item.id}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, item);
      continue;
    }

    map.set(key, {
      ...existing,
      ...item,
      title: existing.title ?? item.title,
      name: existing.name ?? item.name,
      original_title: existing.original_title ?? item.original_title,
      original_name: existing.original_name ?? item.original_name,
      poster_path: existing.poster_path ?? item.poster_path,
      backdrop_path: existing.backdrop_path ?? item.backdrop_path,
      popularity: Math.max(existing.popularity ?? 0, item.popularity ?? 0),
      vote_count: Math.max(existing.vote_count ?? 0, item.vote_count ?? 0),
    });
  }

  return Array.from(map.values());
}

// ─── Handler ──────────────────────────────────────────────────────────────────

async function withLocalizedPoster(item: TMDBSearchItem): Promise<TMDBSearchItem | null> {
  if (item.media_type !== "movie" && item.media_type !== "tv") return null;
  if (!RANDOMIZATION_ENABLED) return item.poster_path ? item : null;

  const posterPath = await getRandomTitleImagePath(item.media_type, item.id, "poster", {
    languages: LOCALIZED_POSTER_RANDOMIZATION_LANGUAGES,
  });

  return posterPath ? { ...item, poster_path: posterPath } : null;
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("query")?.trim();

  if (!query) return NextResponse.json({ results: [] });

  try {
    const [ptResults, enResults] = await Promise.all([
      searchTMDB(query, "pt-BR"),
      searchTMDB(query, "en-US"),
    ]);

    const ranked = mergeResults([...ptResults, ...enResults])
      .filter((item) => item.media_type === "movie" || item.media_type === "tv")
      .filter((item) => item.poster_path)
      .sort((a, b) => getResultScore(b, query) - getResultScore(a, query))
      .slice(0, 24);

    const results = (await Promise.all(ranked.map(withLocalizedPoster)))
      .filter((item): item is TMDBSearchItem => item !== null)
      .slice(0, 12);

    return NextResponse.json({ results });
  } catch (error) {
    console.error("Erro na busca:", error);
    return NextResponse.json({ error: "Erro ao buscar no TMDB", results: [] }, { status: 500 });
  }
}
