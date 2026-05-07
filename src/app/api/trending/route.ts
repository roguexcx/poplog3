// src/app/api/trending/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import type { TMDBItem, TMDBResponse } from "@/lib/tmdb-types";

interface TVDetails {
  number_of_seasons: number;
  last_air_date: string | null;
}

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

export async function GET() {
  try {
    const data = await tmdbFetch<TMDBResponse<TMDBItem>>("/trending/all/week", { page: 1 });

    const results = (data.results ?? []).filter(
      (item) => item.media_type === "movie" || item.media_type === "tv",
    );

    // Enriquece séries com temporada atual e último ano — em paralelo
    const enriched = await Promise.all(
      results.map((item) => (item.media_type === "tv" ? enrichTV(item) : item)),
    );

    return NextResponse.json({ results: enriched });
  } catch (error) {
    console.error("Erro em /api/trending:", error);
    return NextResponse.json({ error: "Erro ao carregar tendências.", results: [] }, { status: 500 });
  }
}