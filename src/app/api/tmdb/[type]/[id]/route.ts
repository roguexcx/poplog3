// src/app/api/tmdb/[type]/[id]/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

type RouteContext = {
  params: Promise<{
    type: string;
    id: string;
  }>;
};

export async function GET(_request: Request, context: RouteContext) {
  const { type, id } = await context.params;

  if (type !== "movie" && type !== "tv") {
    return NextResponse.json({ error: "Tipo inválido" }, { status: 400 });
  }

  try {
    const data = await tmdbFetch(`/${type}/${id}`, {}, 60 * 60);
    return NextResponse.json(data);
  } catch (error) {
    console.error("Erro ao buscar detalhes TMDB:", error);

    return NextResponse.json(
      { error: "Erro ao buscar detalhes" },
      { status: 500 }
    );
  }
}