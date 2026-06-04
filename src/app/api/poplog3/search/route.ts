import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { upsertCachedTitle } from "@/server/cache/title-cache";
import {
  findCachedFuzzyTitles,
  normalizeSearchTerm,
  shouldUseFuzzyFallback,
} from "@/server/search/fuzzy-title-search";
import type { TmdbMediaType, TmdbTitleSummary } from "@/server/api-clients/tmdb/types";
import {
  catalogSearch,
  isBalloonerismSearchEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";

type SearchMediaType = "all" | "movie" | "tv";
const TMDB_MAX_SEARCH_PAGE = 500;

type TmdbPersonSummary = {
  id: number;
  name?: string;
  original_name?: string;
  profile_path?: string | null;
  known_for_department?: string | null;
  popularity?: number;
  media_type?: "person";
  known_for?: TmdbTitleSummary[];
};

type TmdbSearchItem = TmdbTitleSummary | TmdbPersonSummary;

type PoplogSearchPerson = {
  tmdb_id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string | null;
  popularity: number;
  known_for: ReturnType<typeof normalizeTmdbTitle>[];
  href: string;
};

function parseMediaType(value: string | null): SearchMediaType {
  if (value === "movie" || value === "tv") return value;
  return "all";
}

function parsePage(value: string | null): number {
  const page = Number(value);
  if (!Number.isFinite(page) || page < 1) return 1;
  return Math.min(Math.floor(page), TMDB_MAX_SEARCH_PAGE);
}

function parseGenre(value: string | null): number | undefined {
  if (!value) return undefined;
  const genre = Number(value);
  if (!Number.isFinite(genre)) return undefined;
  return Math.floor(genre);
}

function isPerson(item: TmdbSearchItem): item is TmdbPersonSummary {
  return item.media_type === "person";
}

function isTitle(item: TmdbSearchItem): item is TmdbTitleSummary {
  const mediaType = item.media_type;
  return mediaType === "movie" || mediaType === "tv" || !mediaType;
}

function normalizePerson(item: TmdbPersonSummary): PoplogSearchPerson | null {
  const name = item.name ?? item.original_name;
  if (!item.id || !name) return null;

  const knownFor = (item.known_for ?? [])
    .filter((knownItem) => {
      const mediaType = knownItem.media_type;
      return mediaType === "movie" || mediaType === "tv";
    })
    .map((knownItem) =>
      normalizeTmdbTitle({ ...knownItem, media_type: knownItem.media_type })
    );

  return {
    tmdb_id: item.id,
    name,
    profile_path: item.profile_path ?? null,
    known_for_department: item.known_for_department ?? null,
    popularity: item.popularity ?? 0,
    known_for: filterValidTitles(knownFor).slice(0, 4),
    href: `/pessoa/${item.id}`,
  };
}

// Maps SearchMediaType to CatalogSearch mediaType param
function toCatalogMediaType(type: SearchMediaType): "movie" | "show" | undefined {
  if (type === "movie") return "movie";
  if (type === "tv") return "show";
  return undefined;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const query = searchParams.get("q")?.trim();
  const mediaType = parseMediaType(searchParams.get("type"));
  const page = parsePage(searchParams.get("page"));
  const genre = parseGenre(searchParams.get("genre"));

  if (!query) {
    return NextResponse.json(
      { ok: false, error: "Missing search query. Use ?q=" },
      { status: 400 }
    );
  }

  try {
    // ── Balloonerismm primary path ────────────────────────────────────────────
    // Genre filter has no equivalent in Balloonerismm — use legacy for filtered queries.
    if (isBalloonerismSearchEnabled() && !genre && page === 1) {
      try {
        const catalogResults = await catalogSearch({
          query,
          mediaType: toCatalogMediaType(mediaType),
          page: 1,
        });
        const hydrated = await hydrateCatalogResults(catalogResults);

        // Apply genre filter if present (from local DB data)
        const filtered = genre
          ? hydrated.filter((t) => (t.genres ?? []).includes(genre))
          : hydrated;

        const validTitles = filterValidTitles(filtered);

        if (validTitles.length > 0) {
          const seenKeys = new Set(
            validTitles.map((t) => `${t.media_type}-${t.tmdb_id}`)
          );
          const fuzzyTitles = shouldUseFuzzyFallback(validTitles.length, page)
            ? await findCachedFuzzyTitles({ query, mediaType, genre, excludeKeys: seenKeys })
            : [];
          const results = [...validTitles, ...fuzzyTitles];

          console.log(
            `[poplog3/search] source=balloonerismm count=${validTitles.length} fuzzy=${fuzzyTitles.length}`
          );

          return NextResponse.json({
            ok: true,
            query,
            normalizedQuery: normalizeSearchTerm(query),
            type: mediaType,
            genre,
            page: 1,
            totalPages: 1,
            totalResults: results.length,
            count: results.length,
            fuzzyCount: fuzzyTitles.length,
            peopleCount: 0,
            results,
            people: [],
          });
        }

        console.log("[poplog3/search] source=balloonerismm_fallback reason=empty");
      } catch (err) {
        console.warn(
          "[poplog3/search] source=balloonerismm_fallback reason=error",
          err instanceof Error ? err.message : err
        );
      }
    }

    // ── Legacy TMDB path (fallback) ──────────────────────────────────────────
    const endpoint =
      mediaType === "all" ? "/search/multi" : `/search/${mediaType}`;

    const data = await tmdbFetch<{
      page: number;
      total_pages: number;
      total_results: number;
      results: TmdbSearchItem[];
    }>(endpoint, { params: { query, include_adult: false, page } });

    const rawPeople = mediaType === "all" ? data.results.filter(isPerson) : [];
    const people = rawPeople
      .map(normalizePerson)
      .filter((person): person is PoplogSearchPerson => Boolean(person))
      .sort((a, b) => b.popularity - a.popularity)
      .slice(0, 8);

    const rawTitles = data.results.filter((item) => {
      if (!isTitle(item)) return false;
      const itemMediaType = item.media_type ?? mediaType;
      if (itemMediaType !== "movie" && itemMediaType !== "tv") return false;
      if (genre) {
        const genreIds = item.genre_ids ?? [];
        return genreIds.includes(genre);
      }
      return true;
    }) as TmdbTitleSummary[];

    const normalizedTitles = rawTitles.map((item) =>
      normalizeTmdbTitle({
        ...item,
        media_type: (item.media_type ?? mediaType) as TmdbMediaType,
      })
    );

    const titles = filterValidTitles(normalizedTitles);

    await Promise.all(
      titles.map(async (title) => {
        const rawTitle = rawTitles.find((item) => {
          const rawMediaType = item.media_type ?? mediaType;
          return item.id === title.tmdb_id && rawMediaType === title.media_type;
        });
        if (!rawTitle) return;
        try {
          await upsertCachedTitle(title, rawTitle);
        } catch (cacheError) {
          console.warn(
            `[poplog3/search] falha ao cachear ${title.media_type}/${title.tmdb_id}:`,
            cacheError instanceof Error ? cacheError.message : cacheError
          );
        }
      })
    );

    const seenTitleKeys = new Set(
      titles.map((title) => `${title.media_type}-${title.tmdb_id}`)
    );
    const fuzzyTitles = shouldUseFuzzyFallback(titles.length, page)
      ? await findCachedFuzzyTitles({ query, mediaType, genre, excludeKeys: seenTitleKeys })
      : [];
    const results = [...titles, ...fuzzyTitles];

    return NextResponse.json({
      ok: true,
      query,
      normalizedQuery: normalizeSearchTerm(query),
      type: mediaType,
      genre,
      page: data.page ?? page,
      totalPages: data.total_pages ?? 1,
      totalResults: Math.max(data.total_results ?? 0, results.length + people.length),
      count: results.length,
      fuzzyCount: fuzzyTitles.length,
      peopleCount: people.length,
      results,
      people,
    });
  } catch (error) {
    console.error("[poplog3/search]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to search titles",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
