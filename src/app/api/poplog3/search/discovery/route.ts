import { NextResponse } from "next/server";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { upsertCachedTitle } from "@/server/cache/title-cache";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";

type TmdbListResponse = {
  page: number;
  total_pages: number;
  total_results: number;
  results: TmdbTitleSummary[];
};

type TmdbGenre = {
  id: number;
  name: string;
};

type TmdbGenresResponse = {
  genres: TmdbGenre[];
};

type DiscoveryTitle = ReturnType<typeof normalizeTmdbTitle>;

type DiscoveryPayload = {
  ok: true;
  trending: DiscoveryTitle[];
  popularMovies: DiscoveryTitle[];
  popularSeries: DiscoveryTitle[];
  genres: TmdbGenre[];
};

type DiscoveryCachePayload = {
  response: DiscoveryPayload;
  generatedAt: string;
};

type TitleCacheEntry = {
  title: DiscoveryTitle;
  rawTitle: TmdbTitleSummary;
};

const DISCOVERY_CACHE_TTL_MS = 30 * 60_000;
const DISCOVERY_SECTION_KEY = "search_discovery";
const DEFAULT_REGION = "BR";
const DEFAULT_LANGUAGE = "pt-BR";

let refreshPromise: Promise<void> | null = null;

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

function cacheTitlesInBackground(entries: TitleCacheEntry[]) {
  if (entries.length === 0) return;

  void Promise.all(
    entries.map(async ({ title, rawTitle }) => {
      try {
        await upsertCachedTitle(title, {
          ...rawTitle,
          media_type: rawTitle.media_type ?? title.media_type,
        });
      } catch (error) {
        console.warn(
          `[poplog3/search/discovery] falha ao cachear ${title.media_type}/${title.tmdb_id}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }),
  );
}

async function getTitleSection(
  endpoint: string,
  mediaType: "movie" | "tv",
  cacheEntries: TitleCacheEntry[],
) {
  const data = await tmdbFetch<TmdbListResponse>(endpoint, {
    params: {
      page: 1,
      include_adult: false,
    },
  });

  const normalized = data.results.map((item) =>
    normalizeTmdbTitle({
      ...item,
      media_type: item.media_type ?? mediaType,
    })
  );

  const titles = filterValidTitles(normalized).slice(0, 20);

  for (const title of titles) {
    const rawTitle = data.results.find((item) => item.id === title.tmdb_id);
    if (rawTitle) cacheEntries.push({ title, rawTitle: { ...rawTitle, media_type: rawTitle.media_type ?? mediaType } });
  }

  return titles;
}

async function getTrendingSection(cacheEntries: TitleCacheEntry[]) {
  const data = await tmdbFetch<TmdbListResponse>("/trending/all/day", {
    params: {
      page: 1,
      include_adult: false,
    },
  });

  const onlyTitles = data.results.filter(
    (item) => item.media_type === "movie" || item.media_type === "tv"
  );

  const normalized = onlyTitles.map((item) => normalizeTmdbTitle(item));
  const titles = filterValidTitles(normalized).slice(0, 20);

  for (const title of titles) {
    const rawTitle = onlyTitles.find(
      (item) =>
        item.id === title.tmdb_id && item.media_type === title.media_type,
    );
    if (rawTitle) cacheEntries.push({ title, rawTitle });
  }

  return titles;
}

async function getGenres() {
  const [movieGenres, tvGenres] = await Promise.all([
    tmdbFetch<TmdbGenresResponse>("/genre/movie/list"),
    tmdbFetch<TmdbGenresResponse>("/genre/tv/list"),
  ]);

  const merged = new Map<number, TmdbGenre>();

  for (const genre of movieGenres.genres ?? []) {
    merged.set(genre.id, genre);
  }

  for (const genre of tvGenres.genres ?? []) {
    merged.set(genre.id, genre);
  }

  return Array.from(merged.values()).slice(0, 18);
}

async function buildDiscoveryPayload(perf?: Record<string, number>, stageRef?: { value: number }) {
  const cacheEntries: TitleCacheEntry[] = [];

  const [trending, popularMovies, popularSeries, genres] =
    await Promise.all([
      getTrendingSection(cacheEntries),
      getTitleSection("/movie/popular", "movie", cacheEntries),
      getTitleSection("/tv/popular", "tv", cacheEntries),
      getGenres(),
    ]);
  if (perf && stageRef) markStage(perf, stageRef, "tmdb_fetch");

  cacheTitlesInBackground(cacheEntries);
  if (perf && stageRef) markStage(perf, stageRef, "normalization");

  return {
    ok: true,
    trending,
    popularMovies,
    popularSeries,
    genres,
  } satisfies DiscoveryPayload;
}

function refreshCacheInBackground(region: string, language: string) {
  if (refreshPromise) return;

  refreshPromise = (async () => {
    try {
      const response = await buildDiscoveryPayload();
      await writeContinuitySectionCache({
        sectionKey: DISCOVERY_SECTION_KEY,
        region,
        language,
        ttlMs: DISCOVERY_CACHE_TTL_MS,
        payload: {
          response,
          generatedAt: new Date().toISOString(),
        } satisfies DiscoveryCachePayload,
      });
    } finally {
      refreshPromise = null;
    }
  })();
}

export async function GET(request: Request) {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  const stageRef = { value: totalStartedAt };

  try {
    const url = new URL(request.url);
    const region = url.searchParams.get("region") ?? DEFAULT_REGION;
    const language = url.searchParams.get("language") ?? DEFAULT_LANGUAGE;
    markStage(perf, stageRef, "request_parse");

    const cached = await readContinuitySectionCache<DiscoveryCachePayload>(
      DISCOVERY_SECTION_KEY,
      { region, language },
    );
    markStage(perf, stageRef, "cache_read");

    if (cached?.status === "hit") {
      console.log("[poplog3/search/discovery/perf]", {
        cacheStatus: "persistent_hit",
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({ ...cached.payload.response, cacheStatus: "persistent_hit" });
    }

    if (cached?.status === "stale") {
      refreshCacheInBackground(region, language);
      console.log("[poplog3/search/discovery/perf]", {
        cacheStatus: "persistent_stale",
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({ ...cached.payload.response, cacheStatus: "persistent_stale" });
    }

    const response = await buildDiscoveryPayload(perf, stageRef);
    markStage(perf, stageRef, "response_build");

    await writeContinuitySectionCache({
      sectionKey: DISCOVERY_SECTION_KEY,
      region,
      language,
      ttlMs: DISCOVERY_CACHE_TTL_MS,
      payload: {
        response,
        generatedAt: new Date().toISOString(),
      } satisfies DiscoveryCachePayload,
    });
    markStage(perf, stageRef, "cache_write");

    console.log("[poplog3/search/discovery/perf]", {
      cacheStatus: "persistent_miss",
      trending: response.trending.length,
      popularMovies: response.popularMovies.length,
      popularSeries: response.popularSeries.length,
      genres: response.genres.length,
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json({ ...response, cacheStatus: "persistent_miss" });
  } catch (error) {
    console.error("[poplog3/search/discovery]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load search discovery data",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
