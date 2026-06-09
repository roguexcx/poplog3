// ── Radar Page (Server Component) ──────────────────────────────────────────────
// Suporta dois modos via searchParam ?mode=general|personal.
// O modo padrão é "general". O cliente pode alternar sem navegar para outra página.
// ──────────────────────────────────────────────────────────────────────────────

import RadarClient from "@/app/radar/RadarClient";
import type { RadarMode } from "@/app/api/radar/route";
import { buildRadarGeneralPayload } from "@/server/radar-trakt/radar-trakt-engine";
import { getRadarCachedPayload, radarCacheKey } from "@/server/radar-trakt/radar-cache.service";
import { applyRadarPersonalFilter, getRadarLibraryIdentity } from "@/server/radar-trakt/radar-personal-filter";
import { radarPayloadToLegacyAgenda } from "@/server/radar-trakt/radar-legacy-adapter";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { redirect } from "next/navigation";
import { FEATURES } from "@/lib/features";

interface RadarPageProps {
  searchParams?: Promise<{ mode?: string }>;
}

const DEFAULT_REGION = "BR";
const DEFAULT_LANGUAGE = "pt-BR";
const WINDOW_DAYS = 62;

export default async function RadarPage({ searchParams }: RadarPageProps) {
  if (!FEATURES.RADAR) redirect("/");

  const params = await searchParams;
  const rawMode = params?.mode ?? "general";
  const initialMode: RadarMode = rawMode === "personal" ? "personal" : "general";

  const general = await getRadarCachedPayload(
    radarCacheKey(DEFAULT_REGION, DEFAULT_LANGUAGE, WINDOW_DAYS),
    DEFAULT_REGION,
    DEFAULT_LANGUAGE,
    async () => buildRadarGeneralPayload({ region: DEFAULT_REGION, language: DEFAULT_LANGUAGE }),
  ).catch(() => null);

  const initialPayload =
    initialMode === "personal" && general
      ? await getCurrentUser()
          .then((user) => getRadarLibraryIdentity(user?.id ?? null))
          .then((library) => applyRadarPersonalFilter(general, library))
          .catch(() => general)
      : general;

  const initialData = initialPayload ? radarPayloadToLegacyAgenda(initialPayload) : null;

  return <RadarClient initialData={initialData} initialMode={initialMode} />;
}
