// GET /api/admin/radar-personal-debug
// Diagnóstico do modo personalizado: mostra o cruzamento entre biblioteca do
// usuário autenticado e o feed ICS. Requer sessão e ADMIN_SECRET.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { getCurrentUser } from "@/server/auth/get-current-user";
import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";

export const revalidate = 0;

const CACHE_ID = "main";
const LIBRARY_STATUSES = ["watching", "watchlist", "watched", "fridge"] as const;

async function readCache(): Promise<IcsAgendaResponse | null> {
  try {
    const data = await db.icsAgendaCache.findUnique({ where: { id: CACHE_ID } });
    return data ? (data.payload as unknown as IcsAgendaResponse) : null;
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminUnauthorizedResponse();

  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  // Biblioteca — fonte primária
  const stateData = await db.userTitleState.findMany({
    where: {
      userId: user.id,
      status: { in: [...LIBRARY_STATUSES] },
    },
    select: {
      tmdbId: true,
      mediaType: true,
      status: true,
    },
  });

  const libraryRows = stateData.map((row) => ({
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    status: row.status ?? "",
  })) as Array<{
    tmdb_id: number;
    media_type: string;
    status: string;
  }>;
  const tvRows = libraryRows.filter((r) => r.media_type === "tv");

  // Feed ICS do cache
  const cache = await readCache();
  const groups = cache?.groups ?? [];
  const feedEntries = groups
    .filter((g) => g.tmdb?.tmdb_id != null)
    .map((g) => ({ tmdb_id: g.tmdb!.tmdb_id, title: g.tmdb?.name ?? g.rawTitle, nextAirDate: g.nextAirDate }));
  const feedSet = new Set(feedEntries.map((e) => e.tmdb_id));

  // Cruzamento
  const matches = tvRows
    .filter((r) => feedSet.has(r.tmdb_id))
    .map((r) => ({ tmdb_id: r.tmdb_id, status: r.status }));

  const missing = tvRows
    .filter((r) => !feedSet.has(r.tmdb_id))
    .map((r) => ({ tmdb_id: r.tmdb_id, status: r.status }));

  return NextResponse.json({
    userId: user.id,
    libraryTvCount: tvRows.length,
    feedGroupsTotal: groups.length,
    feedGroupsWithTmdb: feedEntries.length,
    matchCount: matches.length,
    missingCount: missing.length,
    // Séries da biblioteca que BATEM com o feed
    matches,
    // Séries da biblioteca que NÃO estão no feed (não têm ep futuro ou foram bloqueadas)
    missing,
    // Sample dos primeiros IDs do feed (para comparar formato com libraryIds)
    feedSample: feedEntries.slice(0, 20).map((e) => e.tmdb_id),
  });
}
