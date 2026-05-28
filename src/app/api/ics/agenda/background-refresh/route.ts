// ── /api/ics/agenda/background-refresh ────────────────────────────────────────
// Called silently on site entry (any page) to keep the agenda cache warm.
// Checks cache age lightly and never starts a heavy rebuild during page load.
//
// The client (AgendaBackgroundRefresh component in the root layout) calls this
// once per session via sessionStorage guard.
// ──────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";

export const revalidate = 0;

const CACHE_ID             = "main";
const REFRESH_THRESHOLD_H  = 6;    // proactively refresh when cache is 6h+ old
const CACHE_CHECK_TIMEOUT_MS = 400;

async function getCacheAgeHours(): Promise<number | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ics_agenda_cache")
      .select("cached_at")
      .eq("id", CACHE_ID)
      .single();

    if (error || !data) return null;

    const cachedAt = new Date(data.cached_at as string);
    return (Date.now() - cachedAt.getTime()) / 3_600_000;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const isBackgroundRequest = request.headers.get("x-background-refresh") === "1";
    const ageHours = await Promise.race([
      getCacheAgeHours(),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), CACHE_CHECK_TIMEOUT_MS)),
    ]);

    // Cache is missing or expired — needs refresh
    const needsRefresh =
      ageHours === null || ageHours >= REFRESH_THRESHOLD_H;

    if (!needsRefresh || isBackgroundRequest) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        skipped: true,
        ageHours: ageHours?.toFixed(1),
        message: "Background refresh skipped during page load",
      });
    }

    return NextResponse.json({
      ok: true,
      triggered: false,
      skipped: true,
      ageHours: ageHours?.toFixed(1) ?? "unknown",
      threshold: REFRESH_THRESHOLD_H,
      message: "Agenda refresh deferred",
    });
  } catch (error) {
    console.error("[background-refresh]", error);
    return NextResponse.json(
      { ok: false, error: "Failed to check cache" },
      { status: 500 }
    );
  }
}
