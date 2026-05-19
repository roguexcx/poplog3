// ── /api/ics/agenda ────────────────────────────────────────────────────────────
// Pipeline: ICS fetch → parse → engine → trending TMDB → enriquecimento completo
// → score de relevância → resposta JSON.
//
// Cache Supabase (tabela ics_agenda_cache, TTL 24h):
//   - GET: lê cache primeiro; se fresco (<24h) retorna imediatamente.
//   - Se stale ou ausente: executa pipeline completo, salva no Supabase, retorna.
//   - Enriquecimento: com cache de 24h vale enriquecer TODOS os grupos (não só top N).
// ──────────────────────────────────────────────────────────────────────────────

import { NextResponse } from "next/server";
import { parseIcsContent } from "@/lib/ics-parser";
import {
  runIcsEngine, computeStats, FEATURED_CATEGORIES,
  filterEnrichedGroup, computeRelevanceScore,
} from "@/lib/ics-engine";
import type { IcsSeriesGroup, IcsEngineStats } from "@/lib/ics-engine";
import { enrichSeriesGroups } from "@/lib/ics-enricher";
import { supabaseAdmin } from "@/server/supabase/admin";

// Não usar cache do Next.js — gerenciamos o cache manualmente no Supabase
export const revalidate = 0;

const ICS_URL    = "http://bancodeseries.com.br/ical.php";
const TMDB_BASE  = "https://api.themoviedb.org/3";
const CACHE_ID   = "main";
const CACHE_TTL_H = 24; // horas

export interface IcsAgendaResponse {
  groups: IcsSeriesGroup[];
  featuredGroups: IcsSeriesGroup[];
  secondaryGroups: IcsSeriesGroup[];
  stats: IcsEngineStats;
  fetchedAt: string;
  source: string;
  pendingEnrichment: number;
  trendingDay: number[];
  trendingWeek: number[];
  fromCache: boolean;
  cachedAt?: string;
}

// ── Fetch trending do TMDB ────────────────────────────────────────────────────

async function fetchTrendingIds(
  window: "day" | "week",
  token: string,
): Promise<number[]> {
  try {
    const res = await fetch(`${TMDB_BASE}/trending/tv/${window}?language=pt-BR`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: Array<{ id: number }> };
    return (data.results ?? []).map((r) => r.id);
  } catch {
    return [];
  }
}

// ── Verificar cache Supabase ──────────────────────────────────────────────────

async function readCache(): Promise<{ payload: IcsAgendaResponse; cachedAt: string } | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from("ics_agenda_cache")
      .select("payload, cached_at")
      .eq("id", CACHE_ID)
      .single();

    if (error || !data) return null;

    const cachedAt = new Date(data.cached_at as string);
    const ageHours = (Date.now() - cachedAt.getTime()) / 3_600_000;

    if (ageHours >= CACHE_TTL_H) {
      console.log(`[ICS Agenda] cache stale (${ageHours.toFixed(1)}h) — reconstruindo`);
      return null;
    }

    console.log(`[ICS Agenda] cache hit (${ageHours.toFixed(1)}h atrás)`);
    return {
      payload: data.payload as unknown as IcsAgendaResponse,
      cachedAt: cachedAt.toISOString(),
    };
  } catch (err) {
    console.warn("[ICS Agenda] erro ao ler cache:", err);
    return null;
  }
}

async function writeCache(payload: IcsAgendaResponse): Promise<void> {
  try {
    const { error } = await supabaseAdmin
      .from("ics_agenda_cache")
      .upsert(
        { id: CACHE_ID, payload: payload as unknown as Record<string, unknown>, cached_at: new Date().toISOString() },
        { onConflict: "id" },
      );
    if (error) console.warn("[ICS Agenda] erro ao salvar cache:", error.message);
    else console.log("[ICS Agenda] cache salvo no Supabase");
  } catch (err) {
    console.warn("[ICS Agenda] erro ao salvar cache:", err);
  }
}

// ── Pipeline completo ─────────────────────────────────────────────────────────

async function buildAgendaPayload(): Promise<IcsAgendaResponse> {
  // 1. Fetch do feed ICS
  const res = await fetch(ICS_URL, {
    headers: {
      "User-Agent": "PoplogApp/1.0 (calendar integration)",
      Accept: "text/calendar, text/plain, */*",
    },
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`ICS feed returned ${res.status}`);
  const raw = await res.text();

  // 2. Parse
  const events = parseIcsContent(raw);

  // 3. Engine: agrupar + classificar
  const groups = runIcsEngine(events, {
    windowDays: 30,
    sort: "nextAir",
    includeHidden: false,
  });

  const accessToken = process.env.TMDB_ACCESS_TOKEN?.trim() ?? "";

  // 4. Fetch trending (paralelo)
  const [trendingDayIds, trendingWeekIds] = accessToken
    ? await Promise.all([
        fetchTrendingIds("day", accessToken),
        fetchTrendingIds("week", accessToken),
      ])
    : [[], []];

  const trendingDay  = new Set(trendingDayIds);
  const trendingWeek = new Set(trendingWeekIds);

  // 5. Enriquecimento COMPLETO de todos os grupos featured
  //    (com cache 24h, vale enriquecer tudo de uma vez)
  const featuredToEnrich = groups.filter((g) => FEATURED_CATEGORIES.has(g.category));

  if (accessToken && featuredToEnrich.length > 0) {
    console.log(`[ICS Agenda] enriquecendo ${featuredToEnrich.length} grupos...`);
    await enrichSeriesGroups(featuredToEnrich, {
      accessToken,
      batchSize: 10,
      batchPauseMs: 700,
    });
    console.log("[ICS Agenda] enriquecimento concluído");
  }

  // 6. Score de relevância + filtro
  for (const g of groups) {
    if (g.tmdb) {
      computeRelevanceScore(g, trendingDay, trendingWeek);
      filterEnrichedGroup(g, trendingDay, trendingWeek);
    }
  }

  // 7. Separar featured / secondary
  const featuredGroups  = groups.filter((g) => FEATURED_CATEGORIES.has(g.category) && g.isRelevant);
  const secondaryGroups = groups.filter((g) => !FEATURED_CATEGORIES.has(g.category) && g.isRelevant);

  // 8. Estatísticas completas
  const allGroupsForStats = runIcsEngine(events, {
    windowDays: 30,
    sort: "nextAir",
    includeHidden: true,
  });
  const stats = computeStats(allGroupsForStats, events.length);

  const pendingEnrichment = featuredGroups.filter((g) => !g.tmdb).length;

  return {
    groups: featuredGroups,
    featuredGroups,
    secondaryGroups,
    stats,
    fetchedAt: new Date().toISOString(),
    source: ICS_URL,
    pendingEnrichment,
    trendingDay:  trendingDayIds,
    trendingWeek: trendingWeekIds,
    fromCache: false,
  };
}

// ── Handler GET ───────────────────────────────────────────────────────────────

export async function GET() {
  try {
    // Tenta ler do cache Supabase primeiro
    const cached = await readCache();
    if (cached) {
      const response: IcsAgendaResponse = {
        ...cached.payload,
        fromCache: true,
        cachedAt: cached.cachedAt,
      };
      return NextResponse.json(response, {
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
      });
    }

    // Cache miss ou stale — executa pipeline completo
    const payload = await buildAgendaPayload();

    // Salva no Supabase antes de responder (garante que o cache está gravado)
    await writeCache(payload);

    return NextResponse.json(payload, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
    });
  } catch (err) {
    console.error("[ICS Agenda] pipeline error:", err);
    return NextResponse.json(
      { error: "Failed to process ICS feed", detail: String(err) },
      { status: 500 },
    );
  }
}
