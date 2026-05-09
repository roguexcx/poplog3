// src/app/api/tmdb/list/route.ts
// Unified TMDB list endpoint — replaces /api/popular, /api/tv-popular,
// /api/top-rated, /api/tv-top-rated, /api/trending, /api/upcoming.
//
// Query params:
//   type   = "trending" | "popular" | "top_rated" | "upcoming"
//   media  = "movie" | "tv"  (required for popular and top_rated)

import { type NextRequest, NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import type { TMDBItem, TMDBResponse } from "@/types/tmdb";

const CACHE_HEADERS = {
  "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
};

type TVDetails = {
  number_of_seasons: number;
  last_air_date: string | null;
};

async function enrichTV(item: TMDBItem): Promise<TMDBItem> {
  try {
    const details = await tmdbFetch<TVDetails>(`/tv/${item.id}`, {
      append_to_response: "",
    });
    return {
      ...item,
      number_of_seasons: details.number_of_seasons ?? null,
      last_air_date: details.last_air_date ?? null,
    };
  } catch {
    return item;
  }
}

function tmdbEndpoint(
  type: string,
  media: string | null,
): string | null {
  switch (type) {
    case "trending":
      return "/trending/all/week";
    case "popular":
      if (media === "movie") return "/movie/popular";
      if (media === "tv") return "/tv/popular";
      return null;
    case "top_rated":
      if (media === "movie") return "/movie/top_rated";
      if (media === "tv") return "/tv/top_rated";
      return null;
    case "upcoming":
      return "/movie/upcoming";
    default:
      return null;
  }
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const type = searchParams.get("type") ?? "";
  const media = searchParams.get("media");

  const endpoint = tmdbEndpoint(type, media);

  if (!endpoint) {
    return NextResponse.json(
      { error: "Parâmetros inválidos. Use type=trending|popular|top_rated|upcoming e media=movie|tv quando necessário." },
      { status: 400 },
    );
  }

  try {
    const data = await tmdbFetch<TMDBResponse<TMDBItem>>(endpoint, { page: 1 });
    let results = data.results ?? [];

    if (type === "trending") {
      results = results.filter(
        (item) => item.media_type === "movie" || item.media_type === "tv",
      );
      results = await Promise.all(
        results.map((item) => (item.media_type === "tv" ? enrichTV(item) : item)),
      );
    }

    return NextResponse.json(
      {
        results,
        page: data.page,
        total_pages: data.total_pages,
        total_results: data.total_results,
      },
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    console.error(`Erro em /api/tmdb/list?type=${type}&media=${media}:`, error);
    return NextResponse.json(
      { error: "Erro ao carregar lista.", results: [] },
      { status: 500 },
    );
  }
}
