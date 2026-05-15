import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";

type MediaType = "movie" | "tv";

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mediaType =
    (searchParams.get("mediaType") as MediaType) || "movie";

  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      {
        ok: false,
        error: "Invalid media type",
      },
      { status: 400 }
    );
  }

  try {
    const data = await tmdbFetch<{
      results: TmdbTitleSummary[];
    }>(`/discover/${mediaType}`, {
      params: {
        sort_by: "popularity.desc",
        page: 1,
      },
    });

    const titles = filterValidTitles(
      data.results.map((item) => normalizeTmdbTitle(item))
    );

    return NextResponse.json({
      ok: true,
      mediaType,
      count: titles.length,
      results: titles,
    });
  } catch (error) {
    console.error("[discover route]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch discover titles",
        details:
          error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
