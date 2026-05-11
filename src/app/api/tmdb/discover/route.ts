// src/app/api/tmdb/discover/route.ts
// Endpoint para descoberta de títulos por gênero usando a TMDB Discover API.
//
// Query params:
//   genre  = TMDB genre_id (obrigatório)
//   media  = "movie" | "tv"  (padrão: "movie")
//   page   = número da página (padrão: 1)

import { type NextRequest, NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";
import {
  getRandomTitleImagePath,
  LOCALIZED_POSTER_RANDOMIZATION_LANGUAGES,
  RANDOMIZATION_ENABLED,
} from "@/lib/images";
import type { TMDBItem, TMDBResponse } from "@/types/tmdb";

const CACHE_HEADERS = {
  "Cache-Control": "s-maxage=300, stale-while-revalidate=600",
};

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const genre = searchParams.get("genre");
  const media = searchParams.get("media") ?? "movie";
  const page  = searchParams.get("page") ?? "1";
  const scoringContext = searchParams.get("context") === "oracle" ? "oracle" : "discovery";

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
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
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

    const mediaType = media as "movie" | "tv";
    const resultsWithMedia = (data.results ?? []).map((item) => ({
      ...item,
      media_type: mediaType,
    }));

    let results = (
      await Promise.all(
        resultsWithMedia.map(async (item) => {
          if (!RANDOMIZATION_ENABLED) return item.poster_path ? item : null;
          const posterPath = await getRandomTitleImagePath(mediaType, item.id, "poster", {
            languages: LOCALIZED_POSTER_RANDOMIZATION_LANGUAGES,
          });
          return posterPath ? { ...item, poster_path: posterPath } : null;
        }),
      )
    ).filter((item): item is TMDBItem & { media_type: "movie" | "tv" } => item !== null);

    if (user) {
      const feedbackMap = await getUserFeedbackMap(user.id, supabase);
      results = applyUserFeedbackScoring(results, {
        userId: user.id,
        feedbackMap,
        context: scoringContext,
        mediaType,
      });
    }

    return NextResponse.json(
      {
        results,
        page:          data.page,
        total_pages:   data.total_pages,
        total_results: data.total_results,
      },
      { headers: user ? undefined : CACHE_HEADERS },
    );
  } catch (error) {
    console.error(`Erro em /api/tmdb/discover?genre=${genre}&media=${media}:`, error);
    return NextResponse.json(
      { error: "Erro ao buscar títulos por gênero.", results: [] },
      { status: 500 },
    );
  }
}
