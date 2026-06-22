import { NextRequest, NextResponse } from "next/server";
import {
  clear,
  clearPersistentEntries,
  getEntries,
  getPersistentSnapshot,
  getStats,
} from "@/server/engine-logger";

/** Acesso protegido por header x-admin-secret. */
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get("x-admin-secret") === secret;
}

/** GET /api/debug/engine          — stats + últimas 50 entradas
 *  GET /api/debug/engine?full=1  — últimas 500 entradas
 *  DELETE /api/debug/engine (x-admin-secret header) — zera o buffer
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const full = req.nextUrl.searchParams.get("full") === "1";
  const limit = full ? 500 : 50;
  const persistent = await getPersistentSnapshot(limit);
  const stats = persistent?.stats ?? getStats();
  const entries = persistent?.entries ?? getEntries(limit);

  const formatted = {
    summary: {
      uptime: formatUptime(stats.uptimeMs),
      totalCalls: stats.totalCalls,
      cacheHitRate: `${stats.cacheHitRate}%`,
      startedAt: new Date(stats.startedAt).toISOString(),
      window: persistent ? "Últimas 24h" : "Sessão atual",
      source: persistent?.source ?? "memory",
    },
    perApi: Object.entries(stats.perApi).map(([name, s]) => ({
      api: name,
      calls: s.calls,
      hits: s.hits,
      misses: s.misses,
      errors: s.errors,
      hitRate: `${s.hitRate}%`,
      avgMs: s.avgMs,
      p95Ms: s.p95Ms,
      maxMs: s.maxMs,
    })),
    perOrigin: Object.entries(stats.perOrigin)
      .sort((a, b) => b[1] - a[1])
      .map(([origin, count]) => ({ origin, count })),
    recentErrors: stats.recentErrors.map(fmtEntry),
    recentCalls: entries.map(fmtEntry),
  };

  return NextResponse.json(formatted, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function DELETE(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  clear();
  const persistentCleared = await clearPersistentEntries();
  return NextResponse.json({
    ok: true,
    persistentCleared,
    message: persistentCleared
      ? "Engine logger resetado no buffer e no registro persistente."
      : "Engine logger resetado no buffer; registro persistente indisponível.",
  });
}

function fmtEntry(e: ReturnType<typeof getEntries>[number]) {
  return {
    id: e.id,
    time: new Date(e.ts).toISOString(),
    api: e.api,
    op: e.op,
    origin: e.origin,
    mediaType: e.mediaType,
    tmdbId: e.tmdbId,
    endpoint: e.endpoint,
    cache: e.cacheStatus,
    ms: e.durationMs,
    ok: e.success,
    status: e.httpStatus,
    error: e.error,
    fallbackFrom: e.fallbackFrom,
  };
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}
