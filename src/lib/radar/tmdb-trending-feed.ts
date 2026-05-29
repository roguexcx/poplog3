// src/lib/radar/tmdb-trending-feed.ts
//
// ── Feed TMDB Trending/Airing ─────────────────────────────────────────────────
//
// FEATURE FLAG: ENABLE_TMDB_TRENDING_FEED=true no .env
// Quando desligada, fetchTmdbTrendingFeed() retorna [] sem fazer nenhuma chamada.
//
// O que este módulo faz:
//   1. Busca trending/tv/day + trending/tv/week + tv/airing_today via TMDB API
//   2. Busca /tv/{id} para detalhes completos (networks, vote_count, type, etc.)
//   3. Converte cada resultado em IcsSeriesGroup sintético (source="tmdb")
//   4. Passa todos pelo classifyRadarEligibility — mesmas regras do BDS
//   5. Retorna apenas elegíveis, para que o caller faça deduplicação por tmdb_id
//
// O caller (agenda/route.ts) é responsável por:
//   - Descartar grupos cujo tmdb_id já existe no pool BDS (BDS prevalece)
//   - Popular trendingDay/trendingWeek no payload de resposta com os IDs reais
//
// Grupos sintéticos têm:
//   - source: "tmdb"
//   - key: "tmdb-tv-{id}"
//   - sectionMeta.section: "destaques" (trending day) | "novosEpisodios" (week/airing)
//   - episodes: array vazio (sem episódio real rastreado)
//   - relevanceScore: 0 (score editorial é calculado no front via groupEditorialScore)

import type { IcsSeriesGroup, TmdbEnrichment } from "@/lib/ics-engine";
import { refineCategoryFromTmdb } from "@/lib/radar/categories";
import { classifyRealityBySignals } from "@/lib/radar/reality-classifier";
import {
  classifyRadarEligibility,
  createEligibilityDiagnostics,
  accumulateDiagnostics,
} from "@/lib/radar/eligibility";
import { ALL_BLOCKED_CATEGORIES } from "@/lib/ics-engine";
import { tmdbFetchSafe, getTmdbToken } from "@/server/api-clients/tmdb/client";

// ── Feature flag ──────────────────────────────────────────────────────────────
// Lida com dois níveis:
//   1. ENABLE_TMDB_TRENDING_FEED=true no .env  → liga por padrão no boot
//   2. Runtime toggle via /api/admin/tmdb-feed-toggle → sobrescreve sem reiniciar
//
// Nota: em ambientes serverless (Vercel Edge/Lambda) processos são efêmeros —
// o toggle runtime dura até o next cold-start. Use o .env para persistência.

let _runtimeOverride: boolean | null = null; // null = usa o env var

export const TMDB_TRENDING_FEED_ENABLED_BY_ENV =
  process.env.ENABLE_TMDB_TRENDING_FEED === "true";

/** Retorna true se o feed TMDB está ativo (env var OU override runtime). */
export function isTmdbFeedEnabled(): boolean {
  if (_runtimeOverride !== null) return _runtimeOverride;
  return TMDB_TRENDING_FEED_ENABLED_BY_ENV;
}

/** Sobrescreve o flag em runtime. Persiste enquanto o processo estiver vivo. */
export function setTmdbFeedEnabled(enabled: boolean): void {
  _runtimeOverride = enabled;
  console.log(`[tmdb-trending] runtime override: feed ${enabled ? "LIGADO" : "DESLIGADO"}`);
}

/** Reseta o override — volta a usar o valor do .env. */
export function resetTmdbFeedOverride(): void {
  _runtimeOverride = null;
}

// Compat: mantém a constante legada para não quebrar imports existentes
export const TMDB_TRENDING_FEED_ENABLED = TMDB_TRENDING_FEED_ENABLED_BY_ENV;

// ── Tipos TMDB ────────────────────────────────────────────────────────────────

interface TmdbTvItem {
  id: number;
  name: string;
  original_name: string;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  genre_ids?: number[];
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  origin_country?: string[];
  original_language?: string;
  first_air_date?: string | null;
}

interface TmdbPageResponse {
  results: TmdbTvItem[];
  total_pages?: number;
  total_results?: number;
}

interface TmdbTvDetails {
  id: number;
  type?: string | null;
  status?: string | null;
  number_of_seasons?: number | null;
  vote_count?: number;
  networks?: Array<{ id: number; name: string; origin_country?: string }>;
  production_companies?: Array<{ id: number; name: string; origin_country?: string }>;
  clean_backdrop_path?: string | null;
}

// ── Genre name map (mesmos do ics-enricher) ───────────────────────────────────

const GENRE_NAMES: Record<number, string> = {
  10759: "Action & Adventure", 16: "Animation", 35: "Comedy", 80: "Crime",
  99: "Documentary", 18: "Drama", 10751: "Family", 10762: "Kids",
  9648: "Mystery", 10763: "News", 10764: "Reality", 10765: "Sci-Fi & Fantasy",
  10766: "Soap", 10767: "Talk", 10768: "War & Politics", 37: "Western",
};

// ── Fetch helpers ─────────────────────────────────────────────────────────────

const FETCH_TIMEOUT_MS = 8000;
const DETAILS_CONCURRENCY = 8; // max parallel detail fetches

async function fetchPage(path: string, page = 1): Promise<TmdbTvItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const data = await tmdbFetchSafe<TmdbPageResponse>(path, {
    params: { page: String(page) },
    cache: "no-store",
    signal: controller.signal,
  }).finally(() => clearTimeout(timer));
  return data?.results ?? [];
}

async function fetchTvDetails(id: number): Promise<TmdbTvDetails | null> {
  return tmdbFetchSafe<TmdbTvDetails>(`/tv/${id}`, { cache: "no-store" });
}

// Processa um chunk de items em paralelo com concorrência limitada
async function fetchDetailsInBatches(
  items: TmdbTvItem[],
): Promise<Map<number, TmdbTvDetails>> {
  const map = new Map<number, TmdbTvDetails>();
  for (let i = 0; i < items.length; i += DETAILS_CONCURRENCY) {
    const batch = items.slice(i, i + DETAILS_CONCURRENCY);
    const results = await Promise.all(batch.map((item) => fetchTvDetails(item.id)));
    for (let j = 0; j < batch.length; j++) {
      const d = results[j];
      if (d) map.set(batch[j].id, d);
    }
  }
  return map;
}

// ── Converter TmdbTvItem + TmdbTvDetails → IcsSeriesGroup sintético ───────────

function todayStr(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildSyntheticGroup(
  item: TmdbTvItem,
  details: TmdbTvDetails | null,
  section: "destaques" | "novosEpisodios",
  badge: string,
): IcsSeriesGroup {
  const today = todayStr();
  const tmdb_type = details?.type ?? null;

  const initialCategory = "SERIES" as const;
  const refined = refineCategoryFromTmdb(
    initialCategory,
    item.genre_ids ?? [],
    tmdb_type,
  );

  // Tenta promover REALITY com sinais estruturais
  let finalCategory = refined;
  if (refined === "REALITY" || refined === "SERIES") {
    const realityResult = classifyRealityBySignals({
      category: refined,
      tmdbType: tmdb_type ?? undefined,
      genreIds: item.genre_ids ?? [],
      title: item.name,
    });
    if (realityResult.category === "REALITY") finalCategory = "REALITY";
  }

  const tmdb: TmdbEnrichment = {
    tmdb_id:              item.id,
    name:                 item.name,
    original_name:        item.original_name,
    overview:             item.overview ?? null,
    poster_path:          item.poster_path ?? null,
    backdrop_path:        item.backdrop_path ?? null,
    clean_backdrop_path:  null,
    genre_ids:            item.genre_ids ?? [],
    genres:               (item.genre_ids ?? []).map((id) => GENRE_NAMES[id]).filter(Boolean),
    popularity:           item.popularity ?? 0,
    vote_average:         item.vote_average ?? 0,
    vote_count:           details?.vote_count ?? item.vote_count ?? 0,
    number_of_seasons:    details?.number_of_seasons ?? null,
    origin_country:       item.origin_country ?? [],
    original_language:    item.original_language ?? "",
    first_air_date:       item.first_air_date ?? null,
    status:               details?.status ?? null,
    networks:             (details?.networks ?? []).map((n) => ({ id: n.id, name: n.name, logo_path: null as string | null, origin_country: n.origin_country ?? "" })),
    production_companies: (details?.production_companies ?? []).map((c) => ({ id: c.id, name: c.name, logo_path: null as string | null, origin_country: c.origin_country ?? "" })),
    tmdb_type,
    refined_category:     finalCategory,
  };

  const group: IcsSeriesGroup = {
    key:           `tmdb-tv-${item.id}`,
    rawTitle:      item.name,
    source:        "tmdb",
    sourceTag:     `tmdb_trending_${section}`,
    category:      finalCategory,
    episodeCount:  0,
    nextAirDate:   today,
    lastAirDate:   today,
    spanDays:      0,
    episodes:      [],
    seasons:       [],
    relevanceScore: 0,
    isRelevant:    true,
    tmdb,
    sectionMeta: {
      section:          section === "destaques" ? "destaques" : "novosEpisodios",
      badge,
      reason:           `tmdb_trending_${section}`,
      episodeDate:      today,
      selectedEpisode:  { season: 0, episode: 0 },
    },
  };

  return group;
}

// ── Pipeline principal ────────────────────────────────────────────────────────

export interface TmdbTrendingResult {
  groups: IcsSeriesGroup[];
  /** IDs dos itens que apareceram em trending/day — para popular trendingDay no payload */
  trendingDayIds: number[];
  /** IDs dos itens que apareceram em trending/week */
  trendingWeekIds: number[];
  stats: {
    fetchedDay: number;
    fetchedWeek: number;
    fetchedAiring: number;
    blockedStructural: number;
    blockedEligibility: number;
    passed: number;
  };
}

export async function fetchTmdbTrendingFeed(): Promise<TmdbTrendingResult> {
  const empty: TmdbTrendingResult = {
    groups: [],
    trendingDayIds: [],
    trendingWeekIds: [],
    stats: { fetchedDay: 0, fetchedWeek: 0, fetchedAiring: 0, blockedStructural: 0, blockedEligibility: 0, passed: 0 },
  };

  // ── Feature flag ────────────────────────────────────────────────────────────
  if (!isTmdbFeedEnabled()) return empty;

  try {
    getTmdbToken(); // validate token is present
  } catch {
    console.warn("[tmdb-trending] TMDB_ACCESS_TOKEN não configurado — feed desabilitado");
    return empty;
  }

  console.log("[tmdb-trending] iniciando fetch (day + week + airing_today)...");
  const t0 = Date.now();

  // ── 1. Fetch paralelo das 3 fontes ─────────────────────────────────────────
  const [dayItems, weekItems, airingP1, airingP2] = await Promise.all([
    fetchPage("/trending/tv/day",    1),
    fetchPage("/trending/tv/week",   1),
    fetchPage("/tv/airing_today",    1),
    fetchPage("/tv/airing_today",    2),
  ]);

  const airingItems = [...airingP1, ...airingP2];

  console.log(
    `[tmdb-trending] fetched: day=${dayItems.length}` +
    ` week=${weekItems.length}` +
    ` airing=${airingItems.length}`,
  );

  // ── 2. Consolidar lista única, deduplicando por tmdb_id ────────────────────
  const trendingDayIds   = new Set(dayItems.map((i) => i.id));
  const trendingWeekIds  = new Set(weekItems.map((i) => i.id));

  const allItemsMap = new Map<number, { item: TmdbTvItem; section: "destaques" | "novosEpisodios"; badge: string }>();

  // Airing primeiro (menor prioridade) — será sobrescrito por trending
  for (const item of airingItems) {
    allItemsMap.set(item.id, { item, section: "novosEpisodios", badge: "No ar hoje" });
  }
  // Trending week sobrescreve airing
  for (const item of weekItems) {
    allItemsMap.set(item.id, { item, section: "novosEpisodios", badge: "Trending" });
  }
  // Trending day tem prioridade máxima
  for (const item of dayItems) {
    allItemsMap.set(item.id, { item, section: "destaques", badge: "Em alta hoje" });
  }

  const consolidated = [...allItemsMap.values()];

  // ── 3. Buscar detalhes completos em batches ────────────────────────────────
  const allItems = consolidated.map((e) => e.item);
  const detailsMap = await fetchDetailsInBatches(allItems);

  console.log(
    `[tmdb-trending] detalhes buscados: ${detailsMap.size}/${allItems.length}` +
    ` em ${Date.now() - t0}ms`,
  );

  // ── 4. Converter → IcsSeriesGroup + filtrar por eligibility ───────────────
  const eligDiag = createEligibilityDiagnostics();
  let blockedStructural = 0;
  let blockedEligibility = 0;
  const passed: IcsSeriesGroup[] = [];

  for (const { item, section, badge } of consolidated) {
    const details = detailsMap.get(item.id) ?? null;

    // Monta grupo sintético para poder avaliar categoria
    const group = buildSyntheticGroup(item, details, section, badge);
    const refinedCat = group.tmdb!.refined_category ?? group.category;

    // 4a. Filtro estrutural (categorias sempre bloqueadas)
    if (ALL_BLOCKED_CATEGORIES.has(refinedCat)) {
      blockedStructural++;
      continue;
    }

    // 4b. Filtro editorial — mesmas regras do pipeline BDS
    const eligResult = classifyRadarEligibility({
      title:               group.tmdb!.name,
      category:            refinedCat,
      tmdbType:            group.tmdb!.tmdb_type ?? null,
      genreIds:            group.tmdb!.genre_ids,
      originalLanguage:    group.tmdb!.original_language,
      originCountry:       group.tmdb!.origin_country,
      overview:            group.tmdb!.overview,
      keywords:            null,
      popularity:          group.tmdb!.popularity,
      voteCount:           group.tmdb!.vote_count,
      voteAverage:         group.tmdb!.vote_average,
      networks:            group.tmdb!.networks?.map((n) => ({
        id: n.id, name: n.name, origin_country: n.origin_country,
      })) ?? null,
      productionCompanies: group.tmdb!.production_companies?.map((c) => ({
        id: c.id, name: c.name, origin_country: c.origin_country,
      })) ?? null,
      brazilProviders:     null,
      hasTmdb:             true,
      relevanceScore:      null,
    });

    accumulateDiagnostics(eligDiag, eligResult, group.tmdb!.name);

    if (!eligResult.eligible) {
      blockedEligibility++;
      continue;
    }

    passed.push(group);
  }

  const stats = {
    fetchedDay:        dayItems.length,
    fetchedWeek:       weekItems.length,
    fetchedAiring:     airingItems.length,
    blockedStructural,
    blockedEligibility,
    passed:            passed.length,
  };

  console.log(
    `[tmdb-trending] resultado: total_único=${consolidated.length}` +
    ` bloq_estrutural=${blockedStructural}` +
    ` bloq_editorial=${blockedEligibility}` +
    ` passou=${passed.length}` +
    ` tempo=${Date.now() - t0}ms`,
  );

  return {
    groups:         passed,
    trendingDayIds: [...trendingDayIds],
    trendingWeekIds: [...trendingWeekIds],
    stats,
  };
}
