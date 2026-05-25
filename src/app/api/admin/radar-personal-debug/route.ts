// GET /api/admin/radar-personal-debug
// Diagnóstico do modo personalizado: mostra o cruzamento entre biblioteca do
// usuário autenticado e o feed ICS. Não requer secret — usa a sessão do browser.

import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";
import { getCurrentUser } from "@/server/auth/get-current-user";
import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";

export const revalidate = 0;

const CACHE_ID = "main";
const LIBRARY_STATUSES = ["watching", "watchlist", "watched", "fridge"] as const;

async function readCache(): Promise<IcsAgendaResponse | null> {
  try {
    const { data } = await supabaseAdmin
      .from("ics_agenda_cache")
      .select("payload")
      .eq("id", CACHE_ID)
      .single();
    return data ? (data.payload as unknown as IcsAgendaResponse) : null;
  } catch {
    return null;
  }
}

export async function GET(_req: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  // Biblioteca — fonte primária
  const { data: stateData } = await supabaseAdmin
    .from("user_title_state")
    .select("tmdb_id, media_type, status")
    .eq("user_id", user.id)
    .in("status", LIBRARY_STATUSES);

  const libraryRows = (stateData ?? []) as Array<{
    tmdb_id: number;
    media_type: string;
    status: string;
  }>;
  const tvRows = libraryRows.filter((r) => r.media_type === "tv");
  const libraryIds = new Set(tvRows.map((r) => r.tmdb_id));

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
