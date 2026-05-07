// src/app/api/user/titles/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";

type RawTitle = {
  id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: string | null;
  favorite?: boolean;
  created_at?: string;
};

export async function POST(request: Request) {
  try {
    const { titles } = await request.json();

    if (!Array.isArray(titles)) {
      return NextResponse.json({ titles: [] });
    }

    const enrichedTitles = await Promise.all(
      titles.map(async (title: RawTitle) => {
        const mediaType = title.media_type === "tv" ? "tv" : "movie";

        try {
          const tmdb = await tmdbFetch(`/${mediaType}/${title.tmdb_id}`, {
            append_to_response: "images",
          });

          return { ...title, tmdb };
        } catch {
          return { ...title, tmdb: null };
        }
      }),
    );

    return NextResponse.json({ titles: enrichedTitles });
  } catch {
    return NextResponse.json({ titles: [] }, { status: 200 });
  }
}