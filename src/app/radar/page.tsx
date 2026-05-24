// ── Radar Page (Server Component) ──────────────────────────────────────────────
// Lê os dados do cache Supabase diretamente no servidor e passa para o
// RadarClient. O HTML é renderizado com dados prontos — sem loading state
// quando o cache está quente.
//
// Suporta dois modos via searchParam ?mode=general|personal.
// O modo padrão é "general". O cliente pode alternar sem navegar para outra página.
//
// Em RAW_BDS_MODE, a página NÃO usa cache SSR antigo do Supabase.
// Nesse modo, initialData fica null e o RadarClient faz fetch fresco.
// ──────────────────────────────────────────────────────────────────────────────

import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";
import RadarClient from "@/app/radar/RadarClient";
import type { RadarMode } from "@/app/api/radar/route";
import { supabaseAdmin } from "@/server/supabase/admin";

const CACHE_ID = "main";
const CACHE_TTL_H = 24;
// Deve ser igual a CACHE_SCHEMA_VERSION em agenda/route.ts e radar/route.ts
const CACHE_SCHEMA_VERSION = 5;

const RAW_BDS_MODE = process.env.RADAR_RAW_BDS_MODE === "true";

async function getIcsCache(): Promise<IcsAgendaResponse | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ics_agenda_cache")
      .select("payload, cached_at")
      .eq("id", CACHE_ID)
      .single();

    if (error || !data) return null;

    const cachedAt = new Date(data.cached_at as string);
    const ageHours = (Date.now() - cachedAt.getTime()) / 3_600_000;
    if (ageHours >= CACHE_TTL_H) return null;

    const payload = data.payload as unknown as IcsAgendaResponse;

    // Rejeitar payloads com schema antigo — força o cliente a refazer o fetch
    if (payload.cacheVersion !== CACHE_SCHEMA_VERSION) return null;

    return payload;
  } catch {
    return null;
  }
}

interface RadarPageProps {
  searchParams?: Promise<{ mode?: string }>;
}

export default async function RadarPage({ searchParams }: RadarPageProps) {
  const params = await searchParams;
  const rawMode = params?.mode ?? "general";
  const initialMode: RadarMode = rawMode === "personal" ? "personal" : "general";

  // Modo geral normal: pode pré-carregar cache ICS no servidor.
  // RAW_BDS_MODE: não injeta cache antigo; força fetch fresco no RadarClient.
  // Modo pessoal: o cliente faz o fetch após montar, pois depende de auth.
  const initialData =
    initialMode === "general" && !RAW_BDS_MODE ? await getIcsCache() : null;

  return <RadarClient initialData={initialData} initialMode={initialMode} />;
}