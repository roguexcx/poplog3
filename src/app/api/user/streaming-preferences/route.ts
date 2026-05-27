import { NextResponse } from "next/server";

import { createSupabaseServerClient } from "@/server/supabase/server";
import { refreshAllUserTitleAvailability } from "@/server/streaming/batch-availability-refresh";
import {
  invalidateContinuitySectionCache,
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";

type PreferencePayload = {
  providerIds?: string[];
  country?: string;
};

type StreamingPreferencesPayload = {
  ok: true;
  providers: unknown[];
  preferences: unknown[];
};

const STREAMING_PREFS_CACHE_TTL_MS = 10 * 60_000;

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

export async function GET() {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  const stageRef = { value: totalStartedAt };
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  markStage(perf, stageRef, "auth");

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const cached = await readContinuitySectionCache<StreamingPreferencesPayload>(
    "profile_streaming_preferences",
    {
      userId: user.id,
      region: "BR",
      language: "pt-BR",
    },
  );
  markStage(perf, stageRef, "cache_read");

  if (cached?.status === "hit") {
    console.log("[profile/streaming-preferences/perf]", {
      cacheStatus: "persistent_hit",
      ...perf,
      total: Date.now() - totalStartedAt,
    });
    return NextResponse.json({ ...cached.payload, cacheStatus: "persistent_hit" });
  }

  const { data: providers, error: providersError } = await supabase
    .from("streaming_providers")
    .select("id, provider_name, provider_slug, logo_url, tmdb_provider_id, country, is_active")
    .eq("is_active", true)
    .eq("country", "BR")
    .not("tmdb_provider_id", "is", null)
    .order("provider_name", { ascending: true });
  markStage(perf, stageRef, "providers_read");

  if (providersError) {
    return NextResponse.json(
      { ok: false, error: providersError.message },
      { status: 500 }
    );
  }

  const { data: preferences, error: preferencesError } = await supabase
    .from("user_streaming_preferences")
    .select("provider_id, country, is_enabled, priority_order")
    .eq("user_id", user.id)
    .eq("country", "BR")
    .order("priority_order", { ascending: true });
  markStage(perf, stageRef, "preferences_read");

  if (preferencesError) {
    return NextResponse.json(
      { ok: false, error: preferencesError.message },
      { status: 500 }
    );
  }

  const payload = {
    ok: true,
    providers: providers ?? [],
    preferences: preferences ?? [],
  } satisfies StreamingPreferencesPayload;

  await writeContinuitySectionCache({
    sectionKey: "profile_streaming_preferences",
    userId: user.id,
    region: "BR",
    language: "pt-BR",
    ttlMs: STREAMING_PREFS_CACHE_TTL_MS,
    payload,
  });
  markStage(perf, stageRef, "cache_write");

  console.log("[profile/streaming-preferences/perf]", {
    cacheStatus: cached?.status === "stale" ? "persistent_stale_rebuilt" : "persistent_miss",
    providers: payload.providers.length,
    preferences: payload.preferences.length,
    ...perf,
    total: Date.now() - totalStartedAt,
  });

  return NextResponse.json({ ...payload, cacheStatus: "persistent_miss" });
}

export async function PUT(request: Request) {
  const supabase = await createSupabaseServerClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PreferencePayload;
  const country = body.country ?? "BR";
  const providerIds = body.providerIds ?? [];

  const { error: disableError } = await supabase
    .from("user_streaming_preferences")
    .update({
      is_enabled: false,
      priority_order: 999,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id)
    .eq("country", country);

  if (disableError) {
    return NextResponse.json(
      { ok: false, error: disableError.message },
      { status: 500 }
    );
  }

  if (providerIds.length > 0) {
    const rows = providerIds.map((providerId, index) => ({
      user_id: user.id,
      provider_id: providerId,
      country,
      is_enabled: true,
      priority_order: index + 1,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from("user_streaming_preferences")
      .upsert(rows, {
        onConflict: "user_id,provider_id,country",
      });

    if (error) {
      return NextResponse.json(
        { ok: false, error: error.message },
        { status: 500 }
      );
    }
  }

  // Atualiza best_provider_* em todos os títulos ativos do usuário (fire-and-forget)
  const safeCountry = country === "US" ? "US" : "BR";
  invalidateContinuitySectionCache(user.id);
  refreshAllUserTitleAvailability(user.id, safeCountry).catch(console.error);

  return NextResponse.json({ ok: true });
}
