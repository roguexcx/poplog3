// src/app/api/user/titles/route.ts

import { NextResponse } from "next/server";
import { tmdbFetch } from "@/lib/tmdb";
import type { UserTitleInput, TmdbEnrichedTitle } from "@/types/api-contracts";

export async function POST(request: Request) {
  try {
    const { titles } = await request.json();

    if (!Array.isArray(titles)) {
      return NextResponse.json({ titles: [] });
    }

    const enrichedTitles = await Promise.all(
      titles.map(async (title: UserTitleInput): Promise<TmdbEnrichedTitle> => {
        const mediaType = title.media_type === "tv" ? "tv" : "movie";

        try {
          const appendTo = mediaType === "tv" ? "genres,seasons" : "genres";
          const tmdb = await tmdbFetch(`/${mediaType}/${title.tmdb_id}`, {
            append_to_response: appendTo,
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