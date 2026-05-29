// ── /api/ics/enrich ────────────────────────────────────────────────────────────
// Recebe um array de chaves de série (rawTitle) e retorna enriquecimento TMDB
// para cada uma. Usado pelo cliente para enriquecimento progressivo em batches.
//
// POST body: { titles: string[], trendingDay?: number[], trendingWeek?: number[] }
// Response:  { results: Record<string, TmdbEnrichment | null> }
// ──────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import type { TmdbEnrichment, TmdbNetwork, TmdbProductionCompany, ContentCategory } from "@/lib/ics-engine";
import { refineCategoryFromTmdb, classifyTitle } from "@/lib/ics-engine";
import { buildTmdbUrl, buildTmdbHeaders, getTmdbToken } from "@/server/api-clients/tmdb/client";

const MIN_INTERVAL = Math.ceil(1000 / 15); // 15 req/s
const RETRY_PAUSE  = 5000;
const MAX_TITLES   = 20;

const GENRE_NAMES: Record<number, string> = {
  10759: "Ação & Aventura", 16: "Animação", 35: "Comédia", 80: "Crime",
  99: "Documentário", 18: "Drama", 10751: "Família", 10762: "Kids",
  9648: "Mistério", 10763: "Notícias", 10764: "Reality", 10765: "Ficção Científica",
  10766: "Soap", 10767: "Talk", 10768: "Guerra & Política", 37: "Faroeste",
};

let lastAt = 0;
async function throttled(url: string, retries = 2): Promise<Response | null> {
  const now = Date.now();
  const wait = MIN_INTERVAL - (now - lastAt);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastAt = Date.now();

  const res = await fetch(url, {
    headers: buildTmdbHeaders(),
    cache: "no-store",
  });

  if ((res.status === 429 || res.status >= 500) && retries > 0) {
    await new Promise((r) => setTimeout(r, RETRY_PAUSE));
    return throttled(url, retries - 1);
  }

  return res.ok ? res : null;
}

interface TmdbTvDetails {
  type?: string | null;
  status?: string | null;
  vote_count?: number;
  number_of_seasons?: number | null;
  networks?: TmdbNetwork[];
  production_companies?: TmdbProductionCompany[];
}

async function fetchTvDetails(tmdbId: number): Promise<TmdbTvDetails | null> {
  const res = await throttled(buildTmdbUrl(`/tv/${tmdbId}`));
  if (!res) return null;
  try {
    return await res.json() as TmdbTvDetails;
  } catch { return null; }
}

async function fetchCleanBackdrop(tmdbId: number): Promise<string | null> {
  const res = await throttled(
    buildTmdbUrl(`/tv/${tmdbId}/images`, { include_image_language: "null,xx" }),
  );
  if (!res) return null;
  try {
    const data = await res.json() as { backdrops?: Array<{ file_path: string; vote_average: number }> };
    const backdrops = data.backdrops ?? [];
    if (!backdrops.length) return null;
    return backdrops.sort((a, b) => b.vote_average - a.vote_average)[0].file_path;
  } catch { return null; }
}

async function searchTv(title: string): Promise<TmdbEnrichment | null> {
  const url = buildTmdbUrl("/search/tv", { query: title, page: "1" });
  const res = await throttled(url);
  if (!res) return null;

  const data = await res.json() as { results?: Array<{
    id: number; name: string; original_name: string; overview: string | null;
    poster_path: string | null; backdrop_path: string | null;
    genre_ids: number[]; popularity: number; vote_average: number; vote_count?: number;
    origin_country: string[]; original_language: string; first_air_date: string | null;
  }> };

  if (!data.results?.length) return null;

  const cleaned = title.toLowerCase().trim();
  const preferAnimation = classifyTitle(title) === "ANIMATION";

  let hit = data.results.find(
    (r) => r.name?.toLowerCase() === cleaned || r.original_name?.toLowerCase() === cleaned,
  ) ?? data.results[0];

  // Se o título é classificado como animação, preferir resultado animado (genre_id=16 ou lang=ja)
  if (preferAnimation) {
    const animExact = data.results.find(
      (r) =>
        (r.name?.toLowerCase() === cleaned || r.original_name?.toLowerCase() === cleaned) &&
        (r.genre_ids?.includes(16) || r.original_language === "ja"),
    );
    const animAny = data.results.find(
      (r) => r.genre_ids?.includes(16) || r.original_language === "ja",
    );
    hit = animExact ?? animAny ?? hit;
  }

  const [details, cleanBackdrop] = await Promise.all([
    fetchTvDetails(hit.id),
    fetchCleanBackdrop(hit.id),
  ]);
  const tmdb_type = details?.type ?? null;
  const localCat: ContentCategory = preferAnimation ? "ANIMATION" : "SERIES";
  const refined: ContentCategory = refineCategoryFromTmdb(localCat, hit.genre_ids ?? [], tmdb_type);

  return {
    tmdb_id:            hit.id,
    name:               hit.name,
    original_name:      hit.original_name,
    overview:           hit.overview,
    poster_path:        hit.poster_path,
    backdrop_path:      hit.backdrop_path,
    clean_backdrop_path: cleanBackdrop ?? null,
    genre_ids:          hit.genre_ids ?? [],
    genres:             (hit.genre_ids ?? []).map((id) => GENRE_NAMES[id]).filter(Boolean),
    popularity:         hit.popularity ?? 0,
    vote_average:       hit.vote_average ?? 0,
    vote_count:         details?.vote_count ?? hit.vote_count ?? 0,
    number_of_seasons:  details?.number_of_seasons ?? null,
    origin_country:     hit.origin_country ?? [],
    original_language:  hit.original_language ?? "",
    first_air_date:     hit.first_air_date ?? null,
    status:             details?.status ?? null,
    networks:              details?.networks ?? [],
    production_companies:  details?.production_companies ?? [],
    tmdb_type,
    refined_category:      refined,
  };
}

export async function POST(req: NextRequest) {
  try {
    getTmdbToken(); // validates token is present
  } catch {
    return NextResponse.json({ error: "TMDB not configured" }, { status: 503 });
  }

  let body: { titles?: unknown };
  try {
    body = await req.json() as { titles?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const titles = Array.isArray(body.titles)
    ? (body.titles as unknown[]).filter((t): t is string => typeof t === "string").slice(0, MAX_TITLES)
    : [];

  if (titles.length === 0) {
    return NextResponse.json({ results: {} });
  }

  const results: Record<string, TmdbEnrichment | null> = {};

  await Promise.allSettled(
    titles.map(async (title) => {
      try {
        results[title] = await searchTv(title);
      } catch {
        results[title] = null;
      }
    }),
  );

  return NextResponse.json({ results });
}
