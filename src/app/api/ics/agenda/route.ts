// ── /api/ics/agenda ────────────────────────────────────────────────────────────
// Pipeline: ICS fetch → parse → engine → trending TMDB → enriquecimento completo
// → score de relevância → resposta JSON.
//
// Cache Supabase (tabela ics_agenda_cache, TTL 24h):
//   - GET: lê cache primeiro; se fresco (<24h) retorna imediatamente.
//   - Se stale ou ausente: executa pipeline completo, salva no Supabase, retorna.
//   - Enriquecimento: com cache de 24h vale enriquecer TODOS os grupos (não só top N).
// ──────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { parseIcsContent } from "@/lib/ics-parser";
import {
  runIcsEngine, computeStats, FEATURED_CATEGORIES, HIDDEN_CATEGORIES,
  filterEnrichedGroup, computeRelevanceScore, classifyTitle, RELEVANCE_THRESHOLD,
} from "@/lib/ics-engine";
import type { IcsSeriesGroup, IcsEngineStats, MovieGroup } from "@/lib/ics-engine";
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
  /** Filmes em cartaz/estreando — populado pelo pipeline de airing quando disponível */
  movies?: MovieGroup[];
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

  // 5. Enriquecimento COMPLETO de todos os grupos featured.
  // Usa concorrência controlada via p-limit (concurrency=5) em vez de batches
  // sequenciais — até 5x mais rápido sem risco de rate-limit ou timeout serverless.
  const featuredToEnrich = groups.filter((g) => FEATURED_CATEGORIES.has(g.category));

  if (accessToken && featuredToEnrich.length > 0) {
    console.log(`[ICS Agenda] enriquecendo ${featuredToEnrich.length} grupos...`);
    await enrichSeriesGroups(featuredToEnrich, { accessToken, concurrency: 5 });
    console.log("[ICS Agenda] enriquecimento concluído");
  }

  // 6. Score de relevância + filtro
  for (const g of groups) {
    if (g.tmdb) {
      computeRelevanceScore(g, trendingDay, trendingWeek);
      filterEnrichedGroup(g, trendingDay, trendingWeek);
    }
  }

  // 7. Separar featured / secondary — com filtro de segurança duplo:
  //    - g.isRelevant: resultado do filterEnrichedGroup do Passo 6
  //    - isHiddenGroup: garante que refined_category HIDDEN não vaza para o output,
  //      mesmo quando undefined (grupos SECONDARY não passam pelo enriquecimento completo,
  //      portanto tmdb.refined_category pode ser undefined — fallback para g.category).
  const isHiddenGroup = (g: IcsSeriesGroup): boolean =>
    HIDDEN_CATEGORIES.has(g.category) ||
    HIDDEN_CATEGORIES.has(g.tmdb?.refined_category ?? g.category);

  const featuredGroups  = groups.filter((g) =>
    FEATURED_CATEGORIES.has(g.category) && g.isRelevant && !isHiddenGroup(g),
  );
  const secondaryGroups = groups.filter((g) =>
    !FEATURED_CATEGORIES.has(g.category) && g.isRelevant && !isHiddenGroup(g),
  );

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

// ── Modo Debug/Admin ──────────────────────────────────────────────────────────
//
// GET /api/ics/agenda?debug=<rawTitle|key>
//
// Retorna o passo a passo do pipeline para um título específico:
//   - step1: classifyTitle (categoria local)
//   - step2: dados TMDB (tmdb_id, lang, popularity, genre_ids, tmdb_type)
//   - step3: refined_category (resultado do refineCategoryFromTmdb)
//   - step4: cada hard filter e seu resultado
//   - step5: breakdown do score de relevância
//   - final_score / final_relevant / discard_reason
//
// Sempre executa o pipeline completo (ignora cache) para dados frescos.

interface DebugReport {
  key: string;
  rawTitle: string;
  step1_local_category: string;
  step2_tmdb: {
    found: boolean;
    tmdb_id?: number;
    name?: string;
    original_language?: string;
    popularity?: number;
    vote_average?: number;
    vote_count?: number;
    genre_ids?: number[];
    tmdb_type?: string | null;
  };
  step3_refined_category: string | null;
  step4_filters: {
    local_hidden: boolean;
    tmdb_type_blocked: boolean;
    refined_hidden: boolean;
    language_blocked: boolean;
    passed_all_hard_filters: boolean;
  };
  step5_score: {
    popularity_score: number;
    quality_score: number;
    trending_boost: number;
    language_adjustment: number;
    total: number;
    threshold: number;
  } | null;
  final_score: number;
  final_relevant: boolean;
  discard_reason: string | null;
}

function buildDebugReport(
  group: IcsSeriesGroup,
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
): DebugReport {
  const localCat = classifyTitle(group.rawTitle);
  const tmdb = group.tmdb;

  const filters = {
    local_hidden:             HIDDEN_CATEGORIES.has(group.category),
    tmdb_type_blocked:        false,
    refined_hidden:           false,
    language_blocked:         false,
    passed_all_hard_filters:  false,
  };

  let discardReason: string | null = null;

  if (filters.local_hidden) {
    discardReason = `Categoria local '${group.category}' está em HIDDEN_CATEGORIES`;
  }

  if (tmdb && !discardReason) {
    const typ = tmdb.tmdb_type ?? "";
    if (["Talk Show", "Game Show", "News", "Soap"].includes(typ)) {
      filters.tmdb_type_blocked = true;
      discardReason = `tmdb_type='${typ}' bloqueado automaticamente`;
    }
  }

  if (tmdb && !discardReason) {
    const refinedCat = tmdb.refined_category ?? group.category;
    if (HIDDEN_CATEGORIES.has(refinedCat)) {
      filters.refined_hidden = true;
      discardReason = `refined_category='${refinedCat}' está em HIDDEN_CATEGORIES`;
    }
  }

  if (tmdb && !discardReason) {
    const lang = tmdb.original_language ?? "";
    if (lang && !["en", "pt", "es", "ja"].includes(lang)) {
      filters.language_blocked = true;
      discardReason = `Idioma '${lang}' não está na lista de permitidos`;
    }
  }

  filters.passed_all_hard_filters = !discardReason;

  let scoreBreakdown: DebugReport["step5_score"] = null;
  if (tmdb && filters.passed_all_hard_filters) {
    const pop = tmdb.popularity ?? 0;
    const popScore = Math.min(35, Math.round(Math.log2(Math.max(1, pop)) * 4.5));

    const avg = tmdb.vote_average ?? 0;
    const cnt = tmdb.vote_count ?? 0;
    let qualityScore = 0;
    if (cnt >= 50)      qualityScore = Math.round((avg / 10) * 25);
    else if (cnt >= 10) qualityScore = Math.round((avg / 10) * 12);
    else                qualityScore = -15;

    const lang = tmdb.original_language ?? "";
    let langAdj = 0;
    if (lang === "en" || lang === "pt")         langAdj = 10;
    else if (lang === "es" || lang === "ja")    langAdj = 5;

    const trendingBoost = trendingDay.has(tmdb.tmdb_id) ? 20
      : trendingWeek.has(tmdb.tmdb_id) ? 10 : 0;

    const totalScore = computeRelevanceScore(group, trendingDay, trendingWeek);

    scoreBreakdown = {
      popularity_score:    popScore,
      quality_score:       qualityScore,
      trending_boost:      trendingBoost,
      language_adjustment: langAdj,
      total:               totalScore,
      threshold:           RELEVANCE_THRESHOLD,
    };

    if (!discardReason && totalScore < RELEVANCE_THRESHOLD) {
      discardReason = `Score ${totalScore} abaixo do threshold ${RELEVANCE_THRESHOLD}`;
    }
  }

  return {
    key:                  group.key,
    rawTitle:             group.rawTitle,
    step1_local_category: localCat,
    step2_tmdb: tmdb
      ? {
          found:             true,
          tmdb_id:           tmdb.tmdb_id,
          name:              tmdb.name,
          original_language: tmdb.original_language,
          popularity:        tmdb.popularity,
          vote_average:      tmdb.vote_average,
          vote_count:        tmdb.vote_count,
          genre_ids:         tmdb.genre_ids,
          tmdb_type:         tmdb.tmdb_type ?? null,
        }
      : { found: false },
    step3_refined_category: tmdb?.refined_category ?? null,
    step4_filters:          filters,
    step5_score:            scoreBreakdown,
    final_score:            group.relevanceScore,
    final_relevant:         group.isRelevant,
    discard_reason:         discardReason,
  };
}

// ── Handler GET ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const debugKey = searchParams.get("debug");

    // Modo debug: pipeline completo + relatório detalhado para um título
    if (debugKey) {
      const payload = await buildAgendaPayload();
      const normalize = (s: string) => s.toLowerCase().replace(/[^\w]/g, "");
      const normalizedKey = normalize(debugKey);
      const allGroups = [...payload.featuredGroups, ...payload.secondaryGroups];
      const group = allGroups.find(
        (g) => normalize(g.key) === normalizedKey || normalize(g.rawTitle) === normalizedKey,
      );

      if (!group) {
        return NextResponse.json(
          {
            error: "Título não encontrado no pipeline",
            searched_key: debugKey,
            available_keys: allGroups.slice(0, 30).map((g) => ({ key: g.key, rawTitle: g.rawTitle })),
          },
          { status: 404 },
        );
      }

      const td  = new Set(payload.trendingDay);
      const tw  = new Set(payload.trendingWeek);
      const report = buildDebugReport(group, td, tw);
      return NextResponse.json({ debug: true, report }, { headers: { "Cache-Control": "no-store" } });
    }

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
