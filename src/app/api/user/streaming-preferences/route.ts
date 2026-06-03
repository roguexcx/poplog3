import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { refreshAllUserTitleAvailability } from "@/server/streaming/batch-availability-refresh";
import {
  invalidateContinuitySectionCache,
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";
import {
  listActiveStreamingProviders,
  listUserStreamingPreferences,
  replaceUserStreamingPreferences,
} from "@/server/local-services/streaming-preferences-local.service";

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

  const user = await getCurrentUser();
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

  const [providers, preferences] = await Promise.all([
    listActiveStreamingProviders("BR"),
    listUserStreamingPreferences(user.id, "BR"),
  ]);
  markStage(perf, stageRef, "local_read");

  const payload = {
    ok: true,
    providers,
    preferences,
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
    source: "local",
    ...perf,
    total: Date.now() - totalStartedAt,
  });

  return NextResponse.json({ ...payload, cacheStatus: "persistent_miss" });
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PreferencePayload;
  const country = body.country ?? "BR";
  const providerIds = body.providerIds ?? [];

  await replaceUserStreamingPreferences({
    userId: user.id,
    country,
    providerIds,
  });

  invalidateContinuitySectionCache(user.id);

  // Atualiza best_provider_* em todos os títulos ativos do usuário (fire-and-forget)
  const safeCountry = country === "US" ? "US" : "BR";
  refreshAllUserTitleAvailability(user.id, safeCountry).catch(console.error);

  return NextResponse.json({ ok: true });
}
