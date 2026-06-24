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
import { normalizeStreamingRegion } from "@/server/streaming/region";

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

  try {
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

    // Só serve do cache se ele tiver catálogo. Um cache "hit" com providers vazio
    // (gravado antes do catálogo existir) é tratado como inválido e reconstruído,
    // evitando que a tela fique presa em "Serviços disponíveis" vazio.
    const cachedHasCatalog =
      cached?.status === "hit" &&
      Array.isArray(cached.payload?.providers) &&
      cached.payload.providers.length > 0;

    if (cachedHasCatalog) {
      console.log("[profile/streaming-preferences/perf]", {
        cacheStatus: "persistent_hit",
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({ ...cached!.payload, cacheStatus: "persistent_hit" });
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

    // Nunca persiste um catálogo vazio: senão re-introduziríamos o bug do cache
    // vazio. Sem catálogo, devolvemos sem cachear para que a próxima leitura
    // tente reconstruir.
    if (providers.length > 0) {
      await writeContinuitySectionCache({
        sectionKey: "profile_streaming_preferences",
        userId: user.id,
        region: "BR",
        language: "pt-BR",
        ttlMs: STREAMING_PREFS_CACHE_TTL_MS,
        payload,
      });
      markStage(perf, stageRef, "cache_write");
    }

    console.log("[profile/streaming-preferences/perf]", {
      cacheStatus:
        providers.length === 0
          ? "empty_catalog_not_cached"
          : cached?.status === "stale"
            ? "persistent_stale_rebuilt"
            : "persistent_miss",
      providers: payload.providers.length,
      preferences: payload.preferences.length,
      source: "local",
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json({
      ...payload,
      cacheStatus: providers.length === 0 ? "empty_catalog" : "persistent_miss",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[profile/streaming-preferences] GET failed", {
      message,
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        ok: false,
        error: "streaming_preferences_unavailable",
        detail: process.env.NODE_ENV === "production" ? undefined : message,
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json()) as PreferencePayload;
  const country = normalizeStreamingRegion(body.country, {
    source: "api:streaming-preferences:country",
    explicit: typeof body.country === "string",
  });
  const providerIds = Array.isArray(body.providerIds)
    ? body.providerIds.filter((id): id is string => typeof id === "string" && id.length <= 191)
    : [];

  await replaceUserStreamingPreferences({
    userId: user.id,
    country,
    providerIds,
  });

  invalidateContinuitySectionCache(user.id);

  // Mantém consumidores materializados (Acompanhando/continuidade) coerentes já na
  // próxima navegação; o núcleo de availability também personaliza em tempo real.
  await refreshAllUserTitleAvailability(user.id, country);

  return NextResponse.json({ ok: true });
}
