// ── /api/ics/agenda/background-refresh ────────────────────────────────────────
// Called silently on site entry (any page) to keep the agenda cache warm.
// Checks cache age — if older than REFRESH_THRESHOLD_H hours, triggers a full
// rebuild in the background. Returns immediately so the client never blocks.
//
// The client (AgendaBackgroundRefresh component in the root layout) calls this
// once per session via sessionStorage guard.
// ──────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/server/supabase/admin";

export const revalidate = 0;

const CACHE_ID             = "main";
const CACHE_TTL_H          = 24;   // same as the main route
const REFRESH_THRESHOLD_H  = 6;    // proactively refresh when cache is 6h+ old

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
    const ageHours = await getCacheAgeHours();

    // Cache is missing or expired — needs refresh
    const needsRefresh =
      ageHours === null || ageHours >= REFRESH_THRESHOLD_H;

    if (!needsRefresh) {
      return NextResponse.json({
        ok: true,
        triggered: false,
        ageHours: ageHours?.toFixed(1),
        message: "Cache is fresh — no refresh needed",
      });
    }

    // Trigger background rebuild by calling the full agenda endpoint.
    // We use fetch() to the same origin so it runs in its own request context.
    // We do NOT await it — fire and forget.
    const origin = new URL(request.url).origin;
    void fetch(`${origin}/api/ics/agenda`, {
      method: "GET",
      headers: { "x-background-refresh": "1" },
      // No signal — intentionally detached from this request
    }).catch((err) => {
      console.warn("[background-refresh] trigger failed:", err);
    });

    return NextResponse.json({
      ok: true,
      triggered: true,
      ageHours: ageHours?.toFixed(1) ?? "unknown",
      threshold: REFRESH_THRESHOLD_H,
      message: "Background refresh triggered",
    });
  } catch (error) {
    console.error("[background-refresh]", error);
    return NextResponse.json(
      { ok: false, error: "Failed to check cache" },
      { status: 500 }
    );
  }
}
