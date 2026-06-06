import { NextResponse } from "next/server";
import { syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import { hydrateSeriesEpisodesFromSources } from "@/server/source-engine/series-episode-hydrator";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/hydrate-series-episodes
 *
 * Hidrata episódios de uma série a partir de TVDB + Trakt + Balloonerismm.
 * Substituição da hidratação TMDB removida.
 *
 * Body: { tmdbId?: number, imdbId?: string, seasons?: number }
 * Header: x-admin-secret
 */
export async function POST(request: Request) {
  const adminSecret = request.headers.get("x-admin-secret");

  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const tmdbId = typeof body.tmdbId === "number" ? body.tmdbId : null;
  const imdbId = typeof body.imdbId === "string" ? body.imdbId : null;
  const seriesTmdbId = tmdbId ?? (imdbId ? syntheticTmdbFromImdbId(imdbId) : null);

  if (!seriesTmdbId) {
    return NextResponse.json({ ok: false, error: "tmdbId ou imdbId obrigatorio" }, { status: 400 });
  }

  const result = await hydrateSeriesEpisodesFromSources({
    seriesTmdbId,
    imdbId,
    numberOfSeasons: typeof body.seasons === "number" ? body.seasons : null,
    includeSpecials: body.includeSpecials === true,
    force: body.force === true,
  });

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
