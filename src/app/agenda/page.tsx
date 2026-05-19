// ── Agenda Page (Server Component) ────────────────────────────────────────────
// Lê os dados do cache Supabase diretamente no servidor e passa para o
// Client Component. O HTML é renderizado com dados prontos — sem loading state
// quando o cache está quente.
// ──────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from "@/server/supabase/admin";
import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";
import AgendaClient from "./AgendaClient";

const CACHE_ID   = "main";
const CACHE_TTL_H = 24;

async function getAgendaData(): Promise<IcsAgendaResponse | null> {
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

export default async function AgendaPage() {
  const initialData = await getAgendaData();
  return <AgendaClient initialData={initialData} />;
}
