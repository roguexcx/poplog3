import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  bulkMarkEpisodesWatched,
  clearSeasonProgress,
  clearSeriesProgress,
  computeUserSeriesProgress,
  markAllAiredEpisodes,
  markEpisodesUntil,
  markSeasonWatched,
  toggleEpisodeWatched,
} from "@/server/episodes/episode-progress-service";
import { resolveUserStateIdentity } from "@/server/user-state/poplog-user-state-identity";

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

/** Accepts positive real IDs and negative synthetic IDs (from imdbId). */
function asNonZeroInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value !== 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n) && n !== 0) return Math.floor(n);
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
 *   2) Bulk explícito:
 *      { seriesTmdbId, bulk: [{ seasonNumber, episodeNumber, runtimeMinutes? }] }
 *
 *   3) Marcar tudo que já foi ao ar:
 *      { seriesTmdbId, markAllAired: true }
 *
 *   4) Marcar até um episódio específico:
 *      { seriesTmdbId, markUntil: { seasonNumber, episodeNumber } }
 *
 *   5) Marcar temporada:
 *      { seriesTmdbId, markSeason: seasonNumber }
 *
 *   6) Limpar temporada:
 *      { seriesTmdbId, clearSeason: seasonNumber }
 *
 *   7) Limpar progresso da série:
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

  const legacySeriesTmdbId = asNonZeroInteger(body.seriesTmdbId);
  const identity = await resolveUserStateIdentity({
    mediaType: "tv",
    poplogId: body.poplogId,
    tmdbId: body.seriesTmdbId,
    imdbId: body.imdbId,
    slug: body.slug,
    title: body.title,
    year: body.releaseYear,
  }).catch(() => null);
  const seriesTmdbId = identity?.tmdbId ?? legacySeriesTmdbId;

  if (!seriesTmdbId) {
    return NextResponse.json(
      { ok: false, error: "seriesTmdbId, poplogId ou imdbId obrigatorio" },
      { status: 400 }
    );
  }

  try {
    if (body.clear === true) {
      await clearSeriesProgress(user.id, seriesTmdbId);

      const progress = await computeUserSeriesProgress(
        user.id,
        seriesTmdbId
      );

      return NextResponse.json({ ok: true, progress });
    }

    if (body.markUntil && typeof body.markUntil === "object") {
      const payload = body.markUntil as Record<string, unknown>;

      const seasonNumber = asNonNegativeInteger(payload.seasonNumber);
      const episodeNumber = asPositiveInteger(payload.episodeNumber);

      if (seasonNumber === null || episodeNumber === null) {
        return NextResponse.json(
          { ok: false, error: "markUntil invalido" },
          { status: 400 }
        );
      }

      const progress = await markEpisodesUntil({
        userId: user.id,
        seriesTmdbId,
        seasonNumber,
        episodeNumber,
      });

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

      const progress = await markSeasonWatched(
        user.id,
        seriesTmdbId,
        seasonNumber
      );

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

      const progress = await clearSeasonProgress(
        user.id,
        seriesTmdbId,
        seasonNumber
      );

      return NextResponse.json({ ok: true, progress });
    }

    if (body.markAllAired === true) {
      const progress = await markAllAiredEpisodes(user.id, seriesTmdbId);

      return NextResponse.json({ ok: true, progress });
    }

    if (Array.isArray(body.bulk)) {
      const episodes = (body.bulk as Array<Record<string, unknown>>)
        .map((b) => {
          const seasonNumber = asNonNegativeInteger(b.seasonNumber);
          const episodeNumber = asPositiveInteger(b.episodeNumber);

          if (seasonNumber === null || episodeNumber === null) {
            return null;
          }

          const runtimeMinutes =
            typeof b.runtimeMinutes === "number" &&
            Number.isFinite(b.runtimeMinutes)
              ? Math.floor(b.runtimeMinutes)
              : null;

          return {
            seasonNumber,
            episodeNumber,
            runtimeMinutes,
          };
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
