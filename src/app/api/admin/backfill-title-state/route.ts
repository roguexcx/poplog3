/**
 * POST /api/admin/backfill-title-state
 *
 * Endpoint de administração para sincronizar user_title_state a partir de user_titles.
 * Pode ser usado de duas formas:
 *
 * 1. Modo single-entry (chamado pelo script de backfill):
 *    Body: { userId, tmdbId, mediaType }
 *    → Chama upsertTitleState() para uma entrada específica.
 *
 * 2. Modo bulk (chamado manualmente ou por cron):
 *    Body: { dryRun?, limit?, userId? }
 *    → Varre user_titles, detecta entradas ausentes/divergentes e sincroniza.
 *
 * Autenticação: header x-admin-secret deve corresponder à env ADMIN_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { upsertTitleState } from "@/server/state/user-title-state";

const PAGE_SIZE   = 500;
const CONCURRENCY = 5;

// ── Auth ───────────────────────────────────────────────────────────────────────
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false; // sem secret configurado, bloqueia tudo
  return req.headers.get("x-admin-secret") === secret;
}

// ── Tipos ──────────────────────────────────────────────────────────────────────
type MediaType = "movie" | "tv";

type TitleRow = {
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: string | null;
};

type StateRow = {
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: string | null;
};

type SyncReason = "missing" | "divergent_status";

type SyncEntry = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  reason: SyncReason;
};

// ── Helpers ────────────────────────────────────────────────────────────────────
function rowKey(userId: string, mediaType: string, tmdbId: number) {
  return `${userId}:${mediaType}:${tmdbId}`;
}

async function fetchCanonicalTitles(filterUserId?: string): Promise<Map<string, TitleRow>> {
  const canonical = new Map<string, TitleRow>();
  let offset = 0;

  while (true) {
    const data = await db.userTitle.findMany({
      where: { userId: filterUserId },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: PAGE_SIZE,
      select: {
        userId: true,
        tmdbId: true,
        mediaType: true,
        status: true,
      },
    });
    if (data.length === 0) break;

    for (const item of data) {
      const row: TitleRow = {
        user_id: item.userId,
        tmdb_id: item.tmdbId,
        media_type: item.mediaType,
        status: item.status,
      };
      const k = rowKey(row.user_id, row.media_type, row.tmdb_id);
      if (!canonical.has(k)) canonical.set(k, row);
    }

    offset += PAGE_SIZE;
    if (data.length < PAGE_SIZE) break;
  }

  return canonical;
}

async function fetchExistingStates(filterUserId?: string): Promise<Map<string, StateRow>> {
  const stateMap = new Map<string, StateRow>();
  let offset = 0;

  while (true) {
    const data = await db.userTitleState.findMany({
      where: { userId: filterUserId },
      skip: offset,
      take: PAGE_SIZE,
      select: {
        userId: true,
        tmdbId: true,
        mediaType: true,
        status: true,
      },
    });
    if (data.length === 0) break;

    for (const item of data) {
      const row: StateRow = {
        user_id: item.userId,
        tmdb_id: item.tmdbId,
        media_type: item.mediaType,
        status: item.status,
      };
      stateMap.set(rowKey(row.user_id, row.media_type, row.tmdb_id), row);
    }

    offset += PAGE_SIZE;
    if (data.length < PAGE_SIZE) break;
  }

  return stateMap;
}

function buildSyncList(
  canonical: Map<string, TitleRow>,
  states: Map<string, StateRow>,
  maxEntries: number,
): SyncEntry[] {
  const toSync: SyncEntry[] = [];

  for (const [k, row] of canonical) {
    if (toSync.length >= maxEntries) break;

    const existing = states.get(k);

    if (!existing) {
      toSync.push({ userId: row.user_id, tmdbId: row.tmdb_id, mediaType: row.media_type, reason: "missing" });
    } else if (existing.status !== row.status) {
      toSync.push({ userId: row.user_id, tmdbId: row.tmdb_id, mediaType: row.media_type, reason: "divergent_status" });
    }
  }

  return toSync;
}

async function syncOne(entry: SyncEntry): Promise<"ok" | "error"> {
  try {
    await upsertTitleState({
      userId: entry.userId,
      tmdbId: entry.tmdbId,
      mediaType: entry.mediaType,
      event: { type: "status_changed", payload: { source: "backfill" } },
    });
    return "ok";
  } catch (err) {
    console.error(`[backfill-api] syncOne failed ${entry.userId}:${entry.mediaType}:${entry.tmdbId}`, err);
    return "error";
  }
}

async function processBatch(entries: SyncEntry[]): Promise<{ ok: number; errors: number }> {
  let ok = 0;
  let errors = 0;

  for (let i = 0; i < entries.length; i += CONCURRENCY) {
    const batch = entries.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map(syncOne));
    ok     += results.filter((r) => r === "ok").length;
    errors += results.filter((r) => r === "error").length;
  }

  return { ok, errors };
}

// ── Handlers ───────────────────────────────────────────────────────────────────

/**
 * POST /api/admin/backfill-title-state
 *
 * Body (single-entry, chamado pelo script):
 *   { userId: string, tmdbId: number, mediaType: "movie"|"tv" }
 *
 * Body (bulk):
 *   { bulk: true, dryRun?: boolean, limit?: number, userId?: string }
 */
export async function POST(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));

  // ── Modo single-entry ──────────────────────────────────────────────────────
  if (body.userId && body.tmdbId && body.mediaType) {
    const entry: SyncEntry = {
      userId:    body.userId as string,
      tmdbId:    Number(body.tmdbId),
      mediaType: body.mediaType as MediaType,
      reason:    "missing",
    };

    const result = await syncOne(entry);
    return NextResponse.json({ ok: result === "ok", entry });
  }

  // ── Modo bulk ──────────────────────────────────────────────────────────────
  const dryRun     = Boolean(body.dryRun);
  const limit      = Number(body.limit) || 10_000;
  const filterUser = typeof body.userId === "string" ? body.userId : undefined;

  const [canonical, states] = await Promise.all([
    fetchCanonicalTitles(filterUser),
    fetchExistingStates(filterUser),
  ]);

  const toSync = buildSyncList(canonical, states, limit);

  const stats = {
    totalTitles:       canonical.size,
    totalStates:       states.size,
    missing:           toSync.filter((e) => e.reason === "missing").length,
    divergent:         toSync.filter((e) => e.reason === "divergent_status").length,
    toSync:            toSync.length,
    synced:            0,
    errors:            0,
    dryRun,
  };

  if (dryRun || toSync.length === 0) {
    return NextResponse.json({ ok: true, stats, sample: toSync.slice(0, 20) });
  }

  const { ok, errors } = await processBatch(toSync);
  stats.synced = ok;
  stats.errors = errors;

  return NextResponse.json({ ok: errors === 0, stats });
}

/**
 * GET /api/admin/backfill-title-state
 * Relatório de divergências sem executar nenhuma ação.
 */
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const filterUser = req.nextUrl.searchParams.get("userId") ?? undefined;
  const limit      = parseInt(req.nextUrl.searchParams.get("limit") ?? "1000", 10);

  const [canonical, states] = await Promise.all([
    fetchCanonicalTitles(filterUser),
    fetchExistingStates(filterUser),
  ]);

  const toSync = buildSyncList(canonical, states, limit);

  return NextResponse.json({
    ok: true,
    stats: {
      totalTitles: canonical.size,
      totalStates: states.size,
      missing:     toSync.filter((e) => e.reason === "missing").length,
      divergent:   toSync.filter((e) => e.reason === "divergent_status").length,
      toSync:      toSync.length,
    },
    sample: toSync.slice(0, 50),
  });
}
