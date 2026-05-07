import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

export async function GET() {
  try {
    const data = await tmdbFetch("/movie/top_rated");

    return NextResponse.json(data);
  } catch (error) {
    console.error("Erro ao buscar mais bem avaliados:", error);

    return NextResponse.json(
      { error: "Erro ao buscar títulos mais bem avaliados." },
      { status: 500 }
    );
  }
}