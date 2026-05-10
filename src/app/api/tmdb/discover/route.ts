// src/app/api/tmdb/discover/route.ts
// Endpoint para descoberta de títulos por gênero usando a TMDB Discover API.
//
// Query params:
//   genre  = TMDB genre_id (obrigatório)
//   media  = "movie" | "tv"  (padrão: "movie")
//   page   = número da página (padrão: 1)

import { type NextRequest, NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import type { TMDBItem, TMDBResponse } from "@/types/tmdb";

const CACHE_HEADERS = {
  "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const genre = searchParams.get("genre");
  const media = searchParams.get("media") ?? "movie";
  const page  = searchParams.get("page") ?? "1";

  if (!genre) {
    return NextResponse.json(
      { error: "Parâmetro 'genre' obrigatório." },
      { status: 400 },
    );
  }

  if (media !== "movie" && media !== "tv") {
    return NextResponse.json(
      { error: "Parâmetro 'media' deve ser 'movie' ou 'tv'." },
      { status: 400 },
    );
  }

  try {
    const data = await tmdbFetch<TMDBResponse<TMDBItem>>(
      `/discover/${media}`,
      {
        with_genres: genre,
        sort_by:     "popularity.desc",
        page,
        language:    "pt-BR",
        region:      "BR",
      },
    );

    const results = (data.results ?? []).map((item) => ({
      ...item,
      media_type: media as "movie" | "tv",
    }));

    return NextResponse.json(
      {
        results,
        page:          data.page,
        total_pages:   data.total_pages,
        total_results: data.total_results,
      },
      { headers: CACHE_HEADERS },
    );
  } catch (error) {
    console.error(`Erro em /api/tmdb/discover?genre=${genre}&media=${media}:`, error);
    return NextResponse.json(
      { error: "Erro ao buscar títulos por gênero.", results: [] },
      { status: 500 },
    );
  }
}
