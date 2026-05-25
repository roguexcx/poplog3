// ── POST /api/admin/radar-cache-flush ────────────────────────────────────────
// Invalida o cache da Agenda/Radar no Supabase: apaga o campo cached_at
// setando-o para epoch zero, forçando reconstrução completa na próxima
// request ao /api/ics/agenda.
//
// Autenticação: header x-admin-secret === process.env.ADMIN_SECRET
// ──────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";

const CACHE_ID = "main";

function isAuthorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get("x-admin-secret") === secret;
}

/** GET — retorna o status atual do cache (idade, version). */
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("ics_agenda_cache")
    .select("cached_at, payload->cacheVersion")
    .eq("id", CACHE_ID)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (!data) {
    return NextResponse.json({ ok: true, status: "empty", cachedAt: null, ageHours: null, cacheVersion: null });
  }

  const cachedAt = new Date(data.cached_at as string);
  const ageHours = (Date.now() - cachedAt.getTime()) / 3_600_000;

  return NextResponse.json({
    ok: true,
    status: "present",
    cachedAt: cachedAt.toISOString(),
    ageHours: parseFloat(ageHours.toFixed(2)),
    cacheVersion: (data as Record<string, unknown>)["cacheVersion"] ?? null,
  });
}

/** POST — invalida o cache (seta cached_at para epoch) e dispara rebuild. */
export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const triggerRebuild = url.searchParams.get("rebuild") !== "false";

  // Invalida: seta cached_at para epoch zero — readCache() vai rejeitar como stale
  const { error: updateError } = await supabaseAdmin
    .from("ics_agenda_cache")
    .update({ cached_at: new Date(0).toISOString() })
    .eq("id", CACHE_ID);

  if (updateError) {
    return NextResponse.json({ ok: false, error: updateError.message }, { status: 500 });
  }

  let rebuildTriggered = false;
  if (triggerRebuild) {
    // Fire-and-forget: dispara reconstrução em background
    const origin = new URL(req.url).origin;
    void fetch(`${origin}/api/ics/agenda`, {
      method: "GET",
      headers: { "x-background-refresh": "1" },
    }).catch((err: unknown) => {
      console.warn("[radar-cache-flush] rebuild trigger failed:", err);
    });
    rebuildTriggered = true;
  }

  return NextResponse.json({
    ok: true,
    flushed: true,
    rebuildTriggered,
    message: rebuildTriggered
      ? "Cache invalidado — reconstrução em background disparada"
      : "Cache invalidado — reconstrução será feita na próxima request",
  });
}
