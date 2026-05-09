// src/app/api/keywords/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import { normalizeKeywordName } from "@/lib/title-utils";

type KeywordItem = { id: number; name: string };
type KeywordsResponse = {
  keywords?: KeywordItem[];
  results?: KeywordItem[];
};

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");

  if (!type || !id || (type !== "movie" && type !== "tv")) {
    return NextResponse.json({ keywords: [] }, { status: 400 });
  }

  try {
    const path = type === "movie" ? `/movie/${id}/keywords` : `/tv/${id}/keywords`;
    const data = await tmdbFetch<KeywordsResponse>(path);

    const raw = data.keywords ?? data.results ?? [];
    const keywords = raw
      .map((k) => normalizeKeywordName(k.name ?? ""))
      .filter(Boolean);

    return NextResponse.json({ keywords });
  } catch {
    return NextResponse.json({ keywords: [] });
  }
}
