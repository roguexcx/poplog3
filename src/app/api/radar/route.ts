import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { buildRadarGeneralPayload } from "@/server/radar-trakt/radar-trakt-engine";
import { getRadarCachedPayload, radarCacheKey } from "@/server/radar-trakt/radar-cache.service";
import { applyRadarPersonalFilter, getRadarLibraryIdentity } from "@/server/radar-trakt/radar-personal-filter";
import { radarPayloadToLegacyAgenda } from "@/server/radar-trakt/radar-legacy-adapter";
import type { RadarMode, RadarPayload } from "@/server/radar-trakt/types";
import { FEATURES } from "@/lib/features";
import { normalizeStreamingRegion } from "@/server/streaming/region";

export const revalidate = 0;

export type { RadarMode };
export type RadarResponse = RadarPayload;

const DEFAULT_LANGUAGE = "pt-BR";
const WINDOW_DAYS = 62;

function radarLegacyResponse(payload: RadarPayload): Record<string, unknown> {
  return {
    mode: payload.mode,
    source: payload.source,
    generatedAt: payload.generatedAt,
    cachedAt: payload.cachedAt,
    fromCache: payload.fromCache,
    cacheVersion: payload.cacheVersion,
    region: payload.region,
    language: payload.language,
    stats: payload.stats,
    libraryFiltered: payload.libraryFiltered,
    librarySize: payload.librarySize,
    matchedCount: payload.matchedCount,
    missingLibraryCount: payload.missingLibraryCount,
    general: radarPayloadToLegacyAgenda(payload),
  };
}

export async function GET(req: NextRequest) {
  if (!FEATURES.RADAR) {
    return NextResponse.json(
      { error: "radar_disabled", message: "Radar está temporariamente desativado." },
      { status: 503 },
    );
  }
  try {
    const { searchParams } = new URL(req.url);
    const mode: RadarMode = searchParams.get("mode") === "personal" ? "personal" : "general";
    const region = normalizeStreamingRegion(searchParams.get("region") ?? req.cookies.get("poplog_region")?.value, {
      source: "api:radar:region",
      explicit: searchParams.has("region") || req.cookies.has("poplog_region"),
    });
    const language = searchParams.get("language") ?? req.cookies.get("poplog_catalog_language")?.value ?? DEFAULT_LANGUAGE;
    const debug = searchParams.get("debug") === "1" || searchParams.get("debug") === "true";
    const legacy = searchParams.get("legacy") === "1" || searchParams.get("legacy") === "true";

    const key = radarCacheKey(region, language, WINDOW_DAYS);
    const general = await getRadarCachedPayload(key, region, language, async () =>
      buildRadarGeneralPayload({ region, language, debug }),
    );

    if (mode === "personal") {
      const user = await getCurrentUser().catch(() => null);
      const library = await getRadarLibraryIdentity(user?.id ?? null);
      const personal = applyRadarPersonalFilter(general, library);
      return NextResponse.json(
        legacy
          ? radarLegacyResponse({ ...personal, generatedAt: new Date().toISOString() })
          : ({
              ...personal,
              generatedAt: new Date().toISOString(),
            } satisfies RadarPayload),
        { headers: { "Cache-Control": user ? "no-store" : "public, max-age=60" } },
      );
    }

    return NextResponse.json(
      legacy
        ? radarLegacyResponse({ ...general, mode: "general", generatedAt: new Date().toISOString() })
        : ({
            ...general,
            mode: "general",
            generatedAt: new Date().toISOString(),
          } satisfies RadarPayload),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[/api/radar] trakt engine error:", error);
    return NextResponse.json(
      { error: "Radar engine error", detail: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
