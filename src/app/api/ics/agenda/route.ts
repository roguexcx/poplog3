// ── /api/ics/agenda ────────────────────────────────────────────────────────────
// Pipeline MODO BRUTO: ICS fetch → parse → engine → trending TMDB → enriquecimento
// → score de relevância → resposta JSON.
//
// MODO BRUTO (ativo agora):
//   - Sem filtros editoriais de idioma, gênero, popularidade ou plataforma.
//   - Apenas deduplicação técnica (mesmo título de múltiplas fontes).
//   - Validação mínima: título + dados básicos válidos.
//   - Filtros, pesos e curadoria ficam preparados na estrutura mas DESLIGADOS.
//
// Cache Supabase (tabela ics_agenda_cache, TTL 24h):
//   - GET: lê cache primeiro; se fresco (<24h) retorna imediatamente.
//   - Se stale ou ausente: executa pipeline completo, salva no Supabase, retorna.
// ──────────────────────────────────────────────────────────────────────────────

import { NextRequest, NextResponse } from "next/server";
import { parseIcsContent } from "@/lib/ics-parser";
import {
  runIcsEngine, computeStats, FEATURED_CATEGORIES, ALL_BLOCKED_CATEGORIES,
  computeRelevanceScore, classifyTitle, RELEVANCE_THRESHOLD,
} from "@/lib/ics-engine";
import type { IcsSeriesGroup, IcsEngineStats, MovieGroup } from "@/lib/ics-engine";
import { enrichSeriesGroups } from "@/lib/ics-enricher";
import { supabaseAdmin } from "@/server/supabase/admin";
import { computeScoreBreakdown, computeUnifiedScore } from "@/lib/radar/score";
import { refineCategoryFromTmdb } from "@/lib/radar/categories";
import { classifyRealityBySignals } from "@/lib/radar/reality-classifier";
import {
  computeSectionScore,
  checkCaps, consumeCap, freshCapState,
  CAPS_TODAY, CAPS_WEEK, CAPS_MONTH,
} from "@/lib/radar/section-scorer";
import { applyRetrofill } from "@/lib/radar/tmdb-retrofill";

// Não usar cache do Next.js — gerenciamos o cache manualmente no Supabase
export const revalidate = 0;

const ICS_URL    = "http://bancodeseries.com.br/ical.php";
const TMDB_BASE  = "https://api.themoviedb.org/3";
const CACHE_ID   = "main";
const CACHE_TTL_H = 24; // horas
const CACHE_SCHEMA_VERSION = 5; // bumped: RAW_BDS_MODE + retroactive fill
const RAW_BDS_MODE = process.env.RADAR_RAW_BDS_MODE === "true";
const DEBUG_RADAR = process.env.DEBUG_RADAR === "true";
const DEBUG_TITLES = [/rupaul/i, /drag race/i, /tonight show/i, /jimmy fallon/i];

type TmdbTvListItem = {
  id: number;
  name: string;
  original_name?: string;
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
  source_episode?: {
    air_date?: string | null;
    episode_number?: number | null;
    season_number?: number | null;
    name?: string | null;
  } | null;
};


type TmdbMovieListItem = {
  id: number;
  title: string;
  original_title?: string;
  release_date?: string;
  backdrop_path?: string | null;
  poster_path?: string | null;
  popularity?: number;
  vote_average?: number;
  vote_count?: number;
  original_language?: string;
  overview?: string | null;
  genre_ids?: number[];
  origin_country?: string[];
};

const TV_GENRE_NAMES: Record<number, string> = {
  10759: "Ação & Aventura", 16: "Animação", 35: "Comédia", 80: "Crime",
  99: "Documentário", 18: "Drama", 10751: "Família", 10762: "Kids",
  9648: "Mistério", 10763: "Notícias", 10764: "Reality", 10765: "Ficção Científica",
  10766: "Soap", 10767: "Talk", 10768: "Guerra & Política", 37: "Faroeste",
};

const MOVIE_GENRE_NAMES: Record<number, string> = {
  28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia", 80: "Crime",
  99: "Documentário", 18: "Drama", 10751: "Família", 14: "Fantasia",
  36: "História", 27: "Terror", 10402: "Música", 9648: "Mistério",
  10749: "Romance", 878: "Ficção Científica", 10770: "TV Movie",
  53: "Thriller", 10752: "Guerra", 37: "Faroeste",
};

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
  score?: number | null;
  blocked?: boolean;
  reason?: string | null;
}) {
  if (!DEBUG_RADAR && !shouldDebugTitle(data.title)) return;
  console.log(
    `[radar-debug-title] title="${data.title}" source=${data.source ?? "_"} ` +
    `tmdbId=${data.tmdbId ?? "_"} date=${data.date ?? "_"} section=${data.section ?? "_"} ` +
    `category=${data.category ?? "_"} score=${data.score ?? "_"} blocked=${data.blocked ? "true" : "false"} ` +
    `reason=${data.reason ?? "_"}`,
  );
}

function radarFilterLog(title: string, reason: string) {
  if (!DEBUG_RADAR && !shouldDebugTitle(title)) return;
  console.log(`[radar-filter] blocked title="${title}" reason="${reason}"`);
}

export interface RadarSections {
  /** Grupos com nextAirDate == hoje */
  today: IcsSeriesGroup[];
  /** Grupos com nextAirDate nos últimos 7 dias (excluindo hoje) — conteúdo recente */
  thisWeek: IcsSeriesGroup[];
  /** Grupos com nextAirDate > hoje (futuro) ou sem data datada */
  next30Days: IcsSeriesGroup[];
}

export interface IcsAgendaResponse {
  groups: IcsSeriesGroup[];
  featuredGroups: IcsSeriesGroup[];
  secondaryGroups: IcsSeriesGroup[];
  /** Filmes em cartaz/estreando — populado pelo pipeline de airing quando disponível */
  movies?: MovieGroup[];
  /** Featured groups particionados por janela temporal */
  sections?: RadarSections;
  stats: IcsEngineStats;
  fetchedAt: string;
  source: string;
  pendingEnrichment: number;
  trendingDay: number[];
  trendingWeek: number[];
  fromCache: boolean;
  cachedAt?: string;
  cacheVersion?: number;
  /** true quando RAW_BDS_MODE está ativo — BDS como única fonte, sem filtros editoriais */
  rawBdsMode?: boolean;
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

async function fetchTmdbTvList(
  path: string,
  token: string,
  params: Record<string, string> = {},
): Promise<TmdbTvListItem[]> {
  try {
    const url = new URL(`${TMDB_BASE}${path}`);
    url.searchParams.set("language", "pt-BR");
    url.searchParams.set("page", params.page ?? "1");
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }

    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
    });
    if (!res.ok) return [];
    const data = await res.json() as { results?: TmdbTvListItem[] };
    return (data.results ?? []).filter((item) => item.id && item.name);
  } catch {
    return [];
  }
}

function dateAdd(days: number, base = new Date()): string {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function isDateInRange(date: string | null | undefined, start: string, end: string): boolean {
  if (!date) return false;
  return date >= start && date <= end;
}

function tmdbTvToGroup(
  item: TmdbTvListItem,
  sourceTag: string,
  eventDate: string,
): IcsSeriesGroup | null {
  const baseCategory = classifyTitle(item.name);
  const refined = refineCategoryFromTmdb(baseCategory, item.genre_ids ?? []);
  const category = applyRealityClassifier(refined, {
    title: item.name,
    genreIds: item.genre_ids ?? [],
    popularity: item.popularity,
    voteAverage: item.vote_average,
    voteCount: item.vote_count,
    originalLanguage: item.original_language,
    originCountry: item.origin_country,
    backdropPath: item.backdrop_path,
    posterPath: item.poster_path,
    eventDate,
  });
  if (ALL_BLOCKED_CATEGORIES.has(category)) {
    radarFilterLog(item.name, category === "VARIETY" ? "talk_show_or_late_show" : `blocked_category_${category}`);
    radarDebugTitle({
      title: item.name,
      source: "tmdb",
      tmdbId: item.id,
      date: eventDate,
      section: sourceTag,
      category,
      blocked: true,
      reason: `blocked_category_${category}`,
    });
    return null;
  }

  const startAt = `${eventDate}T12:00:00.000Z`;
  const sourceEpisode = item.source_episode ?? null;
  const season = sourceEpisode?.season_number ?? 0;
  const episode = sourceEpisode?.episode_number ?? 0;
  const tmdb = {
    tmdb_id: item.id,
    name: item.name,
    original_name: item.original_name ?? item.name,
    overview: item.overview ?? null,
    poster_path: item.poster_path ?? null,
    backdrop_path: item.backdrop_path ?? null,
    clean_backdrop_path: item.backdrop_path ?? null,
    genre_ids: item.genre_ids ?? [],
    genres: (item.genre_ids ?? []).map((id) => TV_GENRE_NAMES[id]).filter(Boolean),
    popularity: item.popularity ?? 0,
    vote_average: item.vote_average ?? 0,
    vote_count: item.vote_count ?? 0,
    number_of_seasons: null,
    origin_country: item.origin_country ?? [],
    original_language: item.original_language ?? "",
    first_air_date: item.first_air_date ?? null,
    status: null,
    networks: [],
    production_companies: [],
    refined_category: category,
  };

  const group: IcsSeriesGroup = {
    key: `tmdb-tv-${item.id}`,
    rawTitle: item.name,
    source: "tmdb",
    sourceTag,
    category,
    episodeCount: 1,
    nextAirDate: startAt,
    lastAirDate: startAt,
    spanDays: 0,
    episodes: [{
      season,
      episode,
      episodeName:
        sourceEpisode?.name ??
        (sourceTag === "trending_day" ? "Em alta hoje" :
          sourceTag === "trending_week" ? "Em alta na semana" :
          sourceTag === "airing_today" ? "Exibição hoje" :
          sourceTag === "on_the_air" ? "No ar" :
          "Descoberta relevante"),
      startAt,
      endAt: startAt,
      uid: `tmdb-tv-${sourceTag}-${item.id}-${eventDate}`,
    }],
    seasons: [1],
    relevanceScore: 0,
    isRelevant: true,
    tmdb,
  };

  radarDebugTitle({
    title: item.name,
    source: "tmdb",
    tmdbId: item.id,
    date: eventDate,
    section: sourceTag,
    category,
    score: group.relevanceScore,
    blocked: false,
  });

  return group;
}


/**
 * Após refineCategoryFromTmdb, se a categoria resultou em REALITY, tenta promover
 * a REALITY_PREMIUM usando sinais editoriais (formato, cadência, rede/produtora).
 * Categorias diferentes de REALITY passam inalteradas.
 */
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

  if (result.blocked) return currentCategory; // bloqueio estrutural — mantém REALITY

  if (DEBUG_RADAR || shouldDebugTitle(input.title)) {
    console.log(
      `[reality-classifier] title="${input.title}" score=${result.score} ` +
      `category=${result.category} reason=${result.reason} ` +
      `signals=${result.signals.map((s) => `${s.key}:${s.value}`).join(",")}`,
    );
  }

  return result.category; // REALITY_PREMIUM ou REALITY
}

function mergeDedupSeriesByTmdbId(
  icsGroups: IcsSeriesGroup[],
  tmdbGroups: IcsSeriesGroup[],
): { groups: IcsSeriesGroup[]; deduped: number } {
  const byTmdb = new Map<number, IcsSeriesGroup>();
  const out: IcsSeriesGroup[] = [];
  let deduped = 0;

  for (const group of icsGroups) {
    if (group.tmdb?.tmdb_id) byTmdb.set(group.tmdb.tmdb_id, group);
    out.push(group);
  }

  for (const group of tmdbGroups) {
    const tmdbId = group.tmdb?.tmdb_id;
    if (tmdbId && byTmdb.has(tmdbId)) {
      deduped++;
      const existing = byTmdb.get(tmdbId)!;
      existing.sourceTag = existing.sourceTag
        ? `${existing.sourceTag},${group.sourceTag}`
        : `ics,${group.sourceTag}`;
      continue;
    }
    if (tmdbId) byTmdb.set(tmdbId, group);
    out.push(group);
  }

  return { groups: out, deduped };
}

async function fetchActiveTmdbSeries(
  token: string,
  trendingDayIds: Set<number>,
  trendingWeekIds: Set<number>,
): Promise<IcsSeriesGroup[]> {
  const today = dateAdd(0);
  const nextWeek = dateAdd(7);
  const thirtyDaysAgo = dateAdd(-30);
  const thirtyDaysAhead = dateAdd(30);

  const [trendingDay, trendingWeek, airingToday, onTheAir, newSeries, upcomingSeries] =
    await Promise.all([
      fetchTmdbTvList("/trending/tv/day", token),
      fetchTmdbTvList("/trending/tv/week", token),
      fetchTmdbTvList("/tv/airing_today", token),
      fetchTmdbTvList("/tv/on_the_air", token),
      fetchTmdbTvList("/discover/tv", token, {
        "first_air_date.gte": thirtyDaysAgo,
        "first_air_date.lte": today,
        sort_by: "popularity.desc",
        "vote_count.gte": "3",
        without_genres: "10763",
      }),
      fetchTmdbTvList("/discover/tv", token, {
        "first_air_date.gte": today,
        "first_air_date.lte": thirtyDaysAhead,
        sort_by: "popularity.desc",
        "vote_count.gte": "3",
        without_genres: "10763",
      }),
    ]);

  const candidates: Array<{ item: TmdbTvListItem; sourceTag: string; eventDate: string }> = [
    ...trendingDay.map((item) => ({ item, sourceTag: "trending_day", eventDate: today })),
    ...trendingWeek.map((item) => ({ item, sourceTag: "trending_week", eventDate: today })),
    ...airingToday.map((item) => ({ item, sourceTag: "airing_today", eventDate: today })),
    ...onTheAir.map((item) => ({
      item,
      sourceTag: "on_the_air",
      eventDate: item.first_air_date && isDateInRange(item.first_air_date, today, nextWeek)
        ? item.first_air_date
        : today,
    })),
    ...newSeries.map((item) => ({ item, sourceTag: "discover_new_series", eventDate: item.first_air_date ?? today })),
    ...upcomingSeries.map((item) => ({ item, sourceTag: "discover_upcoming_series", eventDate: item.first_air_date ?? today })),
  ];

  const byId = new Map<number, IcsSeriesGroup>();
  for (const { item, sourceTag, eventDate } of candidates) {
    const group = tmdbTvToGroup(item, sourceTag, eventDate);
    if (!group?.tmdb) continue;
    group.relevanceScore = computeRelevanceScore(group, trendingDayIds, trendingWeekIds);

    const existing = byId.get(item.id);
    if (!existing || group.relevanceScore > existing.relevanceScore) {
      byId.set(item.id, group);
    } else {
      existing.sourceTag = existing.sourceTag
        ? `${existing.sourceTag},${sourceTag}`
        : sourceTag;
    }
  }

  return Array.from(byId.values()).sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// ── Fetch filmes em cartaz / próximos lançamentos no Brasil ──────────────────

async function fetchMoviesBR(
  endpoint: "now_playing" | "upcoming",
  token: string,
): Promise<import("@/lib/ics-engine").MovieGroup[]> {
  try {
    const res = await fetch(
      `${TMDB_BASE}/movie/${endpoint}?language=pt-BR&region=BR&page=1`,
      { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } },
    );
    if (!res.ok) return [];
    const data = await res.json() as { results?: TmdbMovieListItem[] };
    const sevenDaysAgo = dateAdd(-7);
    const thirtyDaysAhead = dateAdd(30);

    return (data.results ?? [])
      .filter((m) =>
        m.id &&
        m.title &&
        isDateInRange(m.release_date, sevenDaysAgo, thirtyDaysAhead)
      )
      .map((m) => ({
        key: `movie-${m.id}`,
        source: "tmdb" as const,
        sourceTag: endpoint,
        movie: {
          tmdb_id:           m.id,
          name:              m.title,
          original_name:     m.original_title ?? m.title,
          release_date:      m.release_date ?? null,
          backdrop_path:     m.backdrop_path ?? null,
          poster_path:       m.poster_path ?? null,
          clean_backdrop_path: m.backdrop_path ?? null,
          popularity:        m.popularity,
          vote_average:      m.vote_average,
          vote_count:        m.vote_count,
          original_language: m.original_language,
          overview:          m.overview ?? null,
          genre_ids:         m.genre_ids ?? [],
          genres:            (m.genre_ids ?? []).map((id) => MOVIE_GENRE_NAMES[id]).filter(Boolean),
          origin_country:    m.origin_country ?? [],
        },
        relevanceScore: computeUnifiedScore({
          tmdb_id: m.id,
          popularity: m.popularity,
          vote_average: m.vote_average,
          vote_count: m.vote_count,
          original_language: m.original_language,
          origin_country: m.origin_country ?? [],
          genre_ids: m.genre_ids ?? [],
          name: m.title,
          original_name: m.original_title ?? m.title,
        }),
        isRelevant: true,
      }));
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
    const payload = data.payload as unknown as IcsAgendaResponse;

    if (payload.cacheVersion !== CACHE_SCHEMA_VERSION) {
      console.log("[ICS Agenda] cache schema antigo — reconstruindo");
      return null;
    }

    if (ageHours >= CACHE_TTL_H) {
      console.log(`[ICS Agenda] cache stale (${ageHours.toFixed(1)}h) — reconstruindo`);
      return null;
    }

    console.log(`[ICS Agenda] cache hit (${ageHours.toFixed(1)}h atrás)`);
    return {
      payload,
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

/** Grupo com score de seção calculado — usado apenas no modo curado */
type ScoredGroup = {
  group:            IcsSeriesGroup;
  sectionScore:     number;
  temporalBonus:    number;
  qualityScore:     number;
  bucket:           import("@/lib/radar/section-scorer").SectionBucket;
  isAnime:          boolean;
  isRealityPremium: boolean;
  isGenericGameShow: boolean;
  hasValidTmdb:     boolean;
};

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
  // RAW_BDS_MODE: includeHidden:true para que nenhum grupo seja descartado pelo engine
  // antes de chegar ao pipeline (ALL_BLOCKED_CATEGORIES não filtra aqui).
  const groups = runIcsEngine(events, {
    windowDays: 30,
    sort: "nextAir",
    includeHidden: RAW_BDS_MODE,
  });

  const accessToken = process.env.TMDB_ACCESS_TOKEN?.trim() ?? "";

  // 4. Fetch trending + filmes em cartaz BR (paralelo)
  // RAW_BDS_MODE: TMDB serve apenas para enriquecimento — não injetamos séries ativas do TMDB.
  // Ainda buscamos trending IDs para calcular trendingBoost no score, mas não fetchMoviesBR.
  const [trendingDayIds, trendingWeekIds, nowPlayingMovies, upcomingMovies] =
    accessToken && !RAW_BDS_MODE
      ? await Promise.all([
          fetchTrendingIds("day", accessToken),
          fetchTrendingIds("week", accessToken),
          fetchMoviesBR("now_playing", accessToken),
          fetchMoviesBR("upcoming", accessToken),
        ])
      : accessToken
        ? await Promise.all([
            fetchTrendingIds("day", accessToken),
            fetchTrendingIds("week", accessToken),
            Promise.resolve([] as import("@/lib/ics-engine").MovieGroup[]),
            Promise.resolve([] as import("@/lib/ics-engine").MovieGroup[]),
          ])
        : [[], [], [], []];

  if (RAW_BDS_MODE) {
    console.log("[radar-raw] RAW_BDS_MODE=true — TMDB ativo desligado, usando apenas BDS como fonte");
  }

  const trendingDay  = new Set(trendingDayIds);
  const trendingWeek = new Set(trendingWeekIds);

  // 5. Enriquecimento dos grupos.
  // RAW_BDS_MODE: enriquece TODOS os grupos (BDS é a fonte de verdade — sem pré-filtro).
  // Modo normal: enriquece apenas grupos das categorias featured.
  const groupsToEnrich = RAW_BDS_MODE
    ? groups
    : groups.filter((g) => FEATURED_CATEGORIES.has(g.category));

  if (accessToken && groupsToEnrich.length > 0) {
    console.log(`[ICS Agenda] enriquecendo ${groupsToEnrich.length} grupos${RAW_BDS_MODE ? " (RAW_BDS_MODE: todos)" : ""}...`);
    await enrichSeriesGroups(groupsToEnrich, { accessToken, concurrency: 5 });
    console.log("[ICS Agenda] enriquecimento concluído");
  }

  // 5b. Preenchimento retroativo de episódios via TMDB (RAW_BDS_MODE apenas)
  // Preenche grupos sem episódios recentes com dados retroativos da API de temporadas.
  if (RAW_BDS_MODE && accessToken) {
    await applyRetrofill(groups, accessToken);
  }

  // 6. Pós-enriquecimento: reclassificação de reality + score unificado.
  // Reality com sinais fortes → REALITY_PREMIUM (aparece no Radar).
  // Score calculado para ordenação — sem threshold de corte no modo bruto.
  for (const g of groups) {
    if (!g.tmdb) continue;

    // Reclassifica REALITY usando sinais editoriais (só após enriquecimento,
    // pois precisamos de tmdb_type, networks, genre_ids do detalhe TMDB)
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

    const score = computeRelevanceScore(g, trendingDay, trendingWeek);
    g.relevanceScore = score;
    // isRelevant=true para todos — sem threshold de corte no modo bruto
    g.isRelevant = true;

    if (RAW_BDS_MODE) {
      const cat = g.tmdb?.refined_category ?? g.category;
      console.log(
        `[radar-raw-classify] title="${g.tmdb?.name ?? g.rawTitle}"` +
        ` category=${cat} score=${score.toFixed(1)}` +
        ` nextAirDate=${g.nextAirDate ?? "_"}` +
        ` tmdbId=${g.tmdb?.tmdb_id ?? "_"}`,
      );
    }
  }

  // RAW_BDS_MODE: não injetamos séries ativas do TMDB — BDS é a única fonte de entrada.
  const tmdbSeries = accessToken && !RAW_BDS_MODE
    ? await fetchActiveTmdbSeries(accessToken, trendingDay, trendingWeek)
    : [];

  const { groups: unifiedGroups, deduped: dedupedTmdbSeries } =
    mergeDedupSeriesByTmdbId(groups, tmdbSeries);

  // 7. Separar featured / secondary — apenas separa categorias visíveis das ocultas.
  // RAW_BDS_MODE: sem filtro editorial. Todos os grupos do BDS são aceitos.
  //   - Apenas logamos categoria/score, nenhum grupo é descartado.
  // Modo normal: HIDDEN_CATEGORIES (SPORTS, NEWS, PODCAST, LIVE_EVENT) são bloqueadas
  //   estruturalmente (exclusões técnicas, não editoriais).
  const isHiddenGroup = (g: IcsSeriesGroup): boolean =>
    ALL_BLOCKED_CATEGORIES.has(g.category) ||
    ALL_BLOCKED_CATEGORIES.has(g.tmdb?.refined_category ?? g.category);

  const visibleGroups: IcsSeriesGroup[] = [];
  let blockedStructural = 0;
  for (const group of unifiedGroups) {
    const refinedCat = group.tmdb?.refined_category ?? group.category;
    const blocked = !RAW_BDS_MODE && isHiddenGroup(group);
    if (blocked) {
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
        score: group.relevanceScore,
        blocked: true,
        reason: `blocked_category_${refinedCat}`,
      });
      continue;
    }
    // RAW_BDS_MODE: logar grupos que seriam bloqueados mas que aceitamos assim mesmo
    if (RAW_BDS_MODE && isHiddenGroup(group)) {
      console.log(
        `[radar-raw-accept] title="${group.tmdb?.name ?? group.rawTitle}"` +
        ` category=${refinedCat} — aceito no modo bruto (seria bloqueado em modo curado)`,
      );
    }
    radarDebugTitle({
      title: group.tmdb?.name ?? group.rawTitle,
      source: group.source ?? "ics",
      tmdbId: group.tmdb?.tmdb_id ?? null,
      date: group.nextAirDate,
      category: refinedCat,
      score: group.relevanceScore,
      blocked: false,
    });
    visibleGroups.push(group);
  }

  // RAW_BDS_MODE: todos os grupos visíveis são "featured" — sem split editorial.
  // A divisão featured/secondary é puramente de UI e não deve esconder nada no modo bruto.
  const featuredGroups  = RAW_BDS_MODE
    ? visibleGroups
    : visibleGroups.filter((g) => FEATURED_CATEGORIES.has(g.category));
  const secondaryGroups = RAW_BDS_MODE
    ? []
    : visibleGroups.filter((g) => !FEATURED_CATEGORIES.has(g.category));

  // 8. Estatísticas
  // RAW_BDS_MODE: montar stats manualmente para refletir a realidade do modo bruto.
  //   hiddenGroups = 0 (nenhum grupo é escondido)
  //   featuredGroups = totalGroups (todos são featured)
  // Modo normal: computeStats usa FEATURED_CATEGORIES e ALL_BLOCKED_CATEGORIES.
  const allVisibleGroups = [...featuredGroups, ...secondaryGroups];
  const stats = RAW_BDS_MODE
    ? {
        totalEvents:    events.length,
        totalGroups:    allVisibleGroups.length,
        byCategory:     allVisibleGroups.reduce((acc, g) => {
          const cat = g.category; // usa categoria canônica do grupo (ContentCategory)
          acc[cat] = (acc[cat] ?? 0) + 1;
          return acc;
        }, {} as Record<import("@/lib/radar/categories").ContentCategory, number>),
        featuredGroups: allVisibleGroups.length,
        hiddenGroups:   0,
      }
    : computeStats(allVisibleGroups, events.length);

  const pendingEnrichment = featuredGroups.filter((g) => !g.tmdb).length;

  // Merge filmes: dedup por tmdb_id, prioriza now_playing sobre upcoming
  const movieMap = new Map<number, import("@/lib/ics-engine").MovieGroup>();
  for (const m of [...nowPlayingMovies, ...upcomingMovies]) {
    if (!movieMap.has(m.movie.tmdb_id)) movieMap.set(m.movie.tmdb_id, m);
  }
  // MODO BRUTO: sem cap de filmes, sem janela temporal restritiva.
  // Apenas validação técnica: descarta filmes sem título e sem nenhuma imagem.
  const movies = Array.from(movieMap.values())
    .filter((m) => m.movie.tmdb_id && m.movie.name) // validação técnica mínima
    .sort((a, b) => (b.movie.popularity ?? 0) - (a.movie.popularity ?? 0));


  // -- Log de filtros aplicados (servidor) ---------------------------------
  const totalFromIcs   = groups.length;
  const totalFromTmdb  = tmdbSeries.length;
  const withTmdb       = unifiedGroups.filter((g) => !!g.tmdb).length;
  const hiddenBlocked  = unifiedGroups.filter((g) =>
    ALL_BLOCKED_CATEGORIES.has(g.category) ||
    ALL_BLOCKED_CATEGORIES.has(g.tmdb?.refined_category ?? g.category),
  ).length;
  const noTmdbPending  = featuredGroups.filter((g) => !g.tmdb).length;

  const catCount: Record<string, number> = {};
  for (const g of featuredGroups) {
    const cat = g.tmdb?.refined_category ?? g.category;
    catCount[cat] = (catCount[cat] ?? 0) + 1;
  }

  const scoredGroups = featuredGroups.filter((g) => g.relevanceScore !== undefined);
  const scores = scoredGroups.map((g) => g.relevanceScore!).sort((a, b) => a - b);
  const scoreMin = scores[0]   ?? 0;
  const scoreMax = scores[scores.length - 1] ?? 0;
  const scoreMed = scores[Math.floor(scores.length / 2)] ?? 0;

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
    "|  TMDB -> series ativas    : " + totalFromTmdb + " (dedup " + dedupedTmdbSeries + ")\n" +
    "|  Com TMDB enriquecido    : " + withTmdb + " / " + unifiedGroups.length + "\n" +
    "|  Bloqueados estruturais  : " + hiddenBlocked + "\n" +
    "|  Featured finais         : " + featuredGroups.length + "\n" +
    "|    sem TMDB (pendente)   : " + noTmdbPending + "\n" +
    "|    com score calculado   : " + scoredGroups.length + "\n" +
    "|  Secondary (outras cat)  : " + secondaryGroups.length + "\n" +
    "|  Filmes (BR)             : " + movies.length + "\n" +
    "|\n" +
    "|  Score min / med / max   : " + scoreMin + " / " + scoreMed + " / " + scoreMax + "\n" +
    "|  Top idiomas             : " + topLangs + "\n" +
    "|  Cats featured           : " + catSummary + "\n" +
    "|  trendingDay / Week      : " + trendingDayIds.length + " / " + trendingWeekIds.length + " ids\n" +
    "+-------------------------------------------------------------------\n"
  );

  if (DEBUG_RADAR) {
    console.log(`[radar-source] ics=${totalFromIcs} tmdbSeries=${totalFromTmdb} tmdbMovies=${movies.length}`);
    console.log(`[radar-normalize] totalBefore=${totalFromIcs + totalFromTmdb} totalAfter=${unifiedGroups.length}`);
    console.log(`[radar-dedupe] removed=${dedupedTmdbSeries} keptIcs=${totalFromIcs} keptTmdb=${totalFromTmdb - dedupedTmdbSeries}`);
    console.log(`[radar-filter] blocked=${blockedStructural} reason=structural_category`);
  }

  // 9. Distribuição editorial em seções: Hoje / Semana / 30 dias
  //
  // RAW_BDS_MODE: distribuição por data pura, sem caps, sem score gate.
  //   - Hoje: nextAirDate == hoje OU ontem (±1 dia para fuso horário)
  //   - Semana: nextAirDate nos últimos 7 dias ou próximos 7 dias (excl. hoje/ontem)
  //   - 30 dias: nextAirDate nos próximos 8–30 dias OU grupos sem data datada
  //   - Todos os grupos passam — sem caps por categoria.
  //
  // Modo curado: section-scorer com qualityScore + temporalBonus + caps por categoria.

  // Data de hoje como string ISO YYYY-MM-DD (horário local do servidor)
  const now = new Date();
  const sectionTodayStr = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");

  let sections: RadarSections;

  if (RAW_BDS_MODE) {
    // ── RAW_BDS_MODE: distribuição por evento de data ────────────────────────
    //
    // Regra-mestre:
    //   A DATA manda. Episódios semanais em datas diferentes ficam separados.
    //   Só agrupamos episódios do mesmo título + mesma temporada + mesma data.
    //
    // sections.today      → DESTAQUES DA SEMANA  (hoje-3 até hoje)
    // sections.thisWeek   → NOVOS EPISÓDIOS      (amanhã até hoje+7)
    // sections.next30Days → VEM AÍ               (hoje+8 até hoje+30 + marcos E01)
    //
    // Importante:
    //   Não há caps, score gate, filtro por idioma, imagem, categoria ou TMDB.
    //   A deduplicação aqui é técnica: mesmo evento de lançamento não deve repetir.

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
        | "full_season";
      episodeLabel: string;
      clusterLabel: string;
      shortReason: string;
    };

    /** Retorna data ISO YYYY-MM-DD de hoje + offsetDays */
    const dateOffset = (offsetDays: number): string => {
      const d = new Date(sectionTodayStr + "T12:00:00Z");
      d.setUTCDate(d.getUTCDate() + offsetDays);
      return d.toISOString().slice(0, 10);
    };

    const strToday = sectionTodayStr; // +0
    const strM3    = dateOffset(-3);  // hoje - 3
    const strP1    = dateOffset(1);   // amanhã
    const strP7    = dateOffset(7);   // hoje + 7
    const strP8    = dateOffset(8);   // hoje + 8
    const strP30   = dateOffset(30);  // hoje + 30

    const toDateMs = (date: string): number =>
      new Date(`${date}T12:00:00Z`).getTime();

    const daysFromToday = (date: string): number =>
      Math.round((toDateMs(date) - toDateMs(strToday)) / 86_400_000);

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

      // Sem total confiável vindo do TMDB, não afirmamos "temporada completa".
      // Apenas marcamos como temporada liberada/lote grande.
      if (firstNo === 1 && sorted.length >= 6 && areConsecutiveEpisodes(sorted)) {
        return "season_drop";
      }

      if (sorted.length === 2 && areConsecutiveEpisodes(sorted)) {
        return "double_episode";
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

      if (!first || !last) return "Novo episódio";

      if (pattern === "full_season") {
        return `T${season} completa · ${sorted.length} episódios`;
      }

      if (pattern === "season_drop") {
        return `T${season} liberada · ${sorted.length} episódios`;
      }

      if (sorted.length === 1) {
        return `S${padEp(season)}E${padEp(first.episode)}`;
      }

      if (
        pattern === "double_episode" &&
        first.season === last.season
      ) {
        return `S${padEp(season)}E${padEp(first.episode)} e E${padEp(last.episode)}`;
      }

      if (areConsecutiveEpisodes(sorted) && first.season === last.season) {
        return `S${padEp(season)}E${padEp(first.episode)}–E${padEp(last.episode)} · ${sorted.length} episódios`;
      }

      return `${sorted.length} episódios novos`;
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
          ? `${label} · ${epName}`
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
        // Janela total do Radar bruto: hoje-3 até hoje+30.
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
      const diffDays = -daysFromToday(epDate);
      if (diffDays <= 0) return "Hoje";
      if (diffDays === 1) return "Ontem";
      return `Saiu há ${diffDays} dias`;
    };

    const novosBadge = (epDate: string): string => {
      const diffDays = daysFromToday(epDate);
      if (diffDays <= 1) return "Amanhã";
      return `Em ${diffDays} dias`;
    };

    const vemAiBadge = (cluster: EpisodeCluster): string => {
      if (cluster.releasePattern === "full_season") return "Temporada completa";
      if (cluster.releasePattern === "season_drop") return "Temporada liberada";
      if (cluster.isMilestone && cluster.season === 1) return "Estreia de série";
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
          // Campos extras para a UI usar quando estiver pronta.
          // Mantêm a regra: 1 card por título + data + temporada.
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

    const rawToday: IcsSeriesGroup[] = [];
    const rawWeek: IcsSeriesGroup[] = [];
    const rawMonth: IcsSeriesGroup[] = [];
    const seenCluster = new Set<string>();

    const allClusters = featuredGroups
      .flatMap((group) => buildClustersForGroup(group))
      .sort((a, b) => {
        if (a.date !== b.date) return a.date.localeCompare(b.date);
        return (b.group.relevanceScore ?? 0) - (a.group.relevanceScore ?? 0);
      });

    for (const cluster of allClusters) {
      if (seenCluster.has(cluster.key)) continue;
      seenCluster.add(cluster.key);

      // PRIORIDADE 1 — DESTAQUES: hoje-3 até hoje.
      if (cluster.date >= strM3 && cluster.date <= strToday) {
        rawToday.push(
          cloneGroupForCluster(cluster, "destaques", destaqueBadge(cluster.date)),
        );
        continue;
      }

      // PRIORIDADE 2 — VEM AÍ: qualquer marco E01 entre amanhã e +30.
      // Estreias e novas temporadas não viram "novo episódio comum".
      if (cluster.date >= strP1 && cluster.date <= strP30 && cluster.isMilestone) {
        rawMonth.push(
          cloneGroupForCluster(cluster, "vemAi", vemAiBadge(cluster)),
        );
        continue;
      }

      // PRIORIDADE 3 — NOVOS EPISÓDIOS: próximos 7 dias, episódios comuns.
      if (cluster.date >= strP1 && cluster.date <= strP7) {
        rawWeek.push(
          cloneGroupForCluster(cluster, "novosEpisodios", novosBadge(cluster.date)),
        );
        continue;
      }

      // PRIORIDADE 4 — VEM AÍ: futuro +8 até +30, mesmo quando não é marco.
      // Isso impede que o modo bruto perca episódios válidos mais distantes.
      if (cluster.date >= strP8 && cluster.date <= strP30) {
        rawMonth.push(
          cloneGroupForCluster(cluster, "vemAi", vemAiBadge(cluster)),
        );
      }
    }

    const sortByPastDateDesc = (arr: IcsSeriesGroup[]): IcsSeriesGroup[] =>
      arr.sort((a, b) => {
        const aMeta = a.sectionMeta;
        const bMeta = b.sectionMeta;
        const aDate = aMeta?.episodeDate ?? a.lastAirDate?.slice(0, 10) ?? "0000";
        const bDate = bMeta?.episodeDate ?? b.lastAirDate?.slice(0, 10) ?? "0000";
        if (aDate !== bDate) return bDate.localeCompare(aDate);
        return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
      });

    const sortByFutureDateAsc = (arr: IcsSeriesGroup[]): IcsSeriesGroup[] =>
      arr.sort((a, b) => {
        const aMeta = a.sectionMeta;
        const bMeta = b.sectionMeta;
        const aDate = aMeta?.episodeDate ?? a.nextAirDate?.slice(0, 10) ?? "9999";
        const bDate = bMeta?.episodeDate ?? b.nextAirDate?.slice(0, 10) ?? "9999";
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        return (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0);
      });

    sortByPastDateDesc(rawToday);
    sortByFutureDateAsc(rawWeek);
    sortByFutureDateAsc(rawMonth);

    console.log(
      `[radar-raw-sections] destaquesSemanais=${rawToday.length}` +
      ` novosEpisodios=${rawWeek.length}` +
      ` vemAi=${rawMonth.length}` +
      ` clusters=${allClusters.length}` +
      ` | janelas: [${strM3}..${strToday}] [${strP1}..${strP7}] [${strP8}..${strP30}]`,
    );

    sections = {
      today: rawToday,
      thisWeek: rawWeek,
      next30Days: rawMonth,
    };

  } else {
    // ── Modo curado: section-scorer com qualityScore + temporalBonus + caps ──
    const TODAY_MIN     = 8;
    const TODAY_MAX     = 20;
    const WEEK_MAX      = 36;
    const MONTH_MAX     = 60;
    const FILL_MIN_SCORE = 30;

    // Score e bucket para cada grupo (type declarado no nível de módulo — ver acima)

    const scored: ScoredGroup[] = featuredGroups.map((g) => {
      const s = computeSectionScore(
        {
          category:       g.category,
          relevanceScore: g.relevanceScore ?? 0,
          nextAirDate:    g.nextAirDate,
          tmdb:           g.tmdb ?? null,
        },
        sectionTodayStr,
      );
      return { group: g, ...s };
    });

    // Ordenar por sectionScore desc dentro de cada bucket
    scored.sort((a, b) => b.sectionScore - a.sectionScore);

    // Helper: tenta adicionar item à seção respeitando caps
    function tryAdd(
      item: ScoredGroup,
      target: IcsSeriesGroup[],
      seenKeys: Set<string>,
      caps: import("@/lib/radar/section-scorer").SectionCaps,
      capState: import("@/lib/radar/section-scorer").CapState,
      maxItems: number,
      sectionName: string,
    ): boolean {
      if (target.length >= maxItems) return false;
      if (seenKeys.has(item.group.key)) return false;
      if (!checkCaps(item, caps, capState)) {
        if (DEBUG_RADAR) {
          const reason = item.isAnime ? "anime_cap"
            : item.isGenericGameShow ? "game_show_cap"
            : item.isRealityPremium ? "reality_cap"
            : "no_tmdb_cap";
          console.log(
            `[radar-section-demote] title="${item.group.rawTitle}" from=${sectionName} reason="${reason}"`,
          );
        }
        return false;
      }
      seenKeys.add(item.group.key);
      consumeCap(item, capState);
      target.push(item.group);
      if (DEBUG_RADAR) {
        console.log(
          `[radar-section-pick] section=${sectionName} title="${item.group.rawTitle}"` +
          ` score=${item.sectionScore} bucket=${item.bucket}` +
          ` anime=${item.isAnime} gameShow=${item.isGenericGameShow}`,
        );
      }
      return true;
    }

    // ── Montagem de HOJE ────────────────────────────────────────────────────
    const todayResult: IcsSeriesGroup[] = [];
    const todayKeys = new Set<string>();
    const todayCaps = freshCapState();

    const todayBuckets: Array<import("@/lib/radar/section-scorer").SectionBucket> = [
      "todayStrict", "yesterdayStrong",
    ];

    for (const item of scored) {
      if (todayResult.length >= TODAY_MAX) break;
      if (!todayBuckets.includes(item.bucket)) continue;
      tryAdd(item, todayResult, todayKeys, CAPS_TODAY, todayCaps, TODAY_MAX, "today");
    }

    if (todayResult.length < TODAY_MIN) {
      for (const item of scored) {
        if (todayResult.length >= TODAY_MAX) break;
        if (item.bucket !== "recentStrong") continue;
        if ((item.sectionScore) < FILL_MIN_SCORE) continue;
        tryAdd(item, todayResult, todayKeys, CAPS_TODAY, todayCaps, TODAY_MAX, "today");
      }
    }

    if (todayResult.length < TODAY_MIN) {
      for (const item of scored) {
        if (todayResult.length >= TODAY_MAX) break;
        if (item.bucket !== "nearFuture") continue;
        if (item.sectionScore < FILL_MIN_SCORE + 10) continue;
        tryAdd(item, todayResult, todayKeys, CAPS_TODAY, todayCaps, TODAY_MAX, "today");
      }
    }

    // ── Montagem de SEMANA ──────────────────────────────────────────────────
    const weekResult: IcsSeriesGroup[] = [];
    const weekKeys = new Set<string>(todayKeys);
    const weekCaps = freshCapState();

    const weekBucketsOrdered: Array<import("@/lib/radar/section-scorer").SectionBucket> = [
      "recentStrong", "nearFuture", "yesterdayStrong", "midFuture",
    ];

    for (const bucketName of weekBucketsOrdered) {
      for (const item of scored) {
        if (weekResult.length >= WEEK_MAX) break;
        if (item.bucket !== bucketName) continue;
        tryAdd(item, weekResult, weekKeys, CAPS_WEEK, weekCaps, WEEK_MAX, "week");
      }
      if (weekResult.length >= WEEK_MAX) break;
    }

    for (const item of scored) {
      if (weekResult.length >= WEEK_MAX) break;
      if (item.bucket !== "undated") continue;
      tryAdd(item, weekResult, weekKeys, CAPS_WEEK, weekCaps, WEEK_MAX, "week");
    }

    // ── Montagem de 30 DIAS ─────────────────────────────────────────────────
    const monthResult: IcsSeriesGroup[] = [];
    const monthKeys = new Set<string>([...todayKeys, ...weekKeys]);
    const monthCaps = freshCapState();

    const monthBucketsOrdered: Array<import("@/lib/radar/section-scorer").SectionBucket> = [
      "farFuture", "midFuture", "nearFuture",
    ];

    for (const bucketName of monthBucketsOrdered) {
      for (const item of scored) {
        if (monthResult.length >= MONTH_MAX) break;
        if (item.bucket !== bucketName) continue;
        tryAdd(item, monthResult, monthKeys, CAPS_MONTH, monthCaps, MONTH_MAX, "month");
      }
      if (monthResult.length >= MONTH_MAX) break;
    }

    // Contagens por bucket para log
    const bucketCounts2: Record<string, number> = {};
    for (const s of scored) bucketCounts2[s.bucket] = (bucketCounts2[s.bucket] ?? 0) + 1;

    console.log(
      `[radar-sections]` +
      ` today=${todayResult.length}` +
      ` thisWeek=${weekResult.length}` +
      ` next30Days=${monthResult.length}` +
      ` | buckets: ${Object.entries(bucketCounts2).map(([k, v]) => k + "=" + v).join(" ")}`,
    );

    sections = {
      today:      todayResult,
      thisWeek:   weekResult,
      next30Days: monthResult,
    };
  }

  console.log(
    `[radar-sections-final]` +
    ` today=${sections.today.length}` +
    ` thisWeek=${sections.thisWeek.length}` +
    ` next30Days=${sections.next30Days.length}` +
    ` | mode=${RAW_BDS_MODE ? "raw_bds" : "curated"}`,
  );

  return {
    groups: featuredGroups,
    featuredGroups,
    secondaryGroups,
    movies,
    sections,
    stats,
    fetchedAt: new Date().toISOString(),
    source: ICS_URL,
    pendingEnrichment,
    trendingDay:  trendingDayIds,
    trendingWeek: trendingWeekIds,
    fromCache: false,
    cacheVersion: CACHE_SCHEMA_VERSION,
    rawBdsMode: RAW_BDS_MODE,
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
    local_blocked: boolean;
    tmdb_type_blocked: boolean;
    refined_blocked: boolean;
    language_blocked: boolean;
    passed_all_hard_filters: boolean;
  };
  step5_score: {
    popularity_score: number;
    quality_score: number;
    network_tier: number;
    trending_boost: number;
    origin_boost: number;
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
    local_blocked:            ALL_BLOCKED_CATEGORIES.has(group.category),
    tmdb_type_blocked:        false,
    refined_blocked:          false,
    language_blocked:         false,
    passed_all_hard_filters:  false,
  };

  let discardReason: string | null = null;

  if (filters.local_blocked) {
    discardReason = `Categoria local '${group.category}' está bloqueada estruturalmente`;
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
      discardReason = `refined_category='${refinedCat}' está bloqueada estruturalmente`;
    }
  }

  filters.passed_all_hard_filters = !discardReason;

  let scoreBreakdown: DebugReport["step5_score"] = null;
  if (tmdb && filters.passed_all_hard_filters) {
    const breakdown = computeScoreBreakdown(tmdb, trendingDay, trendingWeek);

    scoreBreakdown = {
      popularity_score:    breakdown.popularity,
      quality_score:       breakdown.quality,
      network_tier:        breakdown.networkTier,
      trending_boost:      breakdown.trendingBoost,
      origin_boost:        breakdown.originBoost,
      total:               breakdown.total,
      threshold:           RELEVANCE_THRESHOLD,
    };
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
        (g) =>
          normalize(g.key) === normalizedKey ||
          normalize(g.rawTitle) === normalizedKey,
      );

      if (!group) {
        return NextResponse.json(
          {
            error: "Título não encontrado no pipeline",
            searched_key: debugKey,
            available_keys: allGroups
              .slice(0, 30)
              .map((g) => ({ key: g.key, rawTitle: g.rawTitle })),
          },
          { status: 404 },
        );
      }

      const td = new Set(payload.trendingDay);
      const tw = new Set(payload.trendingWeek);
      const report = buildDebugReport(group, td, tw);

      return NextResponse.json(
        { debug: true, report },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // Em RAW_BDS_MODE, sempre executa pipeline fresco para diagnóstico.
    // Não usar cache Supabase, senão alterações em retrofill/datas ficam invisíveis.
    if (!RAW_BDS_MODE) {
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
    }

    // Cache miss/stale ou RAW_BDS_MODE — executa pipeline completo
    const payload = await buildAgendaPayload();

    // Em RAW_BDS_MODE, não salva cache para não mascarar alterações durante diagnóstico.
    if (!RAW_BDS_MODE) {
      await writeCache(payload);
    }

    return NextResponse.json(payload, {
      headers: {
        "Cache-Control": RAW_BDS_MODE
          ? "no-store"
          : "public, s-maxage=300, stale-while-revalidate=60",
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