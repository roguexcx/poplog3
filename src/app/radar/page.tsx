// ── Radar Page (Server Component) ──────────────────────────────────────────────
// Lê os dados do cache Supabase diretamente no servidor e passa para o
// RadarClient. O HTML é renderizado com dados prontos — sem loading state
// quando o cache está quente.
//
// Suporta dois modos via searchParam ?mode=general|personal.
// O modo padrão é "general". O cliente pode alternar sem navegar para outra página.
// ──────────────────────────────────────────────────────────────────────────────

import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";
import RadarClient from "@/app/radar/RadarClient";
import type { RadarMode } from "@/app/api/radar/route";
import { supabaseAdmin } from "@/server/supabase/admin";

const CACHE_ID = "main";
const CACHE_TTL_H = 24;

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

    return data.payload as unknown as IcsAgendaResponse;
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

  // Para o modo geral, pré-carrega o cache ICS no servidor (SSR quente)
  // Para o modo pessoal, o cliente fará o fetch após montar (dados dependem de auth)
  const initialData = initialMode === "general" ? await getIcsCache() : null;

  return <RadarClient initialData={initialData} initialMode={initialMode} />;
}
