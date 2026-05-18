import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  bulkMarkEpisodesWatched,
  clearSeasonProgress,
  clearSeriesProgress,
  computeUserSeriesProgress,
  markAllAiredEpisodes,
  markSeasonWatched,
  toggleEpisodeWatched,
} from "@/server/episodes/episode-progress-service";

function asPositiveInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n > 0) return Math.floor(n);
  }
  return null;
}

function asNonNegativeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return Math.floor(value);
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) return Math.floor(n);
  }
  return null;
}

/**
 * POST /api/poplog3/episodes
 *
 * Modos:
 *   1) Toggle individual:
 *      { seriesTmdbId, seasonNumber, episodeNumber, watched: true|false, runtimeMinutes? }
 *
 *   2) Bulk explicito:
 *      { seriesTmdbId, bulk: [{ seasonNumber, episodeNumber, runtimeMinutes? }] }
 *
 *   3) Marcar tudo que ja foi ao ar:
 *      { seriesTmdbId, markAllAired: true }
 *
 *   4) Limpar progresso:
 *      { seriesTmdbId, clear: true }
 */
export async function POST(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { ok: false, error: "Unauthorized" },
      { status: 401 }
    );
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, error: "Invalid JSON" },
      { status: 400 }
    );
  }

  const seriesTmdbId = asPositiveInteger(body.seriesTmdbId);
  if (!seriesTmdbId) {
    return NextResponse.json(
      { ok: false, error: "seriesTmdbId obrigatorio" },
      { status: 400 }
    );
  }

  try {
    if (body.clear === true) {
      await clearSeriesProgress(user.id, seriesTmdbId);
      const progress = await computeUserSeriesProgress(user.id, seriesTmdbId);
      return NextResponse.json({ ok: true, progress });
    }

    if (body.markSeason !== undefined) {
      const seasonNumber = asPositiveInteger(body.markSeason);
      if (seasonNumber === null) {
        return NextResponse.json(
          { ok: false, error: "markSeason invalido" },
          { status: 400 }
        );
      }
      const progress = await markSeasonWatched(user.id, seriesTmdbId, seasonNumber);
      return NextResponse.json({ ok: true, progress });
    }

    if (body.clearSeason !== undefined) {
      const seasonNumber = asPositiveInteger(body.clearSeason);
      if (seasonNumber === null) {
        return NextResponse.json(
          { ok: false, error: "clearSeason invalido" },
          { status: 400 }
        );
      }
      const progress = await clearSeasonProgress(user.id, seriesTmdbId, seasonNumber);
      return NextResponse.json({ ok: true, progress });
    }

    if (body.markAllAired === true) {
      const progress = await markAllAiredEpisodes(user.id, seriesTmdbId);
      return NextResponse.json({ ok: true, progress });
    }

    if (Array.isArray(body.bulk)) {
      const episodes = (body.bulk as Array<Record<string, unknown>>)
        .map((b) => {
          const s = asNonNegativeInteger(b.seasonNumber);
          const e = asPositiveInteger(b.episodeNumber);
          if (s === null || e === null) return null;
          const rt =
            typeof b.runtimeMinutes === "number" &&
            Number.isFinite(b.runtimeMinutes)
              ? Math.floor(b.runtimeMinutes)
              : null;
          return { seasonNumber: s, episodeNumber: e, runtimeMinutes: rt };
        })
        .filter(Boolean) as Array<{
        seasonNumber: number;
        episodeNumber: number;
        runtimeMinutes: number | null;
      }>;

      const progress = await bulkMarkEpisodesWatched({
        userId: user.id,
        seriesTmdbId,
        episodes,
      });
      return NextResponse.json({ ok: true, progress });
    }

    const seasonNumber = asNonNegativeInteger(body.seasonNumber);
    const episodeNumber = asPositiveInteger(body.episodeNumber);
    if (seasonNumber === null || episodeNumber === null) {
      return NextResponse.json(
        { ok: false, error: "seasonNumber/episodeNumber obrigatorios" },
        { status: 400 }
      );
    }

    const watched = body.watched === true;
    const runtimeMinutes =
      typeof body.runtimeMinutes === "number" &&
      Number.isFinite(body.runtimeMinutes)
        ? Math.floor(body.runtimeMinutes)
        : null;

    const progress = await toggleEpisodeWatched({
      userId: user.id,
      seriesTmdbId,
      seasonNumber,
      episodeNumber,
      watched,
      runtimeMinutes,
    });

    return NextResponse.json({ ok: true, progress });
  } catch (err) {
    console.error("[poplog3/episodes] erro:", err);
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Erro inesperado",
      },
      { status: 500 }
    );
  }
}
