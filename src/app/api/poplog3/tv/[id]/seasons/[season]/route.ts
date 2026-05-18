import { NextRequest, NextResponse } from "next/server";

import { withOrigin } from "@/server/engine-logger";
import { syncTmdbSeason } from "@/server/sync/sync-tmdb-season";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string; season: string }>;
  }
) {
  const resolved = await params;
  const seriesId = Number(resolved.id);
  const seasonNumber = Number(resolved.season);

  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("force") === "1";

  if (!seriesId || Number.isNaN(seriesId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid TMDB series id" },
      { status: 400 }
    );
  }
  if (Number.isNaN(seasonNumber) || seasonNumber < 0) {
    return NextResponse.json(
      { ok: false, error: "Invalid season number" },
      { status: 400 }
    );
  }

  return withOrigin("title", async () => { try {
    const result = await syncTmdbSeason(seriesId, seasonNumber, {
      force: refresh,
    });

    if (!result.season) {
      return NextResponse.json(
        { ok: false, error: "Season not found" },
        { status: 404 }
      );
    }

    const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
    const tmdbImage = (path: string | null, size: string) => {
      if (!path) return null;
      const normalized = path.startsWith("/") ? path : `/${path}`;
      return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
    };

    const payload = {
      seriesTmdbId: result.season.series_tmdb_id,
      seasonNumber: result.season.season_number,
      name: result.season.name,
      overview: result.season.overview,
      posterUrl: tmdbImage(result.season.poster_path, "w342"),
      airDate: result.season.air_date,
      episodeCount: result.season.episode_count,
      voteAverage: result.season.vote_average,
      lastSyncedAt: result.season.last_synced_at,
      episodes: result.season.episodes.map((e) => ({
        episodeNumber: e.episode_number,
        name: e.name,
        overview: e.overview,
        stillUrl: tmdbImage(e.still_path, "w300"),
        airDate: e.air_date,
        runtime: e.runtime,
        voteAverage: e.vote_average,
        voteCount: e.vote_count,
        episodeType: e.episode_type,
      })),
    };

    return NextResponse.json(payload, {
      headers: {
        "x-poplog-source": result.source,
        "x-poplog-cache": result.cache_status,
      },
    });
  } catch (error) {
    console.error("[poplog3/tv/season] erro:", error);
    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch season",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
  }); // withOrigin("title")
}
