import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

export async function GET() {
  try {
    const data = await tmdbFetch("/movie/upcoming");

    return NextResponse.json(data);
  } catch (error) {
    console.error("Erro ao buscar próximos lançamentos:", error);

    return NextResponse.json(
      { error: "Erro ao buscar próximos lançamentos." },
      { status: 500 }
    );
  }
}