import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { buildRadarGeneralPayload } from "@/server/radar-trakt/radar-trakt-engine";
import { getRadarCachedPayload, radarCacheKey } from "@/server/radar-trakt/radar-cache.service";
import { applyRadarPersonalFilter, getRadarLibraryIdentity } from "@/server/radar-trakt/radar-personal-filter";
import { radarPayloadToLegacyAgenda } from "@/server/radar-trakt/radar-legacy-adapter";
import type { RadarMode, RadarPayload } from "@/server/radar-trakt/types";
import { FEATURES } from "@/lib/features";

export const revalidate = 0;

export type { RadarMode };
export type RadarResponse = RadarPayload;

const DEFAULT_REGION = "BR";
const DEFAULT_LANGUAGE = "pt-BR";
const WINDOW_DAYS = 62;

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
    const region = searchParams.get("region") ?? DEFAULT_REGION;
    const language = searchParams.get("language") ?? DEFAULT_LANGUAGE;
    const debug = searchParams.get("debug") === "1" || searchParams.get("debug") === "true";

    const key = radarCacheKey(region, language, WINDOW_DAYS);
    const general = await getRadarCachedPayload(key, region, language, async () =>
      buildRadarGeneralPayload({ region, language, debug }),
    );

    if (mode === "personal") {
      const user = await getCurrentUser().catch(() => null);
      const library = await getRadarLibraryIdentity(user?.id ?? null);
      const personal = applyRadarPersonalFilter(general, library);
      return NextResponse.json(
        {
          ...personal,
          generatedAt: new Date().toISOString(),
          general: radarPayloadToLegacyAgenda(personal),
        } satisfies RadarPayload,
        { headers: { "Cache-Control": user ? "no-store" : "public, max-age=60" } },
      );
    }

    return NextResponse.json(
      {
        ...general,
        mode: "general",
        generatedAt: new Date().toISOString(),
        general: radarPayloadToLegacyAgenda(general),
      } satisfies RadarPayload,
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
