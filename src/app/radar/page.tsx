// ── Radar Page (Server Component) ──────────────────────────────────────────────
// Suporta dois modos via searchParam ?mode=general|personal.
// O modo padrão é "general". O cliente pode alternar sem navegar para outra página.
// ──────────────────────────────────────────────────────────────────────────────

import RadarV2Client from "@/app/radar/RadarV2Client";
import type { RadarMode } from "@/app/api/radar/route";
import { buildRadarGeneralPayload } from "@/server/radar-trakt/radar-trakt-engine";
import { getRadarCachedPayload, radarCacheKey } from "@/server/radar-trakt/radar-cache.service";
import { applyRadarPersonalFilter, getRadarLibraryIdentity } from "@/server/radar-trakt/radar-personal-filter";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { FEATURES } from "@/lib/features";
import { normalizeStreamingRegion } from "@/server/streaming/region";

interface RadarPageProps {
  searchParams?: Promise<{ mode?: string; language?: string; region?: string }>;
}

const DEFAULT_REGION = "BR";
const DEFAULT_LANGUAGE = "pt-BR";
const WINDOW_DAYS = 62;

export default async function RadarPage({ searchParams }: RadarPageProps) {
  if (!FEATURES.RADAR) redirect("/");

  const params = await searchParams;
  const cookieStore = await cookies();
  const rawMode = params?.mode ?? "general";
  const initialMode: RadarMode = rawMode === "personal" ? "personal" : "general";
  const region = normalizeStreamingRegion(params?.region ?? cookieStore.get("poplog_region")?.value ?? DEFAULT_REGION, {
    source: "radar-page:region",
    explicit: Boolean(params?.region ?? cookieStore.get("poplog_region")?.value),
  });
  const language = params?.language ?? cookieStore.get("poplog_catalog_language")?.value ?? DEFAULT_LANGUAGE;

  const general = await getRadarCachedPayload(
    radarCacheKey(region, language, WINDOW_DAYS),
    region,
    language,
    async () => buildRadarGeneralPayload({ region, language }),
  ).catch(() => null);

  const initialPayload =
    initialMode === "personal" && general
      ? await getCurrentUser()
          .then((user) => getRadarLibraryIdentity(user?.id ?? null))
          .then((library) => applyRadarPersonalFilter(general, library))
          .catch(() => general)
      : general;

  return (
    <RadarV2Client
      initialPayload={initialPayload}
      initialMode={initialMode}
      region={region}
      language={language}
    />
  );
}
