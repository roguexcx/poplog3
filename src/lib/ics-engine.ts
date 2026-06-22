// ── ICS Engine ─────────────────────────────────────────────────────────────────
// Transforma eventos brutos ICS em grupos de série enriquecíveis.
//
// Score e categorias são definidos nos módulos compartilhados:
//   - src/lib/radar/categories.ts — ContentCategory, FEATURED/HIDDEN, classify
//   - src/lib/radar/score.ts      — computeUnifiedScore, ScoreBreakdownUnified
//
// Este módulo mantém apenas a lógica específica do pipeline ICS:
//   - Parsing e agrupamento de eventos
//   - Enriquecimento TMDB (IcsSeriesGroup, TmdbEnrichment)
//   - filterEnrichedGroup (passa tudo exceto HIDDEN/DISCARD)
// ──────────────────────────────────────────────────────────────────────────────

import type { IcsEvent } from "./ics-parser";
import {
  type ContentCategory,
  CATEGORY_PRIORITY,
  FEATURED_CATEGORIES,
  HIDDEN_CATEGORIES,
  DISCARD_CATEGORIES,
  ALL_BLOCKED_CATEGORIES,
  classifyTitle,
  refineCategoryFromTmdb,
  isCategoryVisible,
} from "./radar/categories";
// score.ts e section-scorer.ts removidos do pipeline — sem score editorial unificado

// Re-export para compatibilidade retroativa (consumidores existentes importam daqui)
export type { ContentCategory };
export {
  CATEGORY_PRIORITY, FEATURED_CATEGORIES, HIDDEN_CATEGORIES,
  DISCARD_CATEGORIES, ALL_BLOCKED_CATEGORIES,
  classifyTitle, refineCategoryFromTmdb, isCategoryVisible,
};

// ── Padrões de classificação: delegados para src/lib/radar/categories.ts ──────
// classifyTitle, ANIME_TITLE_PATTERNS, refineCategoryFromTmdb, etc. já importados no topo.

function detectSoapByVolume(episodeCount: number, spanDays: number): boolean {
  if (spanDays <= 0) return false;
  return (episodeCount / spanDays) > 1 && spanDays >= 5;
}

function normalizeTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[''`]/g, "'")
    .replace(/[^\w\s']/g, "")
    .trim();
}

// ── Tipos exportados ──────────────────────────────────────────────────────────

export interface SeriesEpisodeWindow {
  season: number;
  episode: number;
  episodeName: string;
  startAt: string;
  endAt: string;
  uid: string;
}

export interface TmdbNetwork {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface TmdbProductionCompany {
  id: number;
  name: string;
  logo_path: string | null;
  origin_country: string;
}

export interface IcsSeriesGroup {
  key: string;
  rawTitle: string;
  source?: "ics" | "tmdb";
  sourceTag?: string;
  category: ContentCategory;
  /**
   * Sufixo regional detectado no rawTitle (ex: "UK", "US", "AU", "BR").
   * Preenchido quando o rawTitle contém um sufixo de país e o matching TMDB
   * encontrou um resultado via título sem o sufixo (possível variante regional).
   * Usado pela UI para diferenciar cards que teriam o mesmo tmdb.name.
   */
  variantCountry?: string | null;
  episodeCount: number;
  nextAirDate: string;
  lastAirDate: string;
  spanDays: number;
  episodes: SeriesEpisodeWindow[];
  seasons: number[];
  /** Score de relevância composto 0-100 (preenchido após enriquecimento TMDB) */
  relevanceScore: number;
  /** true = passou no threshold de relevância */
  isRelevant: boolean;
  tmdb?: TmdbEnrichment | null;
  /** Provedor de streaming identificado (ex: Netflix, HBO Max) — opcional, populado pelo pipeline de airing */
  streamingProvider?: { name: string } | null;
  /**
   * Metadado leve adicionado pelo RAW_BDS_MODE para indicar qual episódio motivou
   * a alocação do grupo numa seção do Radar. Usado pelo frontend para exibir
   * badges corretos sem recomputar a janela temporal.
   */
  sectionMeta?: {
    /** Nome canônico da seção no backend */
    section: "destaques" | "novosEpisodios" | "vemAi";
    /** Badge textual curto para exibição no card, ex: "Hoje", "Amanhã", "Nova temporada" */
    badge: string;
    /** Motivo legível para debug/diagnóstico */
    reason: string;
    /** Data YYYY-MM-DD do episódio que motivou a seção */
    episodeDate: string;
    /** Episódio selecionado (temporada e número) */
    selectedEpisode: { season: number; episode: number; episodeName?: string };
    /** Extras populados pelo pipeline de cluster-by-date */
    releasePattern?: string;
    episodeCount?: number;
    episodeLabel?: string;
    clusterLabel?: string;
    firstEpisode?: { season: number; episode: number };
    lastEpisode?: { season: number; episode: number };
  } | null;
}

/**
 * Representa um filme no pipeline da agenda.
 * Análogo a IcsSeriesGroup, mas para filmes (sem episódios recorrentes).
 */
export interface MovieGroup {
  key: string;
  source?: "tmdb";
  sourceTag?: string;
  movie: {
    tmdb_id: number;
    release_date?: string | null;
    backdrop_path?: string | null;
    poster_path?: string | null;
    clean_backdrop_path?: string | null;
    popularity?: number;
    vote_average?: number;
    vote_count?: number;
    original_language?: string;
    overview?: string | null;
    name?: string;
    original_name?: string;
    genre_ids?: number[];
    genres?: string[];
    origin_country?: string[];
  };
  relevanceScore?: number;
  isRelevant?: boolean;
}

/**
 * Representa uma estreia de cinema rastreada pelo pipeline TMDB.
 * Distinto de MovieGroup (que é genérico): CinemaReleaseGroup foca em datas
 * de estreia teatral (theatrical release), com confiança de data explícita.
 */
export interface CinemaReleaseGroup {
  key: string;
  eventType: "movie_theatrical_release";
  source: "tmdb_cinema_release";
  /** Data de estreia teatral YYYY-MM-DD (preferência: BR confirmed) */
  releaseDate: string;
  /**
   * Confiança na data de estreia:
   * - cinema_br_confirmed: data de estreia teatral BR confirmada via release_dates
   * - cinema_global_fallback: data global usada pois não havia data BR theatrical
   * - cinema_date_uncertain: data sem confirmação regional (apenas release_date base)
   */
  dateConfidence: "cinema_br_confirmed" | "cinema_global_fallback" | "cinema_date_uncertain";
  movie: {
    tmdb_id: number;
    name: string;
    original_name: string;
    release_date?: string | null;
    backdrop_path?: string | null;
    poster_path?: string | null;
    clean_backdrop_path?: string | null;
    popularity?: number;
    vote_average?: number;
    vote_count?: number;
    original_language?: string;
    overview?: string | null;
    genre_ids?: number[];
    genres?: string[];
    origin_country?: string[];
  };
  relevanceScore?: number;
  /** Metadados de seção adicionados durante a distribuição */
  sectionMeta?: {
    section: "destaques" | "novidades" | "vemAi";
    badge: string;
    reason: string;
  } | null;
}


export interface TmdbEnrichment {
  tmdb_id: number;
  name: string;
  original_name: string;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  /** Backdrop sem texto/logo, obtido via /images?include_image_language=null,xx */
  clean_backdrop_path?: string | null;
  genre_ids: number[];
  genres: string[];
  popularity: number;
  vote_average: number;
  vote_count: number;
  number_of_seasons: number | null;
  origin_country: string[];
  original_language: string;
  first_air_date: string | null;
  status: string | null;
  networks: TmdbNetwork[];
  production_companies: TmdbProductionCompany[];
  tmdb_type?: string | null;
  refined_category?: ContentCategory;
}

// computeRelevanceScore, RELEVANCE_THRESHOLD e filterEnrichedGroup removidos.
// Pipeline unificado: sem score editorial. Filtragem e estrutural via ALL_BLOCKED_CATEGORIES.

// ── Engine principal ──────────────────────────────────────────────────────────

export interface IcsEngineOptions {
  includeHidden?: boolean;
  windowDays?: number;
  sort?: "priority" | "nextAir";
}

export function runIcsEngine(
  events: IcsEvent[],
  options: IcsEngineOptions = {},
): IcsSeriesGroup[] {
  const { includeHidden = false, windowDays = 30, sort = "nextAir" } = options;

  const now = new Date();
  const windowEnd = new Date(now);
  windowEnd.setDate(windowEnd.getDate() + windowDays);
  windowEnd.setHours(23, 59, 59, 999);

  const windowEvents = events.filter(
    (ev) => ev.startAt >= now && ev.startAt <= windowEnd,
  );

  const groupMap = new Map<string, IcsSeriesGroup>();

  for (const ev of windowEvents) {
    const key = normalizeTitleKey(ev.seriesTitle);

    if (!groupMap.has(key)) {
      groupMap.set(key, {
        key,
        rawTitle:      ev.seriesTitle,
        category:      "UNKNOWN",
        episodeCount:  0,
        nextAirDate:   ev.startAt.toISOString(),
        lastAirDate:   ev.startAt.toISOString(),
        spanDays:      0,
        episodes:      [],
        seasons:       [],
        relevanceScore: 0,
        isRelevant:    true,
        tmdb:          null,
      });
    }

    const group = groupMap.get(key)!;
    group.episodeCount++;

    if (ev.startAt.toISOString() < group.nextAirDate) group.nextAirDate = ev.startAt.toISOString();
    if (ev.startAt.toISOString() > group.lastAirDate)  group.lastAirDate = ev.startAt.toISOString();

    group.episodes.push({
      season:      ev.season,
      episode:     ev.episode,
      episodeName: ev.episodeName,
      startAt:     ev.startAt.toISOString(),
      endAt:       ev.endAt.toISOString(),
      uid:         ev.uid,
    });

    if (!group.seasons.includes(ev.season)) group.seasons.push(ev.season);
  }

  for (const group of groupMap.values()) {
    const first = new Date(group.nextAirDate);
    const last  = new Date(group.lastAirDate);
    group.spanDays = Math.ceil((last.getTime() - first.getTime()) / 86_400_000);

    let cat = classifyTitle(group.rawTitle);
    if (cat !== "SPORTS" && cat !== "NEWS" && detectSoapByVolume(group.episodeCount, group.spanDays)) {
      cat = "DAILY_SOAP";
    }
    group.category = cat;

    group.episodes.sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
    group.seasons.sort((a, b) => a - b);
  }

  let groups = Array.from(groupMap.values());

  if (!includeHidden) {
    groups = groups.filter((g) => !ALL_BLOCKED_CATEGORIES.has(g.category));
  }

  if (sort === "priority") {
    groups.sort((a, b) => {
      const pa = CATEGORY_PRIORITY[a.category];
      const pb = CATEGORY_PRIORITY[b.category];
      if (pa !== pb) return pa - pb;
      return new Date(a.nextAirDate).getTime() - new Date(b.nextAirDate).getTime();
    });
  } else {
    groups.sort((a, b) =>
      new Date(a.nextAirDate).getTime() - new Date(b.nextAirDate).getTime()
    );
  }

  return groups;
}

// ── Utilitário: agrupa por dia ────────────────────────────────────────────────

export function groupSeriesByDay(groups: IcsSeriesGroup[]): Map<string, IcsSeriesGroup[]> {
  const map = new Map<string, IcsSeriesGroup[]>();
  for (const group of groups) {
    for (const ep of group.episodes) {
      const day = ep.startAt.slice(0, 10);
      const arr = map.get(day) ?? [];
      if (!arr.find((g) => g.key === group.key)) arr.push(group);
      map.set(day, arr);
    }
  }
  return map;
}

export function episodesOnDay(group: IcsSeriesGroup, dateStr: string): SeriesEpisodeWindow[] {
  return group.episodes.filter((ep) => ep.startAt.slice(0, 10) === dateStr);
}

// ── Estatísticas ──────────────────────────────────────────────────────────────

export interface IcsEngineStats {
  totalEvents: number;
  totalGroups: number;
  byCategory: Record<ContentCategory, number>;
  featuredGroups: number;
  hiddenGroups: number;
}

export function computeStats(allGroups: IcsSeriesGroup[], totalEvents: number): IcsEngineStats {
  const byCategory = {} as Record<ContentCategory, number>;
  let featuredGroups = 0;
  let hiddenGroups = 0;

  for (const g of allGroups) {
    byCategory[g.category] = (byCategory[g.category] ?? 0) + 1;
    if (FEATURED_CATEGORIES.has(g.category)) featuredGroups++;
    if (HIDDEN_CATEGORIES.has(g.category))   hiddenGroups++;
  }

  return { totalEvents, totalGroups: allGroups.length, byCategory, featuredGroups, hiddenGroups };
}
