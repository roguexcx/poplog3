import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { buildRadarGeneralPayload } from "@/server/radar-trakt/radar-trakt-engine";
import { getRadarCachedPayload, radarCacheKey } from "@/server/radar-trakt/radar-cache.service";
import { applyRadarPersonalFilter, getRadarLibraryIdentity } from "@/server/radar-trakt/radar-personal-filter";

export const revalidate = 0;

const REGION = "BR";
const LANGUAGE = "pt-BR";
const WINDOW_DAYS = 62;

export async function GET(req: NextRequest) {
  if (!isAdminRequest(req)) return adminUnauthorizedResponse();

  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const general = await getRadarCachedPayload(
    radarCacheKey(REGION, LANGUAGE, WINDOW_DAYS),
    REGION,
    LANGUAGE,
    async () => buildRadarGeneralPayload({ region: REGION, language: LANGUAGE, debug: true }),
  );
  const library = await getRadarLibraryIdentity(user.id);
  const personal = applyRadarPersonalFilter(general, library);
  const items = Object.values(personal.sections).flatMap((section) => section.items);

  return NextResponse.json({
    userId: user.id,
    source: "trakt",
    librarySize: personal.librarySize,
    matchedCount: personal.matchedCount,
    missingLibraryCount: personal.missingLibraryCount,
    sectionCounts: Object.fromEntries(
      Object.entries(personal.sections).map(([key, section]) => [key, section.count]),
    ),
    sampleMatches: items.slice(0, 20).map((event) => ({
      title: event.title,
      date: event.date,
      eventType: event.eventType,
      ids: event.ids,
    })),
  });
}
