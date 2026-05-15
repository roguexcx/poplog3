import { NextRequest, NextResponse } from "next/server";

import { syncTmdbTitle } from "@/server/sync/sync-tmdb-title";

type MediaType = "movie" | "tv";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      mediaType: string;
      id: string;
    }>;
  }
) {
  const resolvedParams = await params;

  const mediaType = resolvedParams.mediaType as MediaType;
  const id = Number(resolvedParams.id);

  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("force") === "1";

  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      { ok: false, error: "Invalid media type" },
      { status: 400 }
    );
  }

  if (!id || Number.isNaN(id)) {
    return NextResponse.json(
      { ok: false, error: "Invalid TMDB id" },
      { status: 400 }
    );
  }

  try {
    const syncedTitle = await syncTmdbTitle(mediaType, id, {
      force: refresh,
    });

    return NextResponse.json({
      ok: true,
      source: syncedTitle.source,
      cache_status: syncedTitle.cache_status,
      refreshed: refresh,
      result: syncedTitle.title,
    });
  } catch (error) {
    console.error("[title route]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch title",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}