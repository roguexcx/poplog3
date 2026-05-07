import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import type { TMDBItem, TMDBResponse } from "@/lib/tmdb-types";

export async function GET() {
  try {
    const data = await tmdbFetch<TMDBResponse<TMDBItem>>("/tv/popular");

    return NextResponse.json(data);
  } catch (error) {
    console.error("Erro ao buscar séries populares:", error);

    return NextResponse.json(
      { error: "Erro ao buscar séries populares." },
      { status: 500 }
    );
  }
}