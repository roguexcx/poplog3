import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

export async function GET() {
  try {
    const data = await tmdbFetch("/movie/popular");

    return NextResponse.json(data);
  } catch (error) {
    console.error("Erro ao buscar populares:", error);

    return NextResponse.json(
      { error: "Erro ao buscar títulos populares." },
      { status: 500 }
    );
  }
}