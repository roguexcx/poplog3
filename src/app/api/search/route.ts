import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { upsertCachedTitle } from "@/server/cache/title-cache";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const query = searchParams.get("q")?.trim();

  if (!query) {
    return NextResponse.json(
      {
        ok: false,
        error: "Missing search query. Use ?q=",
      },
      { status: 400 }
    );
  }

  try {
    const data = await tmdbFetch<{
      results: TmdbTitleSummary[];
    }>("/search/multi", {
      params: {
        query,
        include_adult: false,
        page: 1,
      },
    });

    const rawResults = data.results.filter(
      (item) => item.media_type === "movie" || item.media_type === "tv"
    );

    const titles = filterValidTitles(
      rawResults.map((item) => normalizeTmdbTitle(item))
    );

    // Cache é best-effort no search — não queremos quebrar o resultado da
    // busca se uma persistência específica falhar.
    Promise.all(
      titles.map(async (title, index) => {
        try {
          await upsertCachedTitle(title, rawResults[index]);
        } catch (cacheError) {
          console.warn(
            `[poplog3/search] falha ao cachear ${title.media_type}/${title.tmdb_id}:`,
            cacheError instanceof Error ? cacheError.message : cacheError
          );
        }
      })
    ).catch(() => {/* silent */});

    return NextResponse.json({
      ok: true,
      query,
      count: rawResults.length,
      results: rawResults,
    });
  } catch (error) {
    console.error("[poplog3/search]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to search TMDB",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
