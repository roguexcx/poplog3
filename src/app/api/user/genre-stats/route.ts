import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";

type GenreObj = { id: number; name: string };

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Busca os tmdb_ids e media_types do usuário
    const { data: userTitles, error: utError } = await supabaseAdmin
      .from("user_titles")
      .select("tmdb_id, media_type")
      .eq("user_id", user.id);

    if (utError || !userTitles || userTitles.length === 0) {
      return NextResponse.json({ ok: true, genres: [] });
    }

    const tmdbIds = [...new Set(userTitles.map((t) => t.tmdb_id as number))];

    // Busca os gêneros dos títulos correspondentes (service role bypassa RLS)
    const { data: titleData, error: ptError } = await supabaseAdmin
      .from("poplog3_titles")
      .select("tmdb_id, media_type, genres")
      .in("tmdb_id", tmdbIds);

    if (ptError || !titleData) {
      return NextResponse.json({ ok: true, genres: [] });
    }

    // Mapa rápido: "tmdbId_mediaType" → genres
    const titleMap = new Map<string, GenreObj[]>();
    for (const t of titleData) {
      if (!Array.isArray(t.genres)) continue;
      titleMap.set(`${t.tmdb_id}_${t.media_type}`, t.genres as GenreObj[]);
    }

    // Conta gêneros ponderado pelos títulos do usuário
    const genreCount: Record<string, number> = {};
    for (const ut of userTitles) {
      const genres = titleMap.get(`${ut.tmdb_id}_${ut.media_type}`);
      if (!genres) continue;
      for (const g of genres) {
        const name = typeof g === "object" && g !== null ? g.name : null;
        if (name && typeof name === "string") {
          genreCount[name] = (genreCount[name] ?? 0) + 1;
        }
      }
    }

    const sorted = Object.entries(genreCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8);

    const maxCount = sorted[0]?.[1] ?? 1;
    const genres = sorted.map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / maxCount) * 100),
    }));

    return NextResponse.json({ ok: true, genres });
  } catch (error) {
    console.error("[GENRE_STATS_ERROR]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
