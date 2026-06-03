// ── Radar Page (Server Component) ──────────────────────────────────────────────
// Suporta dois modos via searchParam ?mode=general|personal.
// O modo padrão é "general". O cliente pode alternar sem navegar para outra página.
// ──────────────────────────────────────────────────────────────────────────────

import RadarClient from "@/app/radar/RadarClient";
import type { RadarMode } from "@/app/api/radar/route";

interface RadarPageProps {
  searchParams?: Promise<{ mode?: string }>;
}

export default async function RadarPage({ searchParams }: RadarPageProps) {
  const params = await searchParams;
  const rawMode = params?.mode ?? "general";
  const initialMode: RadarMode = rawMode === "personal" ? "personal" : "general";

  // Cache ICS pré-carregado no servidor ainda não implementado para Prisma/MySQL.
  // O cliente faz o fetch após montar.
  const initialData = null;

  return <RadarClient initialData={initialData} initialMode={initialMode} />;
}
