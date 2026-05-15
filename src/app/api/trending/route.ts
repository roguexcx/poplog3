import { NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";

export async function GET() {
  try {
    const data = await tmdbFetch<{
      results: TmdbTitleSummary[];
    }>("/trending/all/week", {
      params: {
        page: 1,
      },
    });

    const titles = filterValidTitles(
      data.results.map((item) => normalizeTmdbTitle(item))
    );

    return NextResponse.json({
      ok: true,
      count: titles.length,
      results: titles,
    });
  } catch (error) {
    console.error("[trending route]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch trending titles",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
