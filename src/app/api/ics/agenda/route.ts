// -- /api/ics/agenda ────────────────────────────────────────────────────────────
// Pipeline: ICS fetch -> parse -> engine -> enriquecimento TMDB -> resposta JSON.
//
// REGRA DE FONTE (permanente):
//   Series/episodios: Banco de Series (ICS) e a UNICA fonte de entrada no Radar.
//   TMDB so age sobre titulos que ja vieram do BDS: enriquecimento, metadata, imagens,
//   retrofill de episodios e IDs. NUNCA cria grupos novos de serie.
//
//   Cinema: TMDB pode ser fonte ativa exclusivamente para estreias de filme
//   (eventType: "movie_theatrical_release", source: "tmdb_cinema_release").
//
// Cache persistente (tabela ics_agenda_cache, TTL 24h):
//   - GET: le cache primeiro; se fresco (<24h) retorna imediatamente.
//   - Se stale ou ausente: executa pipeline completo, salva no cache, retorna.
// ──────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { parseIcsContent } from "@/lib/ics-parser";
import {
  runIcsEngine, computeStats, ALL_BLOCKED_CATEGORIES,
  classifyTitle,
} from "@/lib/ics-engine";
import type { IcsSeriesGroup, IcsEngineStats, MovieGroup, CinemaReleaseGroup, TmdbEnrichment, TmdbNetwork, TmdbProductionCompany } from "@/lib/ics-engine";
import { refineCategoryFromTmdb } from "@/lib/radar/categories";
import { db } from "@/server/db/client";
import { classifyRealityBySignals } from "@/lib/radar/reality-classifier";
import {
  classifyRadarEligibility,
  createEligibilityDiagnostics,
  accumulateDiagnostics,
  logEligibilityDiagnostics,
} from "@/lib/radar/eligibility";
import {
  fetchTmdbTrendingFeed,
  isTmdbFeedEnabled,
} from "@/lib/radar/tmdb-trending-feed";

// Nao usar cache do Next.js — gerenciamos o cache manualmente no banco
export const revalidate = 0;

const ICS_URL    = "http://bancodeseries.com.br/ical.php";
const CACHE_ID   = "main";
const CACHE_TTL_H = 24; // horas
const CACHE_SCHEMA_VERSION = 10; // bumped: collapse por serie+temporada ativo
const MEMORY_CACHE_TTL_MS = 5 * 60_000;
const DEBUG_RADAR = process.env.DEBUG_RADAR === "true";
const DEBUG_TITLES = [/rupaul/i, /drag race/i, /tonight show/i, /jimmy fallon/i, /euphoria/i, /pela metade/i];

let memoryCache:
  | { payload: IcsAgendaResponse; cachedAt: string; expiresAt: number }
  | null = null;

const TV_GENRE_NAMES: Record<number, string> = {
  10759: "Acao & Aventura", 16: "Animacao", 35: "Comedia", 80: "Crime",
  99: "Documentario", 18: "Drama", 10751: "Familia", 10762: "Kids",
  9648: "Misterio", 10763: "Noticias", 10764: "Reality", 10765: "Ficcao Cientifica",
  10766: "Soap", 10767: "Talk", 10768: "Guerra & Politica", 37: "Faroeste",
};

const MOVIE_GENRE_NAMES: Record<number, string> = {
  28: "Acao", 12: "Aventura", 16: "Animacao", 35: "Comedia", 80: "Crime",
  99: "Documentario", 18: "Drama", 10751: "Familia", 14: "Fantasia",
  36: "Historia", 27: "Terror", 10402: "Musica", 9648: "Misterio",
  10749: "Romance", 878: "Ficcao Cientifica", 10770: "TV Movie",
  53: "Thriller", 10752: "Guerra", 37: "Faroeste",
};

// TV_GENRE_NAMES now used by local-db enrichment
void MOVIE_GENRE_NAMES;

// ── Helpers de extração de gêneros (JSON do DB local) ─────────────────────────

function extractLocalGenreIds(genres: unknown): number[] {
  if (!Array.isArray(genres)) return [];
  return genres.flatMap((g) => {
    if (typeof g === "number") return [g];
    if (g && typeof g === "object" && typeof (g as { id?: unknown }).id === "number") {
      return [(g as { id: number }).id];
    }
    return [];
  });
}

function extractLocalGenreNames(genres: unknown): string[] {
  if (!Array.isArray(genres)) return [];
  return genres.flatMap((g) => {
    if (g && typeof g === "object") {
      const obj = g as { name?: unknown; id?: unknown };
      if (typeof obj.name === "string") return [obj.name];
      if (typeof obj.id === "number") return [TV_GENRE_NAMES[obj.id] ?? ""].filter(Boolean);
    }
    return [];
  });
}

// Normaliza título para matching case-insensitive e sem pontuação
function normalizeForMatch(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[''`]/g, "'")
    .replace(/[^\w\s']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Converte linha do Poplog3Title em TmdbEnrichment compatível com o pipeline ICS.
// Mantém nomes de campos snake_case para compatibilidade com código existente.
function poplogRowToEnrichment(
  row: Awaited<ReturnType<typeof db.poplog3Title.findMany>>[number],
  fallbackTitle: string,
): TmdbEnrichment {
  const payload = (row.tmdbPayload ?? {}) as Record<string, unknown>;

  const originCountry: string[] = Array.isArray(payload.origin_country)
    ? (payload.origin_country as unknown[]).filter((c): c is string => typeof c === "string")
    : [];

  const networks: TmdbNetwork[] = Array.isArray(payload.networks)
    ? (payload.networks as unknown[]).flatMap((n) => {
        const obj = n as Record<string, unknown>;
        if (typeof obj.id === "number" && typeof obj.name === "string") {
          return [{
            id: obj.id,
            name: obj.name,
            logo_path: typeof obj.logo_path === "string" ? obj.logo_path : null,
            origin_country: typeof obj.origin_country === "string" ? obj.origin_country : "",
          }];
        }
        return [];
      })
    : [];

  const productionCompanies: TmdbProductionCompany[] = Array.isArray(payload.production_companies)
    ? (payload.production_companies as unknown[]).flatMap((c) => {
        const obj = c as Record<string, unknown>;
        if (typeof obj.id === "number" && typeof obj.name === "string") {
          return [{
            id: obj.id,
            name: obj.name,
            logo_path: typeof obj.logo_path === "string" ? obj.logo_path : null,
            origin_country: typeof obj.origin_country === "string" ? obj.origin_country : "",
          }];
        }
        return [];
      })
    : [];

  const genreIds = extractLocalGenreIds(row.genres);
  const genreNames = extractLocalGenreNames(row.genres);

  return {
    tmdb_id: row.tmdbId,
    name: row.title ?? row.originalTitle ?? fallbackTitle,
    original_name: row.originalTitle ?? row.title ?? fallbackTitle,
    overview: row.overview ?? null,
    poster_path: row.posterPath ?? null,
    backdrop_path: row.backdropPath ?? null,
    genre_ids: genreIds,
    genres: genreNames,
    popularity: row.popularity ? Number(row.popularity) : 0,
    vote_average: row.voteAverage ? Number(row.voteAverage) : 0,
    vote_count: row.voteCount ?? 0,
    number_of_seasons: row.numberOfSeasons ?? null,
    origin_country: originCountry,
    original_language: row.originalLanguage ?? "en",
    first_air_date: row.firstAirDate ? row.firstAirDate.toISOString().slice(0, 10) : null,
    status: typeof payload.status === "string" ? payload.status : null,
    networks,
    production_companies: productionCompanies,
  };
}

// Enriquece grupos ICS sem tmdb usando Poplog3Title local (in-memory matching).
async function localDbEnrichGroups(groups: IcsSeriesGroup[]): Promise<void> {
  const unenriched = groups.filter((g) => !g.tmdb);
  if (unenriched.length === 0) return;

  try {
    const rows = await db.poplog3Title.findMany({
      where: { mediaType: "tv" },
    });

    const byTitle = new Map<string, typeof rows[0]>();
    for (const row of rows) {
      if (row.title) byTitle.set(normalizeForMatch(row.title), row);
      if (row.originalTitle) byTitle.set(normalizeForMatch(row.originalTitle), row);
    }

    let enriched = 0;
    for (const group of unenriched) {
      const key = normalizeForMatch(group.rawTitle);
      const row = byTitle.get(key);
      if (!row) continue;

      group.tmdb = poplogRowToEnrichment(row, group.rawTitle);

      const refined = refineCategoryFromTmdb(
        group.category,
        group.tmdb.genre_ids,
        group.tmdb.tmdb_type ?? null,
      );
      if (refined !== group.category) {
        group.tmdb.refined_category = refined;
        group.category = refined;
      }

      enriched++;
    }

    if (enriched > 0) {
      console.log(`[ics-agenda] local-db-enrich: ${enriched}/${unenriched.length} grupos enriquecidos do Poplog3Title`);
    }
  } catch (err) {
    console.warn("[ics-agenda] local-db-enrich error:", err);
  }
}

function shouldDebugTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return DEBUG_TITLES.some((pattern) => pattern.test(title));
}

function radarDebugTitle(data: {
  title: string;
  source?: string | null;
  tmdbId?: number | null;
  date?: string | null;
  section?: string | null;
  category?: string | null;
  blocked?: boolean;
  reason?: string | null;
}) {
  if (!DEBUG_RADAR && !shouldDebugTitle(data.title)) return;
  console.log(
    `[radar-debug-title] title="${data.title}" source=${data.source ?? "_"} ` +
    `tmdbId=${data.tmdbId ?? "_"} date=${data.date ?? "_"} section=${data.section ?? "_"} ` +
    `category=${data.category ?? "_"} blocked=${data.blocked ? "true" : "false"} ` +
    `reason=${data.reason ?? "_"}`,
  );
}

function radarFilterLog(title: string, reason: string) {
  if (!DEBUG_RADAR && !shouldDebugTitle(title)) return;
  console.log(`[radar-filter] blocked title="${title}" reason="${reason}"`);
}

export interface RadarSections {
  /** Grupos com episodio nos ultimos 3 dias ate hoje — Destaques */
  today: IcsSeriesGroup[];
  /** Grupos com episodio amanhã ate +7 dias — Novos Episodios */
  thisWeek: IcsSeriesGroup[];
  /** Grupos com episodio +8 ate +30 dias + marcos E01 — Vem Ai */
  next30Days: IcsSeriesGroup[];
  /** Estreias de cinema — Destaques: ultimos 10 dias ate hoje */
  cinemaToday: CinemaReleaseGroup[];
  /** Estreias de cinema — Novidades: amanha ate +10 dias */
  cinemaThisWeek: CinemaReleaseGroup[];
  /** Estreias de cinema — Vem Ai: +11 dias em diante */
  cinemaNext: CinemaReleaseGroup[];
}

export interface IcsAgendaResponse {
  groups: IcsSeriesGroup[];
  featuredGroups: IcsSeriesGroup[];
  secondaryGroups: IcsSeriesGroup[];
  /** Filmes em cartaz/estreando — mantido por compatibilidade, sempre vazio */
  movies?: MovieGroup[];
  /** Estreias de cinema rastreadas por data de estreia teatral — fonte: TMDB */
  cinemaReleases?: CinemaReleaseGroup[];
  /** Featured groups particionados por janela temporal */
  sections?: RadarSections;
  stats: IcsEngineStats;
  fetchedAt: string;
  source: string;
  pendingEnrichment: number;
  /** Mantidos por compatibilidade — sempre [] no pipeline unificado */
  trendingDay: number[];
  trendingWeek: number[];
  fromCache: boolean;
  cachedAt?: string;
  cacheVersion?: number;
}

// fetchTmdbTvList — DESATIVADO.
// Nao usar para series ativas. TMDB e apenas enriquecimento de titulos BDS.

// fetchActiveTmdbSeries — REMOVIDO PERMANENTEMENTE.
//
// Esta funcao injetava series TMDB como grupos ativos no Radar via:
//   trending/tv/day, trending/tv/week, tv/airing_today, tv/on_the_air,
//   discover/tv (discover_new_series), discover/tv (discover_upcoming_series).
//
// Regra arquitetural: Banco de Series (ICS) e a UNICA fonte de entrada de series.
// TMDB so pode enriquecer titulos ja vindos do BDS — nunca criar grupos novos.

// fetchMoviesBR (now_playing / upcoming) — REMOVIDO.
// Era o pipeline antigo de "filmes em cartaz" via /movie/now_playing e /movie/upcoming.
// Substituido integralmente por fetchCinemaReleasesBR, que usa data de estreia teatral
// (eventType:"movie_theatrical_release", source:"tmdb_cinema_release") e calendario preciso.

// ── Fetch estreias de cinema BR via TMDB ─────────────────────────────────────
//
// Estrategia de data:
//   1. Busca /movie/{id}/release_dates -> procura entry BR (iso_3166_1="BR")
//   2. Dentro de BR, filtra type=3 (Theatrical) — descarta type=4 (Digital), 5 (Physical)
//   3. Se nao houver data BR theatrical -> usa release_date global como fallback
//   4. Marca dateConfidence: cinema_br_confirmed | cinema_global_fallback | cinema_date_uncertain
//
// Janela de busca: ultimos 10 dias ate +30 dias a partir de hoje.
// Retorna apenas filmes com date confidence confirmada ou global — descarta uncertain.

// ── Verificar cache persistente ───────────────────────────────────────────────

async function readCache(): Promise<{ payload: IcsAgendaResponse; cachedAt: string } | null> {
  try {
    if (memoryCache && memoryCache.expiresAt > Date.now()) {
      console.log("[ICS Agenda] memory cache hit");
      return {
        payload: memoryCache.payload,
        cachedAt: memoryCache.cachedAt,
      };
    }

    const local = await import("@/server/local-services/ics-agenda-cache-local.service");
    const cached = await local.readCache<IcsAgendaResponse>({
      id: CACHE_ID,
      ttlHours: CACHE_TTL_H,
      cacheVersion: CACHE_SCHEMA_VERSION,
    });

    if (cached) {
      console.log("[ICS Agenda] local cache hit");
      memoryCache = {
        payload: cached.payload,
        cachedAt: cached.cachedAt,
        expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
      };
      return cached;
    }

    return null;
  } catch (err) {
    console.warn("[ICS Agenda] erro ao ler cache:", err);
    return null;
  }
}

async function writeCache(payload: IcsAgendaResponse): Promise<void> {
  try {
    const cachedAt = new Date().toISOString();
    const local = await import("@/server/local-services/ics-agenda-cache-local.service");
    const ok = await local.writeCache(payload, {
      id: CACHE_ID,
      cachedAt: new Date(cachedAt),
    });

    if (ok) {
      memoryCache = {
        payload,
        cachedAt,
        expiresAt: Date.now() + MEMORY_CACHE_TTL_MS,
      };
      console.log("[ICS Agenda] cache salvo no MySQL local");
    } else {
      console.warn("[ICS Agenda] cache local recusou gravacao");
    }
  } catch (err) {
    console.warn("[ICS Agenda] erro ao salvar cache:", err);
  }
}

// ── Reclassificacao de Reality ────────────────────────────────────────────────
//
// Apos refineCategoryFromTmdb, se a categoria resultou em REALITY, tenta promover
// a REALITY_PREMIUM usando sinais editoriais (formato, cadencia, rede/produtora).
// Categorias diferentes de REALITY passam inalteradas.

function applyRealityClassifier(
  currentCategory: import("@/lib/radar/categories").ContentCategory,
  input: {
    title: string;
    overview?: string | null;
    genreIds?: number[];
    tmdbType?: string | null;
    eventDate?: string | null;
    episodeCount?: number | null;
    spanDays?: number | null;
    popularity?: number | null;
    voteAverage?: number | null;
    voteCount?: number | null;
    originalLanguage?: string | null;
    originCountry?: string[] | null;
    backdropPath?: string | null;
    posterPath?: string | null;
    networks?: Array<{ id?: number | null; name?: string | null }> | null;
    productionCompanies?: Array<{ id?: number | null; name?: string | null }> | null;
  },
): import("@/lib/radar/categories").ContentCategory {
  if (currentCategory !== "REALITY") return currentCategory;

  const result = classifyRealityBySignals({
    title: input.title,
    overview: input.overview,
    category: currentCategory,
    genreIds: input.genreIds,
    tmdbType: input.tmdbType,
    eventDate: input.eventDate,
    episodeCount: input.episodeCount,
    spanDays: input.spanDays,
    popularity: input.popularity,
    voteAverage: input.voteAverage,
    voteCount: input.voteCount,
    originalLanguage: input.originalLanguage,
    originCountry: input.originCountry,
    backdropPath: input.backdropPath,
    posterPath: input.posterPath,
    networks: input.networks,
    productionCompanies: input.productionCompanies,
  });

  if (result.blocked) return currentCategory;

  if (DEBUG_RADAR || shouldDebugTitle(input.title)) {
    console.log(
      `[reality-classifier] title="${input.title}" score=${result.score} ` +
      `category=${result.category} reason=${result.reason} ` +
      `signals=${result.signals.map((s) => `${s.key}:${s.value}`).join(",")}`,
    );
  }

  return result.category; // REALITY_PREMIUM ou REALITY
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

  // 4. Cinema releases — TMDB removed; skipped permanently.
  const cinemaReleases: CinemaReleaseGroup[] = [];

  // Serie TMDB ativas: ZERO. Log permanente de conformidade.
  console.log(`[radar-source] ics=${groups.length} tmdbSeries=0 cinema=0 (tmdb_disabled)`);

  // 5. Enriquecimento local: popula group.tmdb a partir de Poplog3Title (local DB).
  //    Substitui o enriquecimento TMDB desativado. Usa matching de título normalizado.
  //    Silencioso em falha — grupos sem match ficam com tmdb=null (mostrados com rawTitle).
  await localDbEnrichGroups(groups);

  // 6. Pos-enriquecimento: reclassificacao de reality.
  //    Sem score editorial — relevanceScore nao e mais calculado nem usado para ordenacao.
  for (const g of groups) {
    if (!g.tmdb) continue;

    const rawCat = g.tmdb.refined_category ?? g.category;
    if (rawCat === "REALITY") {
      const promoted = applyRealityClassifier("REALITY", {
        title: g.tmdb.name ?? g.rawTitle,
        overview: g.tmdb.overview ?? null,
        genreIds: g.tmdb.genre_ids ?? [],
        tmdbType: g.tmdb.tmdb_type ?? null,
        eventDate: g.nextAirDate ?? null,
        episodeCount: g.episodeCount ?? null,
        spanDays: g.spanDays ?? null,
        popularity: g.tmdb.popularity ?? null,
        voteAverage: g.tmdb.vote_average ?? null,
        voteCount: g.tmdb.vote_count ?? null,
        originalLanguage: g.tmdb.original_language ?? null,
        originCountry: g.tmdb.origin_country ?? null,
        backdropPath: g.tmdb.backdrop_path ?? null,
        posterPath: g.tmdb.poster_path ?? null,
        networks: g.tmdb.networks ?? null,
        productionCompanies: g.tmdb.production_companies ?? null,
      });
      if (promoted === "REALITY_PREMIUM") {
        g.category = "REALITY_PREMIUM";
        g.tmdb.refined_category = "REALITY_PREMIUM";
      }
    }

    // Marca todos como relevantes — sem threshold de score
    g.isRelevant = true;
  }

  // ── 6b. Deduplicacao pos-enriquecimento: grupos ICS com mesmo tmdb_id ────────
  // Apos o enriquecimento, dois grupos ICS podem ter o mesmo tmdb_id.
  // Casos possiveis:
  //   A) "The Assembly" e "The Assembly UK" -> ambos resolveram para tmdb:290057.
  //      Se um tem variantCountry e o outro nao, sao variantes regionais: PRESERVAR ambos.
  //   B) Mesmo titulo normalizado de forma ligeiramente diferente -> deduplicar fundindo
  //      episodios no grupo com maior relevanceScore (ou primeiro encontrado).
  //
  // Regra: grupos com mesmo tmdb_id E pelo menos dois com variantCountry distintos
  //        sao variantes legitimas — preservar todos.

  const tmdbIdToGroups = new Map<number, IcsSeriesGroup[]>();
  for (const g of groups) {
    if (!g.tmdb?.tmdb_id) continue;
    const arr = tmdbIdToGroups.get(g.tmdb.tmdb_id) ?? [];
    arr.push(g);
    tmdbIdToGroups.set(g.tmdb.tmdb_id, arr);
  }

  const dedupedIcsGroups = new Set<string>(); // keys a remover

  for (const [tmdbId, sameIdGroups] of tmdbIdToGroups) {
    if (sameIdGroups.length <= 1) continue;

    const variantCountries = sameIdGroups
      .map((g) => g.variantCountry)
      .filter((v): v is string => !!v);
    const distinctVariants = new Set(variantCountries);

    const isLegitimateVariant = distinctVariants.size >= 2;

    if (isLegitimateVariant) {
      console.log(
        `[radar-dedup] same_tmdb_multiple_raw_titles VARIANTES DISTINTAS — tmdb_id=${tmdbId}` +
        ` count=${sameIdGroups.length}` +
        ` rawTitles=[${sameIdGroups.map((g) => `"${g.rawTitle}"(${g.variantCountry ?? "base"})`).join(", ")}]` +
        ` — PRESERVANDO`,
      );
    } else {
      // Um ou mais grupos sem variantCountry resolveram para o mesmo tmdb_id.
      // Funde tudo no grupo mais especifico (com variantCountry) ou no primeiro.
      sameIdGroups.sort((a, b) => {
        const aHas = a.variantCountry ? 1 : 0;
        const bHas = b.variantCountry ? 1 : 0;
        if (aHas !== bHas) return bHas - aHas;
        return 0;
      });
      const primary = sameIdGroups[0];
      for (const g of sameIdGroups.slice(1)) {
        const existingEpKeys = new Set(
          primary.episodes.map((ep) => `${ep.startAt.slice(0,10)}-s${ep.season}-e${ep.episode}`),
        );
        for (const ep of g.episodes) {
          const k = `${ep.startAt.slice(0,10)}-s${ep.season}-e${ep.episode}`;
          if (!existingEpKeys.has(k)) {
            primary.episodes.push(ep);
            existingEpKeys.add(k);
          }
        }
        primary.episodeCount = primary.episodes.length;
        primary.episodes.sort((a, b) => a.startAt.localeCompare(b.startAt));
        dedupedIcsGroups.add(g.key);
        console.log(
          `[radar-dedup] same_tmdb_merge — tmdb_id=${tmdbId}` +
          ` descartando="${g.rawTitle}"(${g.variantCountry ?? "base"}) mantendo="${primary.rawTitle}"(${primary.variantCountry ?? "base"})`,
        );
      }
    }
  }

  const groupsAfterIcsDedup = dedupedIcsGroups.size > 0
    ? groups.filter((g) => !dedupedIcsGroups.has(g.key))
    : groups;

  // ── TMDB Trending Feed (feature flag: ENABLE_TMDB_TRENDING_FEED=true) ────────
  // Quando ativo: busca trending/tv/day + week + airing_today e mescla com BDS.
  // BDS sempre prevalece: se o tmdb_id já existe no pool ICS, o grupo sintético é descartado.
  // Quando inativo: unifiedGroups = groupsAfterIcsDedup (comportamento histórico).
  let trendingDayIds:  number[] = [];
  let trendingWeekIds: number[] = [];
  let unifiedGroups = groupsAfterIcsDedup;
  let tmdbTrendingAdded = 0; // grupos sintéticos novos (não duplicados com BDS)

  if (isTmdbFeedEnabled()) {
    const trendingFeed = await fetchTmdbTrendingFeed();
    trendingDayIds  = trendingFeed.trendingDayIds;
    trendingWeekIds = trendingFeed.trendingWeekIds;

    if (trendingFeed.groups.length > 0) {
      // Conjunto de tmdb_ids já presentes no BDS — BDS prevalece
      const bdsIds = new Set(
        groupsAfterIcsDedup.map((g) => g.tmdb?.tmdb_id).filter((id): id is number => id != null),
      );
      const newFromTmdb = trendingFeed.groups.filter(
        (g) => g.tmdb?.tmdb_id != null && !bdsIds.has(g.tmdb.tmdb_id),
      );
      tmdbTrendingAdded = newFromTmdb.length;
      unifiedGroups = [...groupsAfterIcsDedup, ...newFromTmdb];
      console.log(
        `[tmdb-trending-merge] bds=${groupsAfterIcsDedup.length}` +
        ` tmdb_elegíveis=${trendingFeed.groups.length}` +
        ` tmdb_novos=${newFromTmdb.length}` +
        ` (stats: day=${trendingFeed.stats.fetchedDay} week=${trendingFeed.stats.fetchedWeek}` +
        ` airing=${trendingFeed.stats.fetchedAiring}` +
        ` bloq_estrutural=${trendingFeed.stats.blockedStructural}` +
        ` bloq_editorial=${trendingFeed.stats.blockedEligibility})` +
        ` total=${unifiedGroups.length}`,
      );
    }
  }

  // 7. Filtro estrutural — bloqueia categorias que nunca devem aparecer no Radar.
  //    Isso e um filtro tecnico (SPORTS, NEWS, PODCAST, LIVE_EVENT, VARIETY, etc.),
  //    nao editorial. Nenhum score ou regra de curadoria envolvida.
  const isHiddenGroup = (g: IcsSeriesGroup): boolean =>
    ALL_BLOCKED_CATEGORIES.has(g.category) ||
    ALL_BLOCKED_CATEGORIES.has(g.tmdb?.refined_category ?? g.category);

  const visibleGroups: IcsSeriesGroup[] = [];
  let blockedStructural = 0;
  const eligibilityDiag = createEligibilityDiagnostics();
  let blockedEditorial = 0;

  for (const group of unifiedGroups) {
    const refinedCat = group.tmdb?.refined_category ?? group.category;

    // 7a. Filtro estrutural por categoria (tecnico — nao editorial)
    if (isHiddenGroup(group)) {
      blockedStructural++;
      radarFilterLog(
        group.tmdb?.name ?? group.rawTitle,
        refinedCat === "VARIETY" ? "talk_show_or_late_show" : `blocked_category_${refinedCat}`,
      );
      radarDebugTitle({
        title: group.tmdb?.name ?? group.rawTitle,
        source: group.source ?? "ics",
        tmdbId: group.tmdb?.tmdb_id ?? null,
        date: group.nextAirDate,
        category: refinedCat,
        blocked: true,
        reason: `blocked_category_${refinedCat}`,
      });
      continue;
    }

    // 7b. Filtro editorial de elegibilidade — classifyRadarEligibility()
    //    Avalia metadados, gêneros, keywords, networks, país, popularidade e sinais
    //    editoriais para filtrar conteúdo estruturalmente inadequado para o Radar:
    //    soap/dorama, infantil, religioso de nicho, factual local, reality de nicho,
    //    lifestyle regional, baixa relevância para o Brasil, baixo sinal editorial.
    const eligibilityTitle = group.tmdb?.name ?? group.rawTitle;
    const eligResult = classifyRadarEligibility({
      title: eligibilityTitle,
      category: refinedCat,
      tmdbType: group.tmdb?.tmdb_type ?? null,
      genreIds: group.tmdb?.genre_ids ?? null,
      originalLanguage: group.tmdb?.original_language ?? null,
      originCountry: group.tmdb?.origin_country ?? null,
      overview: group.tmdb?.overview ?? null,
      keywords: null,  // TMDB keywords não são buscadas no pipeline atual
      popularity: group.tmdb?.popularity ?? null,
      voteCount: group.tmdb?.vote_count ?? null,
      voteAverage: group.tmdb?.vote_average ?? null,
      networks: group.tmdb?.networks?.map((n) => ({ id: n.id, name: n.name, origin_country: n.origin_country })) ?? null,
      productionCompanies: group.tmdb?.production_companies?.map((c) => ({ id: c.id, name: c.name, origin_country: c.origin_country })) ?? null,
      brazilProviders: null,  // providers BR não disponíveis neste ponto do pipeline
      hasTmdb: !!group.tmdb,
      relevanceScore: group.relevanceScore ?? null,
    });

    accumulateDiagnostics(eligibilityDiag, eligResult, eligibilityTitle);

    if (!eligResult.eligible) {
      blockedEditorial++;
      radarFilterLog(eligibilityTitle, eligResult.reason);
      radarDebugTitle({
        title: eligibilityTitle,
        source: group.source ?? "ics",
        tmdbId: group.tmdb?.tmdb_id ?? null,
        date: group.nextAirDate,
        category: refinedCat,
        blocked: true,
        reason: eligResult.reason,
      });
      if (DEBUG_RADAR) {
        console.log(
          `[eligibility] blocked title="${eligibilityTitle}"` +
          ` reason=${eligResult.reason}` +
          ` signals=[${eligResult.signals.join(",")}]`,
        );
      }
      continue;
    }

    radarDebugTitle({
      title: eligibilityTitle,
      source: group.source ?? "ics",
      tmdbId: group.tmdb?.tmdb_id ?? null,
      date: group.nextAirDate,
      category: refinedCat,
      blocked: false,
    });
    visibleGroups.push(group);
  }

  // Log de diagnóstico de elegibilidade (sempre — para calibração)
  logEligibilityDiagnostics(eligibilityDiag);

  // Todos os grupos visiveis sao "featured" — sem split editorial por categoria.
  // A divisao featured/secondary e preservada na interface por compatibilidade.
  const featuredGroups  = visibleGroups;
  const secondaryGroups: IcsSeriesGroup[] = [];

  // 8. Estatisticas
  const allVisibleGroups = [...featuredGroups, ...secondaryGroups];
  const stats = computeStats(allVisibleGroups, events.length);

  const pendingEnrichment = featuredGroups.filter((g) => !g.tmdb).length;

  // movies[] (now_playing / upcoming) removido — substituido por cinemaReleases (estreia teatral).
  const movies: import("@/lib/ics-engine").MovieGroup[] = [];

  // -- Log de filtros aplicados (servidor) ---------------------------------
  const totalFromIcs  = groups.length;
  const withTmdb      = unifiedGroups.filter((g) => !!g.tmdb).length;
  const hiddenBlocked = blockedStructural;
  const editorialBlocked = blockedEditorial;
  const noTmdbPending = featuredGroups.filter((g) => !g.tmdb).length;

  const catCount: Record<string, number> = {};
  for (const g of featuredGroups) {
    const cat = g.tmdb?.refined_category ?? g.category;
    catCount[cat] = (catCount[cat] ?? 0) + 1;
  }

  const langCount: Record<string, number> = {};
  for (const g of featuredGroups) {
    const lang = g.tmdb?.original_language ?? "_sem_tmdb";
    langCount[lang] = (langCount[lang] ?? 0) + 1;
  }
  const topLangs = Object.entries(langCount)
    .sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([l, n]) => l + ":" + n).join("  ");

  const catSummary = Object.entries(catCount).map(([k, v]) => k + ":" + v).join("  ");

  console.log(
    "\n+- [ICS Agenda] PIPELINE RESUMO -----------------------------------\n" +
    "|  ICS -> grupos brutos     : " + totalFromIcs + "\n" +
    "|  TMDB -> trending feed    : " + (isTmdbFeedEnabled() ? tmdbTrendingAdded + " novos" : "desligado (flag off)") + "\n" +
    "|  TMDB -> cinema estreias  : " + cinemaReleases.length + "\n" +
    "|  Com TMDB enriquecido    : " + withTmdb + " / " + unifiedGroups.length + "\n" +
    "|  Bloqueados estruturais  : " + hiddenBlocked + "\n" +
    "|  Bloqueados editoriais   : " + editorialBlocked + "\n" +
    "|  Featured finais         : " + featuredGroups.length + "\n" +
    "|    sem TMDB (pendente)   : " + noTmdbPending + "\n" +
    "|  Secondary (outras cat)  : " + secondaryGroups.length + "\n" +
    "|  Top idiomas             : " + topLangs + "\n" +
    "|  Cats featured           : " + catSummary + "\n" +
    "+-------------------------------------------------------------------\n"
  );

  if (DEBUG_RADAR) {
    console.log(`[radar-normalize] totalBefore=${totalFromIcs} totalAfter=${unifiedGroups.length}`);
    console.log(`[radar-dedupe] icsDedup=${dedupedIcsGroups.size}`);
    console.log(`[radar-filter] blocked=${blockedStructural} reason=structural_category`);
  }

  // 9. Distribuicao em secoes por data pura — sem caps, sem score gate.
  //
  //   sections.today      -> DESTAQUES DA SEMANA  (hoje-3 ate hoje)
  //   sections.thisWeek   -> NOVOS EPISODIOS      (amanha ate hoje+7)
  //   sections.next30Days -> VEM AI               (hoje+8 ate hoje+30 + marcos E01)
  //
  // A DATA manda. Episodios semanais em datas diferentes ficam separados.
  // So agrupamos episodios do mesmo titulo + mesma temporada + mesma data.

  // "Hoje" sempre calculado no fuso de Brasília (America/Sao_Paulo = UTC-3 permanente)
  // para que a virada do dia aconteça à meia-noite local, não às 21h do dia anterior em UTC.
  const nowBRT = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const sectionTodayStr = [
    nowBRT.getFullYear(),
    String(nowBRT.getMonth() + 1).padStart(2, "0"),
    String(nowBRT.getDate()).padStart(2, "0"),
  ].join("-");

  type IcsEpisode = IcsSeriesGroup["episodes"][number];

  type EpisodeCluster = {
    group: IcsSeriesGroup;
    date: string;
    season: number;
    episodes: IcsEpisode[];
    firstEpisode: IcsEpisode;
    key: string;
    isMilestone: boolean;
    releasePattern:
      | "single_episode"
      | "double_episode"
      | "episode_range"
      | "large_batch"
      | "season_drop"
      | "full_season"
      | "daily_strip";
    episodeLabel: string;
    clusterLabel: string;
    shortReason: string;
  };

  const dateOffset = (offsetDays: number): string => {
    const d = new Date(sectionTodayStr + "T12:00:00Z");
    d.setUTCDate(d.getUTCDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  };

  const strToday = sectionTodayStr; // +0
  const strM2    = dateOffset(-2);  // hoje - 2
  const strM3    = dateOffset(-3);  // hoje - 3
  const strP1    = dateOffset(1);   // amanha
  const strP4    = dateOffset(4);   // hoje + 4
  const strP8    = dateOffset(8);   // hoje + 8
  const strP30   = dateOffset(30);  // hoje + 30
  // Meio-dia de amanhã no horário de Brasília = 12:00 BRT = 15:00 UTC (BRT = UTC-3).
  // Episódios de amanhã com startAt < este threshold vão para Destaques;
  // os com startAt >= este threshold vão para Novidades.
  const noonTomorrowUTC = `${strP1}T15:00:00.000Z`;

  const padEp = (value: number): string => String(value).padStart(2, "0");

  const uniqueEpisodes = (episodes: IcsEpisode[]): IcsEpisode[] => {
    const seen = new Set<string>();
    return [...episodes]
      .filter((ep) => {
        const key = `${ep.startAt.slice(0, 10)}-${ep.season}-${ep.episode}-${ep.uid ?? ""}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        if (a.episode !== b.episode) return a.episode - b.episode;
        return a.startAt.localeCompare(b.startAt);
      });
  };

  const areConsecutiveEpisodes = (episodes: IcsEpisode[]): boolean => {
    if (episodes.length <= 1) return true;
    const sorted = uniqueEpisodes(episodes);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].episode !== sorted[i - 1].episode + 1) return false;
    }
    return true;
  };

  const knownSeasonTotal = (group: IcsSeriesGroup, season: number): number | null => {
    const tmdbAny = group.tmdb as
      | {
          seasons?: Array<{
            season_number?: number | null;
            episode_count?: number | null;
          }> | null;
        }
      | null
      | undefined;

    const found = tmdbAny?.seasons?.find((s) => s.season_number === season);
    return found?.episode_count && found.episode_count > 0 ? found.episode_count : null;
  };

  const detectReleasePattern = (
    group: IcsSeriesGroup,
    season: number,
    episodes: IcsEpisode[],
  ): EpisodeCluster["releasePattern"] => {
    const sorted = uniqueEpisodes(episodes);
    const total = knownSeasonTotal(group, season);
    const firstNo = sorted[0]?.episode ?? 0;
    const lastNo = sorted[sorted.length - 1]?.episode ?? 0;

    if (sorted.length <= 1) return "single_episode";

    if (
      total != null &&
      total > 0 &&
      firstNo === 1 &&
      sorted.length >= total &&
      lastNo >= total
    ) {
      return "full_season";
    }

    if (firstNo === 1 && sorted.length >= 6 && areConsecutiveEpisodes(sorted)) {
      return "season_drop";
    }

    if (sorted.length === 2 && areConsecutiveEpisodes(sorted)) {
      return "double_episode";
    }

    // Série diária (strip): >=3 episódios com números altos (>10) e consecutivos
    // Tipicamente novelas/reality shows exibidos todo dia útil.
    if (sorted.length >= 3 && areConsecutiveEpisodes(sorted) && (sorted[0]?.episode ?? 0) > 10) {
      return "daily_strip";
    }

    if (areConsecutiveEpisodes(sorted)) {
      return sorted.length >= 5 ? "large_batch" : "episode_range";
    }

    return sorted.length >= 5 ? "large_batch" : "episode_range";
  };

  const buildEpisodeLabel = (
    season: number,
    episodes: IcsEpisode[],
    pattern: EpisodeCluster["releasePattern"],
  ): string => {
    const sorted = uniqueEpisodes(episodes);
    const first = sorted[0];
    const last = sorted[sorted.length - 1];

    if (!first || !last) return "Novo episodio";

    if (pattern === "full_season") {
      return `T${season} completa - ${sorted.length} episodios`;
    }

    if (pattern === "season_drop") {
      return `T${season} liberada - ${sorted.length} episodios`;
    }

    if (sorted.length === 1) {
      return `S${padEp(season)}E${padEp(first.episode)}`;
    }

    if (pattern === "daily_strip") {
      // Série diária: mostra faixa de episódios sem prefixo de temporada (visualmente mais limpo)
      return sorted.length === 2
        ? `Ep. ${first.episode} e ${last.episode}`
        : `Ep. ${first.episode}–${last.episode} · ${sorted.length} episodios`;
    }

    if (pattern === "double_episode" && first.season === last.season) {
      return `S${padEp(season)}E${padEp(first.episode)} e E${padEp(last.episode)}`;
    }

    if (areConsecutiveEpisodes(sorted) && first.season === last.season) {
      return `S${padEp(season)}E${padEp(first.episode)}-E${padEp(last.episode)} - ${sorted.length} episodios`;
    }

    return `${sorted.length} episodios novos`;
  };

  const buildClusterLabel = (
    season: number,
    episodes: IcsEpisode[],
    pattern: EpisodeCluster["releasePattern"],
  ): string => {
    const label = buildEpisodeLabel(season, episodes, pattern);
    if (pattern === "full_season" || pattern === "season_drop") return label;
    if (episodes.length === 1) {
      const epName = episodes[0].episodeName;
      return epName && epName.toLowerCase() !== "tba"
        ? `${label} - ${epName}`
        : label;
    }
    return label;
  };

  const makeCluster = (
    group: IcsSeriesGroup,
    date: string,
    season: number,
    episodes: IcsEpisode[],
  ): EpisodeCluster | null => {
    const sorted = uniqueEpisodes(episodes);
    const firstEpisode = sorted[0];
    if (!firstEpisode) return null;

    const pattern = detectReleasePattern(group, season, sorted);
    const episodeLabel = buildEpisodeLabel(season, sorted, pattern);
    const clusterLabel = buildClusterLabel(season, sorted, pattern);
    const isMilestone = sorted.some((ep) => ep.season > 0 && ep.episode === 1);
    const firstEpNo = firstEpisode.episode ?? 0;
    const lastEpNo = sorted[sorted.length - 1]?.episode ?? firstEpNo;
    const identity =
      group.tmdb?.tmdb_id != null
        ? `tmdb-${group.tmdb.tmdb_id}`
        : group.key || group.rawTitle;

    return {
      group,
      date,
      season,
      episodes: sorted,
      firstEpisode,
      key: `${identity}-${date}-s${season}-e${firstEpNo}-${lastEpNo}`,
      isMilestone,
      releasePattern: pattern,
      episodeLabel,
      clusterLabel,
      shortReason: `${clusterLabel} em ${date}`,
    };
  };

  const buildClustersForGroup = (group: IcsSeriesGroup): EpisodeCluster[] => {
    const buckets = new Map<string, IcsEpisode[]>();

    for (const ep of group.episodes ?? []) {
      if (!ep?.startAt) continue;

      const date = ep.startAt.slice(0, 10);
      if (date < strM3 || date > strP30) continue;

      const season = ep.season ?? 0;
      const key = `${date}|${season}`;
      const arr = buckets.get(key) ?? [];
      arr.push(ep);
      buckets.set(key, arr);
    }

    const clusters: EpisodeCluster[] = [];
    for (const [key, episodes] of buckets) {
      const [date, seasonRaw] = key.split("|");
      const season = Number(seasonRaw);
      const cluster = makeCluster(group, date, season, episodes);
      if (cluster) clusters.push(cluster);
    }

    return clusters.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      if (a.season !== b.season) return a.season - b.season;
      return a.firstEpisode.episode - b.firstEpisode.episode;
    });
  };

  const destaqueBadge = (epDate: string): string => {
    const todayMs = new Date(`${strToday}T12:00:00Z`).getTime();
    const epMs    = new Date(`${epDate}T12:00:00Z`).getTime();
    const diffDays = Math.round((todayMs - epMs) / 86_400_000);
    if (diffDays <= 0) return "Hoje";
    if (diffDays === 1) return "Ontem";
    return `Saiu ha ${diffDays} dias`;
  };

  const novosBadge = (epDate: string): string => {
    const todayMs = new Date(`${strToday}T12:00:00Z`).getTime();
    const epMs    = new Date(`${epDate}T12:00:00Z`).getTime();
    const diffDays = Math.round((epMs - todayMs) / 86_400_000);
    if (diffDays <= 1) return "Amanha";
    return `Em ${diffDays} dias`;
  };

  const vemAiBadge = (cluster: EpisodeCluster): string => {
    if (cluster.releasePattern === "full_season") return "Temporada completa";
    if (cluster.releasePattern === "season_drop") return "Temporada liberada";
    if (cluster.isMilestone && cluster.season === 1) return "Estreia de serie";
    if (cluster.isMilestone) return "Nova temporada";
    return novosBadge(cluster.date);
  };

  const cloneGroupForCluster = (
    cluster: EpisodeCluster,
    section: "destaques" | "novosEpisodios" | "vemAi",
    badge: string,
  ): IcsSeriesGroup => {
    const first = cluster.firstEpisode;
    const last = cluster.episodes[cluster.episodes.length - 1] ?? first;

    const cloned = {
      ...cluster.group,
      key: `${cluster.group.key}::${cluster.date}::s${cluster.season}::e${first.episode}-${last.episode}`,
      episodeCount: cluster.episodes.length,
      episodes: cluster.episodes,
      seasons: [cluster.season],
      nextAirDate: `${cluster.date}T12:00:00.000Z`,
      lastAirDate: `${cluster.date}T12:00:00.000Z`,
      spanDays: 0,
      sectionMeta: {
        section,
        badge,
        reason: cluster.shortReason,
        episodeDate: cluster.date,
        selectedEpisode: {
          season: first.season,
          episode: first.episode,
        },
        releasePattern: cluster.releasePattern,
        episodeCount: cluster.episodes.length,
        episodeLabel: cluster.episodeLabel,
        clusterLabel: cluster.clusterLabel,
        firstEpisode: {
          season: first.season,
          episode: first.episode,
        },
        lastEpisode: {
          season: last.season,
          episode: last.episode,
        },
      },
    } as IcsSeriesGroup;

    return cloned;
  };

  /**
   * Colapsa múltiplos cards da mesma série+temporada numa única seção em um único card.
   * Caso uma série tenha episódios em datas diferentes dentro da mesma aba (ex: D+1 e D+2),
   * os clusters são fundidos: episódios unidos, label recalculado, data escolhida conforme
   * a prioridade da seção (mais próxima para Novidades/VemAi, mais recente para Destaques).
   */
  const collapseBySeriesSeason = (
    groups: IcsSeriesGroup[],
    datePreference: "closest" | "latest",
  ): IcsSeriesGroup[] => {
    // Chave de identidade: tmdb_id ou rawTitle normalizado + temporada dominante
    const identityKey = (g: IcsSeriesGroup): string => {
      const tmdbId = g.tmdb?.tmdb_id;
      const titleKey = tmdbId != null
        ? `tmdb:${tmdbId}`
        : g.rawTitle?.toLowerCase().trim() ?? g.key;
      // Usa a temporada dominante do sectionMeta ou a primeira de seasons[]
      const season = g.sectionMeta?.selectedEpisode?.season
        ?? g.seasons?.[0]
        ?? 0;
      return `${titleKey}|s${season}`;
    };

    const byIdentity = new Map<string, IcsSeriesGroup[]>();
    for (const g of groups) {
      const k = identityKey(g);
      const arr = byIdentity.get(k) ?? [];
      arr.push(g);
      byIdentity.set(k, arr);
    }

    const result: IcsSeriesGroup[] = [];

    for (const [, cards] of byIdentity) {
      if (cards.length === 1) {
        result.push(cards[0]);
        continue;
      }

      // Múltiplos cards do mesmo título+temporada — mesclar
      // Escolhe o card âncora (data mais próxima ou mais recente conforme seção)
      const sorted = [...cards].sort((a, b) => {
        const da = a.sectionMeta?.episodeDate ?? a.nextAirDate?.slice(0, 10) ?? "9999";
        const db = b.sectionMeta?.episodeDate ?? b.nextAirDate?.slice(0, 10) ?? "9999";
        return datePreference === "closest"
          ? da.localeCompare(db)
          : db.localeCompare(da);
      });

      const anchor = sorted[0];
      const anchorDate = anchor.sectionMeta?.episodeDate
        ?? anchor.nextAirDate?.slice(0, 10)
        ?? strToday;

      // Une todos os episódios de todos os cards
      const allEpisodes: IcsSeriesGroup["episodes"] = [];
      const seenEpKey = new Set<string>();
      for (const card of cards) {
        for (const ep of card.episodes ?? []) {
          const epKey = `s${ep.season}e${ep.episode}`;
          if (seenEpKey.has(epKey)) continue;
          seenEpKey.add(epKey);
          allEpisodes.push(ep);
        }
      }
      allEpisodes.sort((a, b) => {
        if (a.season !== b.season) return a.season - b.season;
        return a.episode - b.episode;
      });

      const season = anchor.sectionMeta?.selectedEpisode?.season
        ?? anchor.seasons?.[0]
        ?? 0;
      const asIcsEpisodes = allEpisodes as IcsEpisode[];
      const pattern = detectReleasePattern(anchor, season, asIcsEpisodes);
      const episodeLabel = buildEpisodeLabel(season, asIcsEpisodes, pattern);
      const clusterLabel = buildClusterLabel(season, asIcsEpisodes, pattern);

      const first = allEpisodes[0];
      const last  = allEpisodes[allEpisodes.length - 1];

      const merged: IcsSeriesGroup = {
        ...anchor,
        key: `${anchor.key}::merged`,
        episodeCount: allEpisodes.length,
        episodes: allEpisodes,
        sectionMeta: anchor.sectionMeta
          ? {
              ...anchor.sectionMeta,
              episodeDate: anchorDate,
              episodeCount: allEpisodes.length,
              episodeLabel,
              clusterLabel,
              releasePattern: pattern,
              firstEpisode: first
                ? { season: first.season, episode: first.episode }
                : anchor.sectionMeta.firstEpisode,
              lastEpisode: last
                ? { season: last.season, episode: last.episode }
                : anchor.sectionMeta.lastEpisode,
            }
          : anchor.sectionMeta,
      };

      result.push(merged);
    }

    return result;
  };

  const rawToday: IcsSeriesGroup[] = [];
  const rawWeek: IcsSeriesGroup[]  = [];
  const rawMonth: IcsSeriesGroup[] = [];

  // seenSeries: chave = groupKey::season — garante que cada série+temporada
  // aparece em NO MÁXIMO UMA aba. Clusters ordenados por data asc, então
  // a data mais próxima vence (prioridade natural pelo sort).
  const seenSeries = new Set<string>();

  const allClusters = featuredGroups
    .flatMap((group) => buildClustersForGroup(group))
    .sort((a, b) => a.date.localeCompare(b.date));

  for (const cluster of allClusters) {
    const seriesKey = `${cluster.group.key}::s${cluster.season}`;
    if (seenSeries.has(seriesKey)) continue;

    // PRIORIDADE 1 — DESTAQUES: D-2 ate D0 (inclusive).
    if (cluster.date >= strM2 && cluster.date <= strToday) {
      seenSeries.add(seriesKey);
      rawToday.push(
        cloneGroupForCluster(cluster, "destaques", destaqueBadge(cluster.date)),
      );
      continue;
    }

    // PRIORIDADE 2 — DESTAQUES: amanha (D+1) antes de meio-dia BRT (= 15:00 UTC).
    // Episódios sem horário chegam como T00:00:00.000Z — considerados "sem horário definido"
    // e tratados como tarde (vão para Novidades, não Destaques).
    if (cluster.date === strP1) {
      const firstStartAt = cluster.firstEpisode.startAt ?? "";
      const hasDefinedTime = firstStartAt.endsWith("T00:00:00.000Z") === false
        && firstStartAt.length >= 20;
      const isMorning = hasDefinedTime && firstStartAt < noonTomorrowUTC;

      seenSeries.add(seriesKey);
      if (isMorning) {
        rawToday.push(
          cloneGroupForCluster(cluster, "destaques", "Amanha cedo"),
        );
      } else {
        rawWeek.push(
          cloneGroupForCluster(cluster, "novosEpisodios", novosBadge(cluster.date)),
        );
      }
      continue;
    }

    // PRIORIDADE 3 — VEM AI: qualquer marco E01 entre D+2 e D+30.
    if (cluster.date >= dateOffset(2) && cluster.date <= strP30 && cluster.isMilestone) {
      seenSeries.add(seriesKey);
      rawMonth.push(
        cloneGroupForCluster(cluster, "vemAi", vemAiBadge(cluster)),
      );
      continue;
    }

    // PRIORIDADE 4 — NOVIDADES: D+2 ate D+4, episodios comuns.
    if (cluster.date >= dateOffset(2) && cluster.date <= strP4) {
      seenSeries.add(seriesKey);
      rawWeek.push(
        cloneGroupForCluster(cluster, "novosEpisodios", novosBadge(cluster.date)),
      );
      continue;
    }

    // PRIORIDADE 5 — VEM AI: D+8 ate D+30 (D+5, D+6, D+7 ficam fora das tres abas).
    if (cluster.date >= strP8 && cluster.date <= strP30) {
      seenSeries.add(seriesKey);
      rawMonth.push(
        cloneGroupForCluster(cluster, "vemAi", vemAiBadge(cluster)),
      );
    }
    // D+5, D+6, D+7 e nao-marcos D+2..D+7 fora de P4: descartados intencionalmente.
  }

  // Ordenacao final dentro de cada secao: por data
  rawToday.sort((a, b) => {
    const aDate = a.sectionMeta?.episodeDate ?? a.lastAirDate?.slice(0, 10) ?? "0000";
    const bDate = b.sectionMeta?.episodeDate ?? b.lastAirDate?.slice(0, 10) ?? "0000";
    return bDate.localeCompare(aDate); // mais recente primeiro em destaques
  });
  rawWeek.sort((a, b) => {
    const aDate = a.sectionMeta?.episodeDate ?? a.nextAirDate?.slice(0, 10) ?? "9999";
    const bDate = b.sectionMeta?.episodeDate ?? b.nextAirDate?.slice(0, 10) ?? "9999";
    return aDate.localeCompare(bDate); // mais proximo primeiro em novos episodios
  });
  rawMonth.sort((a, b) => {
    const aDate = a.sectionMeta?.episodeDate ?? a.nextAirDate?.slice(0, 10) ?? "9999";
    const bDate = b.sectionMeta?.episodeDate ?? b.nextAirDate?.slice(0, 10) ?? "9999";
    return aDate.localeCompare(bDate); // mais proximo primeiro em vem ai
  });

  // ── Colapso de duplicatas por título+temporada dentro de cada aba ───────────
  // Séries com episódios em datas diferentes da mesma janela viram um único card.
  const collapsedToday = collapseBySeriesSeason(rawToday, "latest");
  const collapsedWeek  = collapseBySeriesSeason(rawWeek,  "closest");
  const collapsedMonth = collapseBySeriesSeason(rawMonth, "closest");

  // ── Distribuicao de estreias de cinema nas secoes ─────────────────────────
  //
  // Janelas de cinema (distintas das de episodios):
  //   cinemaToday   -> Destaques: estreias dos ultimos 10 dias ate hoje
  //   cinemaThisWeek -> Novidades: estreias de amanha ate +10 dias
  //   cinemaNext    -> Vem Ai: +11 dias em diante (dentro da janela do radar, ate +30)

  const strP10ago = dateOffset(-10);
  const strP5     = dateOffset(5);   // D+5: cinema Vem Ai comeca aqui

  const cinemaToday:    CinemaReleaseGroup[] = [];
  const cinemaThisWeek: CinemaReleaseGroup[] = [];
  const cinemaNextArr:  CinemaReleaseGroup[] = [];

  for (const film of cinemaReleases) {
    const d = film.releaseDate;

    if (d >= strP10ago && d <= strToday) {
      const daysAgo = Math.round(
        (new Date(`${strToday}T12:00:00Z`).getTime() - new Date(`${d}T12:00:00Z`).getTime()) / 86_400_000,
      );
      const badge = daysAgo === 0 ? "Estreia hoje" : daysAgo === 1 ? "Estreou ontem" : `Estreou ha ${daysAgo} dias`;
      cinemaToday.push({ ...film, sectionMeta: { section: "destaques", badge, reason: `estreia_cinema ${d}` } });
    } else if (d >= strP1 && d <= strP4) {
      const daysAhead = Math.round(
        (new Date(`${d}T12:00:00Z`).getTime() - new Date(`${strToday}T12:00:00Z`).getTime()) / 86_400_000,
      );
      const badge = daysAhead === 1 ? "Estreia amanha" : `Estreia em ${daysAhead} dias`;
      cinemaThisWeek.push({ ...film, sectionMeta: { section: "novidades", badge, reason: `estreia_cinema ${d}` } });
    } else if (d >= strP5 && d <= strP30) {
      const daysAhead = Math.round(
        (new Date(`${d}T12:00:00Z`).getTime() - new Date(`${strToday}T12:00:00Z`).getTime()) / 86_400_000,
      );
      const badge = `Estreia em ${daysAhead} dias`;
      cinemaNextArr.push({ ...film, sectionMeta: { section: "vemAi", badge, reason: `estreia_cinema ${d}` } });
    }
  }

  cinemaToday.sort((a, b) => b.releaseDate.localeCompare(a.releaseDate));
  cinemaThisWeek.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));
  cinemaNextArr.sort((a, b) => a.releaseDate.localeCompare(b.releaseDate));

  console.log(
    `[radar-sections] destaques=${collapsedToday.length}(raw:${rawToday.length})` +
    ` novidades=${collapsedWeek.length}(raw:${rawWeek.length})` +
    ` vemAi=${collapsedMonth.length}(raw:${rawMonth.length})` +
    ` clusters=${allClusters.length}` +
    ` | janelas: [${strM2}..${strToday}+manhaD1] [D1tarde..${strP4}] [${strP8}..${strP30}]`,
  );
  console.log(
    `[radar-cinema-sections] destaques=${cinemaToday.length}` +
    ` novidades=${cinemaThisWeek.length}` +
    ` vemAi=${cinemaNextArr.length}` +
    ` | janelas: [${strP10ago}..${strToday}] [${strP1}..${strP4}] [${strP5}..${strP30}]`,
  );

  const sections: RadarSections = {
    today: collapsedToday,
    thisWeek: collapsedWeek,
    next30Days: collapsedMonth,
    cinemaToday,
    cinemaThisWeek,
    cinemaNext: cinemaNextArr,
  };

  console.log(
    `[radar-sections-final]` +
    ` today=${sections.today.length}` +
    ` thisWeek=${sections.thisWeek.length}` +
    ` next30Days=${sections.next30Days.length}` +
    ` cinemaToday=${sections.cinemaToday.length}` +
    ` cinemaThisWeek=${sections.cinemaThisWeek.length}` +
    ` cinemaNext=${sections.cinemaNext.length}`,
  );

  return {
    groups: featuredGroups,
    featuredGroups,
    secondaryGroups,
    movies,
    cinemaReleases: cinemaReleases.length > 0 ? cinemaReleases : undefined,
    sections,
    stats,
    fetchedAt: new Date().toISOString(),
    source: ICS_URL,
    pendingEnrichment,
    trendingDay:  trendingDayIds,
    trendingWeek: trendingWeekIds,
    fromCache: false,
    cacheVersion: CACHE_SCHEMA_VERSION,
  };
}

// ── Modo Debug/Admin ──────────────────────────────────────────────────────────
//
// GET /api/ics/agenda?debug=<rawTitle|key>
//
// Retorna o passo a passo do pipeline para um titulo especifico:
//   - step1: classifyTitle (categoria local)
//   - step2: dados TMDB (tmdb_id, lang, popularity, genre_ids, tmdb_type)
//   - step3: refined_category (resultado do refineCategoryFromTmdb)
//   - step4: cada hard filter e seu resultado
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
    local_blocked: boolean;
    tmdb_type_blocked: boolean;
    refined_blocked: boolean;
    passed_all_hard_filters: boolean;
  };
  discard_reason: string | null;
}

function buildDebugReport(group: IcsSeriesGroup): DebugReport {
  const localCat = classifyTitle(group.rawTitle);
  const tmdb = group.tmdb;

  const filters = {
    local_blocked:           ALL_BLOCKED_CATEGORIES.has(group.category),
    tmdb_type_blocked:       false,
    refined_blocked:         false,
    passed_all_hard_filters: false,
  };

  let discardReason: string | null = null;

  if (filters.local_blocked) {
    discardReason = `Categoria local '${group.category}' esta bloqueada estruturalmente`;
  }

  if (tmdb && !discardReason) {
    const typ = tmdb.tmdb_type ?? "";
    if (["Talk Show", "News", "Soap"].includes(typ)) {
      filters.tmdb_type_blocked = true;
      discardReason = `tmdb_type='${typ}' bloqueado automaticamente`;
    }
  }

  if (tmdb && !discardReason) {
    const refinedCat = tmdb.refined_category ?? group.category;
    if (ALL_BLOCKED_CATEGORIES.has(refinedCat)) {
      filters.refined_blocked = true;
      discardReason = `refined_category='${refinedCat}' esta bloqueada estruturalmente`;
    }
  }

  filters.passed_all_hard_filters = !discardReason;

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
    discard_reason:         discardReason,
  };
}

// ── Handler GET ───────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const debugKey = searchParams.get("debug");

    // Modo debug: pipeline completo + relatorio detalhado para um titulo
    if (debugKey) {
      const payload = await buildAgendaPayload();

      const normalize = (s: string) => s.toLowerCase().replace(/[^\w]/g, "");
      const normalizedKey = normalize(debugKey);
      const allGroups = [...payload.featuredGroups, ...payload.secondaryGroups];

      const group = allGroups.find(
        (g) =>
          normalize(g.key) === normalizedKey ||
          normalize(g.rawTitle) === normalizedKey,
      );

      if (!group) {
        return NextResponse.json(
          {
            error: "Titulo nao encontrado no pipeline",
            searched_key: debugKey,
            available_keys: allGroups
              .slice(0, 30)
              .map((g) => ({ key: g.key, rawTitle: g.rawTitle })),
          },
          { status: 404 },
        );
      }

      const report = buildDebugReport(group);

      return NextResponse.json(
        { debug: true, report },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // Tenta usar cache persistente
    const cached = await readCache();

    if (cached) {
      const response: IcsAgendaResponse = {
        ...cached.payload,
        fromCache: true,
        cachedAt: cached.cachedAt,
      };

      return NextResponse.json(response, {
        headers: {
          "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
        },
      });
    }

    // Cache miss/stale — executa pipeline completo
    const payload = await buildAgendaPayload();
    await writeCache(payload);

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    console.error("[ICS Agenda] pipeline error:", err);

    return NextResponse.json(
      { error: "Failed to process ICS feed", detail: String(err) },
      { status: 500 },
    );
  }
}
