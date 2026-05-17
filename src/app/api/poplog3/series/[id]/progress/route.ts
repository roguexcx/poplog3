import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { computeUserSeriesProgress } from "@/server/episodes/episode-progress-service";
import { readTitleState } from "@/server/state/user-title-state";

export async function GET(
  _request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ id: string }>;
  }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  const resolved = await params;
  const seriesId = Number(resolved.id);
  if (!seriesId || Number.isNaN(seriesId)) {
    return NextResponse.json(
      { ok: false, error: "Invalid series id" },
      { status: 400 }
    );
  }

  try {
    // Fast path: lê do estado materializado (1 query).
    const state = await readTitleState(user.id, seriesId, "tv");

    if (state) {
      return NextResponse.json({
        ok: true,
        progress: {
          seriesTmdbId: seriesId,
          watchedCount: state.watched_episodes,
          totalEpisodes: state.total_episodes,
          airedEpisodes: state.aired_episodes,
          lastWatchedAt: state.last_watched_at,
          watchedKeys: state.watched_keys,
          nextEpisode:
            state.next_season !== null && state.next_episode !== null
              ? { seasonNumber: state.next_season, episodeNumber: state.next_episode, airDate: state.next_episode_air_date }
              : null,
        },
      });
    }

    // Fallback: recalcula das tabelas fonte (usuário pré-migração).
    const progress = await computeUserSeriesProgress(user.id, seriesId);
    return NextResponse.json({ ok: true, progress });
  } catch (err) {
    console.error("[poplog3/series/progress] erro:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Erro inesperado",
      },
      { status: 500 }
    );
  }
}
