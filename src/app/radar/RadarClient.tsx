"use client";

// ── RadarClient ────────────────────────────────────────────────────────────────
// Componente principal da página /radar.
//
// Dois modos de visualização, alternáveis com um clique:
//   • Geral   — feed ICS + TMDB, descoberta ampla, sem personalização
//   • Personalizado — AgendaEngine com watchlist, histórico e preferências do usuário
//
// MODO BRUTO (ativo agora):
//   Sem filtros editoriais de idioma, gênero, popularidade ou plataforma.
//   A engine recebe e exibe tudo que for válido. Filtros e pesos ficam
//   preparados na estrutura mas desligados, prontos para ativação gradual.
// ──────────────────────────────────────────────────────────────────────────────

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import ContextualAttribution from "@/components/attribution/ContextualAttribution";
import PageShell from "@/components/layout/PageShell";
import type { IcsSeriesGroup, MovieGroup, ContentCategory } from "@/lib/ics-engine";
import { filterEnrichedGroup, CATEGORY_PRIORITY } from "@/lib/ics-engine";
import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";
import type { RadarMode } from "@/app/api/radar/route";
import type { AgendaV2CompatResponse, LegacyAgendaTv, LegacyAgendaMovie } from "@/server/agenda/types";

// ── Constantes ─────────────────────────────────────────────────────────────────

const TMDB_IMG = (path: string | null | undefined, size: string) =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

const POSTER_TEXT_LANGS = new Set(["ja","ko","zh","th","hi","ar","he","ru","uk","vi","id"]);

function bestHorizontalImg(
  tmdb: { backdrop_path: string | null; poster_path: string | null; clean_backdrop_path?: string | null },
  size = "w780",
): string | null {
  const path = tmdb.clean_backdrop_path ?? tmdb.backdrop_path;
  if (!path) return null;
  return TMDB_IMG(path, size);
}

function bestVerticalImg(
  tmdb: { backdrop_path: string | null; poster_path: string | null; clean_backdrop_path?: string | null; original_language?: string },
): string | null {
  const lang    = tmdb.original_language ?? "";
  const cleanBd = tmdb.clean_backdrop_path ?? tmdb.backdrop_path;
  if (POSTER_TEXT_LANGS.has(lang)) {
    return TMDB_IMG(cleanBd, "w780") || TMDB_IMG(tmdb.poster_path, "w342");
  }
  return TMDB_IMG(tmdb.poster_path, "w342") || TMDB_IMG(cleanBd, "w780");
}

const ENRICH_BATCH = 10;
const ENRICH_PAUSE = 700;
const SPOTLIGHT_MS = 6000;

// ── Fases do carregamento ──────────────────────────────────────────────────────

type Phase = "idle" | "fetching_ics" | "grouping" | "cache_check" | "enriching" | "done";

const PHASE_LABELS: Record<Phase, string> = {
  idle:         "Iniciando radar…",
  fetching_ics: "Lendo sinais…",
  grouping:     "Agrupando séries…",
  cache_check:  "Consultando cache…",
  enriching:    "Enriquecendo dados…",
  done:         "Radar ativo",
};

type ViewMode = "day" | "week" | "month";

// ── Helpers de data ────────────────────────────────────────────────────────────

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function todayStr() { return toLocalDateStr(new Date()); }
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}
function formatWeekRange(start: Date) {
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const o: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return `${start.toLocaleDateString("pt-BR", o)} – ${end.toLocaleDateString("pt-BR", o)}`;
}
function formatDayFull(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}
function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}
function daysUntilDate(dateStr: string): number {
  const date = new Date(`${dateStr}T12:00:00`);
  const today = new Date(`${todayStr()}T12:00:00`);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}
function activeWindow(): { start: string; end: string } {
  const now = new Date();
  const end30 = new Date(now);
  end30.setDate(end30.getDate() + 30);
  return { start: toLocalDateStr(now), end: toLocalDateStr(end30) };
}

function hasValidTmdb(g: IcsSeriesGroup): boolean {
  return !!(g.tmdb?.name && (g.tmdb?.poster_path || g.tmdb?.backdrop_path));
}

function firstEpisodeOnDay(group: IcsSeriesGroup, dateStr: string) {
  return group.episodes
    .filter((ep) => ep.startAt.slice(0, 10) === dateStr)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
}
function episodesOnDay(group: IcsSeriesGroup, dateStr: string) {
  return group.episodes
    .filter((ep) => ep.startAt.slice(0, 10) === dateStr)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}
function isPremiereEpisode(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  if (!ep || ep.season !== 1 || ep.episode !== 1) return false;
  const numSeasons = group.tmdb?.number_of_seasons;
  if (numSeasons && numSeasons > 1) return false;
  if (group.key.startsWith("tmdb-") && group.tmdb?.first_air_date) {
    const airMs = new Date(group.tmdb.first_air_date).getTime();
    if (Date.now() - airMs > 180 * 24 * 3600 * 1000) return false;
  }
  return true;
}
function isSeasonStart(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  return !!ep && ep.episode === 1;
}
function isSeasonFinaleGuess(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  if (!ep) return false;
  const seasonEps = group.episodes.filter((item) => item.season === ep.season);
  const maxEp = Math.max(...seasonEps.map((item) => item.episode));
  return maxEp > 1 && ep.episode === maxEp;
}

// ── Score editorial do cliente ─────────────────────────────────────────────────
// Usado apenas para ORDENAÇÃO. Sem penalidades de diversidade no modo bruto.

function normalizePopularity(raw: number): number {
  if (!raw || raw <= 0) return 0;
  return Math.log10(Math.min(raw, 500) + 1) * 10;
}

function groupEditorialScore(
  group: IcsSeriesGroup,
  dateStr: string,
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
): number {
  const tmdbId = group.tmdb?.tmdb_id;
  const days = daysUntilDate(dateStr);
  const timeBoost = days <= 0 ? 18 : days === 1 ? 12 : days <= 7 ? 7 : Math.max(0, 6 - Math.floor(days / 5));
  const hasBackdrop = !!(group.tmdb?.clean_backdrop_path ?? group.tmdb?.backdrop_path);
  const hasPoster   = !!group.tmdb?.poster_path;
  const imgPenalty  = hasBackdrop ? 0 : hasPoster ? -25 : -60;
  const lang = group.tmdb?.original_language ?? "";
  const trendBoost = (() => {
    if (trendingDay.has(tmdbId ?? -1))  return 38;
    if (trendingWeek.has(tmdbId ?? -1)) return 20;
    return 0;
  })();
  return (
    (group.relevanceScore ?? 0) +
    normalizePopularity(group.tmdb?.popularity ?? 0) +
    trendBoost +
    (isPremiereEpisode(group, dateStr) ? 34 : 0) +
    (isSeasonFinaleGuess(group, dateStr) ? 30 : 0) +
    (isSeasonStart(group, dateStr) ? 12 : 0) +
    (group.episodeCount > 1 ? Math.min(12, group.episodeCount * 2) : 0) +
    timeBoost +
    imgPenalty
  );
}

function movieEditorialScore(
  movie: MovieGroup,
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
): number {
  const m = movie.movie;
  const days = daysUntilDate(m.release_date ?? todayStr());
  const timeBoost = days <= 0 ? 20 : days <= 3 ? 14 : days <= 7 ? 8 : Math.max(0, 5 - Math.floor(days / 7));
  const hasBackdrop = !!(m.clean_backdrop_path ?? m.backdrop_path);
  const hasPoster   = !!m.poster_path;
  const imgPenalty  = hasBackdrop ? 0 : hasPoster ? -20 : -50;
  const isPremiereToday = (days >= -3 && days <= 1);
  const rawScore =
    (movie.relevanceScore ?? 0) +
    normalizePopularity(m.popularity ?? 0) +
    (trendingDay.has(m.tmdb_id)  ? 35 : 0) +
    (trendingWeek.has(m.tmdb_id) ? 18 : 0) +
    (isPremiereToday ? 28 : 0) +
    timeBoost + imgPenalty;
  return rawScore * 0.72;
}

// ── Sinais editoriais ──────────────────────────────────────────────────────────

function editorialSignal(
  group: IcsSeriesGroup,
  dateStr: string,
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
  movie?: MovieGroup,
) {
  if (movie) {
    const tmdbId = movie.movie.tmdb_id;
    if (trendingDay.has(tmdbId))   return { label: "Explodindo agora",  color: "rose" as const };
    const days = daysUntilDate(movie.movie.release_date ?? dateStr);
    if (days === 0)                 return { label: "Estreia hoje",       color: "emerald" as const };
    if (days > 0 && days <= 3)     return { label: "Em breve",            color: "cyan" as const };
    if (days > 3 && days <= 14)    return { label: `Estreia em ${days}d`, color: "cyan" as const };
    if (days > 14)                  return { label: "Próxima estreia",     color: "slate" as const };
    if (trendingWeek.has(tmdbId))  return { label: "Trending",            color: "amber" as const };
    if ((movie.relevanceScore ?? 0) >= 65) return { label: "Imperdível",  color: "sky" as const };
    return { label: "Nos cinemas",  color: "slate" as const };
  }
  const tmdbId = group.tmdb?.tmdb_id;
  if (trendingDay.has(tmdbId ?? -1))        return { label: "Explodindo agora",   color: "rose" as const };
  if (isSeasonFinaleGuess(group, dateStr))  return { label: "Final de temporada", color: "violet" as const };
  if (isPremiereEpisode(group, dateStr))    return { label: "Estreia de série",   color: "emerald" as const };
  if (isSeasonStart(group, dateStr))        return { label: "Nova temporada",      color: "cyan" as const };
  if (trendingWeek.has(tmdbId ?? -1))       return { label: "Trending",            color: "amber" as const };
  if ((group.relevanceScore ?? 0) >= 70)    return { label: "Hype alto",           color: "sky" as const };
  return { label: "Novo episódio", color: "slate" as const };
}

// ── Categorias ─────────────────────────────────────────────────────────────────

const CAT_LABEL: Partial<Record<ContentCategory, string>> = {
  MOVIE: "Filme", SERIES: "Série", ANIMATION: "Animação",
  DOCUMENTARY: "Doc", REALITY_PREMIUM: "Reality", REALITY: "Reality",
  DAILY_SOAP: "Soap", VARIETY: "Variedade", KIDS: "Kids",
};
const CAT_COLOR: Partial<Record<ContentCategory, string>> = {
  MOVIE:           "bg-rose-500/20 text-rose-300/80 border-rose-500/20",
  SERIES:          "bg-sky-500/20 text-sky-300/80 border-sky-500/20",
  ANIMATION:       "bg-teal-500/20 text-teal-300/80 border-teal-500/20",
  DOCUMENTARY:     "bg-cyan-500/20 text-cyan-300/80 border-cyan-500/20",
  REALITY_PREMIUM: "bg-amber-500/20 text-amber-300/80 border-amber-500/20",
  REALITY:         "bg-orange-500/15 text-orange-300/60 border-orange-500/15",
  DAILY_SOAP:      "bg-white/[0.04] text-white/25 border-white/[0.07]",
};

function isCinematicPrestige(group: IcsSeriesGroup): boolean {
  if ((group.relevanceScore ?? 0) < 70) return false;
  const prestigeIds = new Set([49, 2552, 213, 1024, 453, 2739, 3353, 6, 67, 41077, 3268]);
  return (
    (group.tmdb?.networks ?? []).some((n) => prestigeIds.has(n.id)) ||
    (group.tmdb?.production_companies ?? []).some((c) => prestigeIds.has(c.id))
  );
}
function cinematicFallbackLabel(group: IcsSeriesGroup): string {
  const genres = group.tmdb?.genres ?? [];
  if (genres.some((g) => /crime|mistério|thriller/i.test(g))) return "Crime / Mistério";
  if (genres.some((g) => /drama/i.test(g))) return "Drama";
  if (genres.some((g) => /ficção|sci.fi|fantasy/i.test(g))) return "Ficção";
  return "Cinematic";
}
function resolveCinematicLabel(group: IcsSeriesGroup): { label: string; color: string } {
  if (isCinematicPrestige(group)) return { label: "Prestige", color: "bg-violet-500/20 text-violet-300/80 border-violet-500/20" };
  return { label: cinematicFallbackLabel(group), color: "bg-sky-500/20 text-sky-300/80 border-sky-500/10" };
}
function resolveCatLabel(group: IcsSeriesGroup): { label: string; color: string } {
  if (group.category === "CINEMATIC") return resolveCinematicLabel(group);
  const label = CAT_LABEL[group.category] ?? group.category;
  const color = CAT_COLOR[group.category] ?? "bg-white/[0.05] text-white/30 border-white/[0.08]";
  return { label, color };
}

// ── Tipos de grid ──────────────────────────────────────────────────────────────

type CardType = "hero" | "wide" | "square" | "poster" | "tall";
interface SlotDef { cardType: CardType; colSm: number; colXs: number; }
type RowDef = SlotDef[];

const ROW_H: Record<string, string> = {
  hero: "h-[320px]", wide: "h-[240px]", square: "h-[220px]", poster: "h-[260px]", tall: "h-[320px]",
};

const ROWS_DAY: RowDef[] = [
  [{ cardType:"hero",   colSm:8, colXs:12 }, { cardType:"poster", colSm:4, colXs:6 }],
  [{ cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }],
  [{ cardType:"poster", colSm:4, colXs:6 }, { cardType:"wide",   colSm:8, colXs:12 }],
  [{ cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  [{ cardType:"wide",   colSm:6, colXs:12 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }],
];
const ROWS_WEEK: RowDef[] = [
  [{ cardType:"hero",   colSm:6, colXs:12 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  [{ cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }],
  [{ cardType:"wide",   colSm:8, colXs:12 }, { cardType:"poster", colSm:4, colXs:6 }],
  [{ cardType:"poster", colSm:3, colXs:6 }, { cardType:"wide",   colSm:6, colXs:12 }, { cardType:"poster", colSm:3, colXs:6 }],
  [{ cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }, { cardType:"wide",   colSm:4, colXs:12 }],
  [{ cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
];
const ROWS_MONTH: RowDef[] = [
  [{ cardType:"wide",   colSm:6, colXs:12 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  [{ cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }],
  [{ cardType:"hero",   colSm:8, colXs:12 }, { cardType:"poster", colSm:4, colXs:6 }],
  [{ cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  [{ cardType:"square", colSm:3, colXs:6 }, { cardType:"wide",   colSm:6, colXs:12 }, { cardType:"square", colSm:3, colXs:6 }],
  [{ cardType:"wide",   colSm:6, colXs:12 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  [{ cardType:"poster", colSm:4, colXs:6 }, { cardType:"hero",   colSm:8, colXs:12 }],
  [{ cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }],
];
function getRows(mode: ViewMode): RowDef[] {
  if (mode === "day")  return ROWS_DAY;
  if (mode === "week") return ROWS_WEEK;
  return ROWS_MONTH;
}

// ── EditorialGroup ─────────────────────────────────────────────────────────────

type EditorialGroup = {
  group: IcsSeriesGroup;
  movie?: MovieGroup;
  dateStr: string;
  score: number;
  visualWeight: "hero" | "wide" | "poster" | "compact";
};

// ── buildEditorialGroups — MODO BRUTO (sem filtros editoriais) ────────────────

function buildEditorialGroups(
  sourceGroups: IcsSeriesGroup[],
  sourceMovies: MovieGroup[],
  options: {
    mode: ViewMode;
    selectedDay: string;
    weekStart: Date;
    year: number;
    month: number;
    trendingDay: Set<number>;
    trendingWeek: Set<number>;
  },
): EditorialGroup[] {
  const { start: windowStart, end: windowEnd } = activeWindow();
  const rangeStart =
    options.mode === "day"  ? options.selectedDay :
    options.mode === "week" ? toLocalDateStr(options.weekStart) :
    windowStart;
  const rangeEnd = (() => {
    if (options.mode === "day")  return options.selectedDay;
    if (options.mode === "week") {
      const end = new Date(options.weekStart);
      end.setDate(end.getDate() + 6);
      return toLocalDateStr(end);
    }
    return windowEnd;
  })();

  const seen  = new Set<string>();
  const items: EditorialGroup[] = [];

  // ── Séries ──────────────────────────────────────────────────────────────────
  for (const group of sourceGroups) {
    if (!hasValidTmdb(group)) continue;
    const ep = group.episodes
      .filter((item) => {
        const day = item.startAt.slice(0, 10);
        return day >= rangeStart && day <= rangeEnd;
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
    if (!ep) continue;
    const key = `${group.key}-${ep.startAt.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dateStr = ep.startAt.slice(0, 10);
    const score = groupEditorialScore(group, dateStr, options.trendingDay, options.trendingWeek);
    items.push({ group, dateStr, score, visualWeight: "compact" });
  }

  // ── Filmes ──────────────────────────────────────────────────────────────────
  for (const movie of sourceMovies) {
    if (!movie.isRelevant) continue;
    const releaseDate = movie.movie.release_date ?? todayStr();
    if (releaseDate < rangeStart || releaseDate > rangeEnd) continue;
    const key = movie.key;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = movieEditorialScore(movie, options.trendingDay, options.trendingWeek);
    items.push({ group: {} as IcsSeriesGroup, movie, dateStr: releaseDate, score, visualWeight: "compact" });
  }

  // Ordena por score
  items.sort((a, b) => b.score - a.score);

  // MODO BRUTO: sem cap de filmes, sem hard cap de idiomas, sem penalidade de diversidade.
  // Todos os itens válidos são incluídos. Apenas deduplicação técnica por chave.
  //
  // ── Camada futura de diversidade (DESLIGADA) ──────────────────────────────
  // Para reativar penalidades de diversidade descomente:
  //
  // const providerCount = new Map<string, number>();
  // const langCount     = new Map<string, number>();
  // ... aplicar penalidades por repetição ...
  // ─────────────────────────────────────────────────────────────────────────

  // Distribui pesos visuais: últimos 25% viram compact
  const len = items.length;
  return items.map((item, index) => {
    if (index >= len - Math.max(3, Math.floor(len * 0.25))) return { ...item, visualWeight: "compact" as const };
    return { ...item, visualWeight: "poster" as const };
  });
}

// ── buildDayMap ────────────────────────────────────────────────────────────────

function buildDayMap(groups: IcsSeriesGroup[]): Map<string, IcsSeriesGroup[]> {
  const map = new Map<string, IcsSeriesGroup[]>();
  for (const g of groups) {
    if (!hasValidTmdb(g)) continue;
    for (const ep of g.episodes) {
      const day = ep.startAt.slice(0, 10);
      const arr = map.get(day) ?? [];
      if (!arr.find((x) => x.key === g.key)) arr.push(g);
      map.set(day, arr);
    }
  }
  return map;
}

// ── buildSpotlightItems — MODO BRUTO (sem filtro de diversidade) ──────────────

interface SpotlightItem {
  group: IcsSeriesGroup;
  dateStr: string;
  isPremiere: boolean;
  isFinale: boolean;
  isTrendingDay: boolean;
  isTrendingWeek: boolean;
  label: string;
}

function buildSpotlightItems(
  featuredGroups: IcsSeriesGroup[],
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
): SpotlightItem[] {
  const today = todayStr();
  const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = toLocalDateStr(nextWeek);

  const items: SpotlightItem[] = [];
  const seen = new Set<string>();

  for (const g of featuredGroups) {
    if (!hasValidTmdb(g)) continue;
    if (seen.has(g.key)) continue;
    const upcomingEp = g.episodes.find(
      (ep) => ep.startAt.slice(0, 10) >= today && ep.startAt.slice(0, 10) <= nextWeekStr,
    );
    if (!upcomingEp) continue;
    const dateStr = upcomingEp.startAt.slice(0, 10);
    const daysUntil = Math.ceil(
      (new Date(dateStr + "T12:00:00").getTime() - Date.now()) / 86_400_000,
    );
    const label =
      daysUntil <= 0 ? "Hoje" :
      daysUntil === 1 ? "Amanhã" :
      new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
    const tmdbId = g.tmdb?.tmdb_id;
    const isTrendingDay  = tmdbId != null ? trendingDay.has(tmdbId)  : false;
    const isTrendingWeek = tmdbId != null ? trendingWeek.has(tmdbId) : false;
    const seasonEps = g.episodes.filter((ep) => ep.season === upcomingEp.season);
    const isPremiere = upcomingEp.episode === 1;
    const maxEp = Math.max(...seasonEps.map((e) => e.episode));
    const isFinale = upcomingEp.episode === maxEp && maxEp > 1;
    items.push({ group: g, dateStr, isPremiere, isFinale, isTrendingDay, isTrendingWeek, label });
    seen.add(g.key);
  }

  items.sort((a, b) => {
    const sA = (a.isTrendingDay ? 100 : 0) + (a.isPremiere ? 50 : 0) + (a.isFinale ? 40 : 0) + (a.isTrendingWeek ? 30 : 0) + (a.group.relevanceScore ?? 0);
    const sB = (b.isTrendingDay ? 100 : 0) + (b.isPremiere ? 50 : 0) + (b.isFinale ? 40 : 0) + (b.isTrendingWeek ? 30 : 0) + (b.group.relevanceScore ?? 0);
    if (sB !== sA) return sB - sA;
    return (b.group.tmdb?.popularity ?? 0) - (a.group.tmdb?.popularity ?? 0);
  });

  // MODO BRUTO: sem filtro de diversidade no spotlight.
  // ── Camada futura (DESLIGADA) ──────────────────────────────────────────────
  // Para reativar limite de 1 item asiático no spotlight descomente:
  // const ASIAN_SPOTLIGHT = new Set(["ko","ja","zh","th","hi","tl"]);
  // ... filtrar por asianSpotCount ...
  // ──────────────────────────────────────────────────────────────────────────

  return items.slice(0, 20);
}

// ── Componentes de UI ──────────────────────────────────────────────────────────

function SectionEyebrow({ children, color = "sky" }: { children: React.ReactNode; color?: "sky" | "rose" | "cyan" | "violet" | "teal" | "amber" }) {
  const colors = { sky: "bg-sky-400/60 text-sky-400/80", rose: "bg-rose-400/60 text-rose-400/80", cyan: "bg-cyan-400/60 text-cyan-400/80", violet: "bg-violet-400/60 text-violet-400/80", teal: "bg-teal-400/60 text-teal-400/80", amber: "bg-amber-400/60 text-amber-400/80" };
  const [bg, text] = colors[color].split(" ");
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${bg}`} />
      <p className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${text}`}>{children}</p>
    </div>
  );
}

function SectionDivider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent my-10" />;
}

const SIGNAL_STYLES = {
  rose:    "border-rose-400/25 bg-rose-500/15 text-rose-200",
  violet:  "border-violet-400/25 bg-violet-500/15 text-violet-200",
  emerald: "border-emerald-400/25 bg-emerald-500/15 text-emerald-200",
  cyan:    "border-cyan-400/25 bg-cyan-500/15 text-cyan-200",
  amber:   "border-amber-400/25 bg-amber-500/15 text-amber-200",
  sky:     "border-sky-400/25 bg-sky-500/15 text-sky-200",
  slate:   "border-white/[0.08] bg-white/[0.05] text-white/50",
};

function SignalBadge({ label, color }: { label: string; color: keyof typeof SIGNAL_STYLES }) {
  return <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${SIGNAL_STYLES[color]}`}>{label}</span>;
}

// ── NormalizedItem ─────────────────────────────────────────────────────────────

interface NormalizedItem {
  tmdbId: number; name: string; overview: string | null;
  backdrop: string | null; poster: string | null; voteAvg: number;
  category: ContentCategory; href: string; subLabel: string;
  dateLabel: string; days: number; isMovie: boolean;
}

function resolveItemData(item: EditorialGroup): NormalizedItem {
  const { movie, group, dateStr } = item;
  if (movie) {
    const m = movie.movie;
    const days = daysUntilDate(m.release_date ?? dateStr);
    const dateLabel = days < -7 ? "Nos cinemas" : days < 0 ? `Estreou há ${Math.abs(days)} dias` : days === 0 ? "Estreia hoje" : days === 1 ? "Amanhã" : `Em ${days} dias`;
    const backdrop = m.clean_backdrop_path != null ? TMDB_IMG(m.clean_backdrop_path, "w1280") : TMDB_IMG(m.backdrop_path ?? null, "w1280");
    return { tmdbId: m.tmdb_id, name: m.name ?? "", overview: m.overview ?? null, backdrop, poster: TMDB_IMG(m.poster_path ?? null, "w342"), voteAvg: m.vote_average ?? 0, category: "MOVIE", href: `/title/movie/${m.tmdb_id}`, subLabel: (m.genres ?? []).slice(0, 2).join(" · ") || "Cinema", dateLabel, days, isMovie: true };
  }
  const tmdb = group.tmdb!;
  const days = daysUntilDate(dateStr);
  const dateLabel = days <= 0 ? "Hoje" : days === 1 ? "Amanhã" : `Em ${days} dias`;
  const eps = episodesOnDay(group, dateStr);
  const firstEp = eps[0];
  const subLabel = firstEp ? `S${firstEp.season}E${firstEp.episode}${firstEp.episodeName && firstEp.episodeName.toLowerCase() !== "tba" ? ` · ${firstEp.episodeName}` : ""}` : "";
  return { tmdbId: tmdb.tmdb_id, name: tmdb.name, overview: tmdb.overview ?? null, backdrop: bestHorizontalImg(tmdb, "w1280"), poster: bestVerticalImg(tmdb), voteAvg: tmdb.vote_average ?? 0, category: group.category, href: `/title/tv/${tmdb.tmdb_id}`, subLabel, dateLabel, days, isMovie: false };
}

// ── Cards ──────────────────────────────────────────────────────────────────────

function AgendaEditorialHeroCard({ item, trendingDay, trendingWeek }: { item: EditorialGroup; trendingDay: Set<number>; trendingWeek: Set<number> }) {
  const d = resolveItemData(item);
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);
  const { label: catLabel, color: catColor } = d.isMovie ? { label: CAT_LABEL[d.category] ?? d.category, color: CAT_COLOR[d.category] ?? "bg-white/[0.05] text-white/30 border-white/[0.08]" } : resolveCatLabel(item.group);
  const firstEp = !item.movie ? (episodesOnDay(item.group, item.dateStr)[0] ?? null) : null;
  const showTime = firstEp && !firstEp.startAt.endsWith("T00:00:00.000Z");
  return (
    <a href={d.href} className="group relative w-full h-full overflow-hidden rounded-[26px] border border-white/[0.08] bg-zinc-950/80 text-left shadow-[0_18px_44px_rgba(0,0,0,0.34)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.16] block">
      {d.backdrop && <img src={d.backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.72] transition-transform duration-700 group-hover:scale-[1.03]" />}
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-zinc-950/38 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SignalBadge label={signal.label} color={signal.color} />
            <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${catColor}`}>{catLabel}</span>
            {!item.movie && item.group.streamingProvider && <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/15 px-2 py-1 text-[9px] font-black uppercase text-emerald-300/80">{item.group.streamingProvider.name}</span>}
            <span className="rounded-lg border border-white/[0.08] bg-black/20 px-2 py-1 text-[9px] font-black uppercase text-white/45">{d.dateLabel}</span>
          </div>
          {d.voteAvg > 0 && <span className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] font-black text-amber-200">★ {d.voteAvg.toFixed(1)}</span>}
        </div>
        <div className="flex items-end gap-5">
          {d.poster && <div className="hidden w-[104px] overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.04] shadow-[0_14px_32px_rgba(0,0,0,0.30)] sm:block"><img src={d.poster} alt={d.name} className="aspect-[2/3] w-full object-cover" /></div>}
          <div className="min-w-0 max-w-[650px]">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.08em] text-emerald-300/90">{d.subLabel}{showTime && firstEp ? ` · ${formatTime(firstEp.startAt)}` : ""}</p>
            <h2 className="mb-3 text-3xl font-black leading-none tracking-[-0.04em] text-white sm:text-5xl">{d.name}</h2>
            {d.overview && <p className="line-clamp-3 max-w-2xl text-[13px] leading-relaxed text-white/62">{d.overview}</p>}
          </div>
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialWideCard({ item, trendingDay, trendingWeek }: { item: EditorialGroup; trendingDay: Set<number>; trendingWeek: Set<number> }) {
  const d = resolveItemData(item);
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);
  return (
    <a href={d.href} className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.30)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block">
      {d.backdrop && <img src={d.backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.65] transition-transform duration-700 group-hover:scale-[1.04]" />}
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/72 via-zinc-950/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/60 via-transparent to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-5">
        <div className="flex items-center justify-between gap-3"><SignalBadge label={signal.label} color={signal.color} /><span className="text-[10px] font-bold uppercase text-white/38">{d.dateLabel}</span></div>
        <div className="max-w-[560px]">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-300/80">{d.subLabel || (d.isMovie ? "Cinema" : "Novo evento")}</p>
          <h3 className="line-clamp-2 text-2xl font-black leading-tight tracking-[-0.035em] text-white">{d.name}</h3>
          {d.overview && <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-white/52">{d.overview}</p>}
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialPosterCard({ item, trendingDay, trendingWeek }: { item: EditorialGroup; trendingDay: Set<number>; trendingWeek: Set<number> }) {
  const d = resolveItemData(item);
  const bgImg = d.poster ?? d.backdrop;
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);
  return (
    <a href={d.href} className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.30)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block">
      {bgImg && <img src={bgImg} alt="" className="absolute inset-0 h-full w-full object-cover object-top opacity-[0.75] transition-transform duration-700 group-hover:scale-[1.04]" />}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/72 via-zinc-950/20 to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-2"><SignalBadge label={signal.label} color={signal.color} />{d.voteAvg > 0 && <span className="rounded-lg border border-amber-400/15 bg-black/20 px-1.5 py-1 text-[10px] font-black text-amber-200/90">★ {d.voteAvg.toFixed(1)}</span>}</div>
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-300/80">{d.dateLabel}{d.subLabel ? ` · ${d.subLabel}` : ""}</p>
          <h3 className="line-clamp-2 text-[19px] font-black leading-tight tracking-[-0.035em] text-white">{d.name}</h3>
          {d.overview && <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-white/50">{d.overview}</p>}
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialSquareCard({ item, trendingDay, trendingWeek }: { item: EditorialGroup; trendingDay: Set<number>; trendingWeek: Set<number> }) {
  const d = resolveItemData(item);
  const bgImg = d.backdrop ?? d.poster;
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);
  return (
    <a href={d.href} className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block">
      {bgImg && <img src={bgImg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.60] transition-transform duration-700 group-hover:scale-[1.05]" />}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/50 via-transparent to-zinc-950/80" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/65 via-transparent to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-center justify-between gap-2"><SignalBadge label={signal.label} color={signal.color} />{d.voteAvg > 0 && <span className="rounded-lg border border-amber-400/15 bg-black/25 px-1.5 py-1 text-[10px] font-black text-amber-200/90">★ {d.voteAvg.toFixed(1)}</span>}</div>
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-[0.09em] text-emerald-300/80">{d.dateLabel}{d.subLabel ? ` · ${d.subLabel}` : ""}</p>
          <h3 className="line-clamp-2 text-[16px] font-black leading-tight tracking-[-0.03em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">{d.name}</h3>
        </div>
      </div>
    </a>
  );
}

function AgendaCompactCluster({ items }: { items: EditorialGroup[] }) {
  if (items.length === 0) return null;
  return (
    <div className="col-span-1 rounded-[24px] border border-white/[0.08] bg-zinc-900/80 shadow-[0_18px_50px_rgba(0,0,0,0.40)] backdrop-blur-xl p-4 sm:col-span-2 lg:col-span-4">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div><p className="text-[9px] font-black uppercase text-white/30">Agenda compactada</p><h3 className="text-[18px] font-black text-white">Também relevantes</h3></div>
        <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] font-black text-white/30">{items.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.slice(0, 12).map((editorialItem) => {
          const d = resolveItemData(editorialItem);
          return (
            <a key={`${editorialItem.movie ? `movie-${d.tmdbId}` : editorialItem.group.key}-${editorialItem.dateStr}`} href={d.href} className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-2.5 text-left transition-colors hover:border-white/[0.10] hover:bg-white/[0.05]">
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">{(d.backdrop ?? d.poster) && <img src={(d.backdrop ?? d.poster)!} alt="" className="h-full w-full object-cover object-center" loading="lazy" />}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-black text-white/85">{d.name}</p>
                <p className="mt-1 text-[10px] font-bold text-white/35">{d.dateLabel}{d.subLabel ? ` · ${d.subLabel}` : ""}{!editorialItem.movie && editorialItem.group.streamingProvider && <span className="ml-1.5 text-emerald-400/70">· {editorialItem.group.streamingProvider.name}</span>}</p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── Feed editorial ─────────────────────────────────────────────────────────────

function AgendaEditorialFeed({ items, mode, isLoading, trendingDay, trendingWeek }: { items: EditorialGroup[]; mode: ViewMode; isLoading: boolean; trendingDay: Set<number>; trendingWeek: Set<number> }) {
  const rows = getRows(mode);
  const nonCmp  = items.filter(i => i.visualWeight !== "compact");
  const compact = items.filter(i => i.visualWeight === "compact");

  if (isLoading && items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {rows.slice(0, 2).map((row, rIdx) => (
          <div key={rIdx} className={`grid gap-3 ${ROW_H[row[0].cardType]}`} style={{ gridTemplateColumns: "repeat(12, 1fr)" }}>
            {row.map((slot, sIdx) => <div key={sIdx} className="h-full rounded-2xl bg-white/[0.035] animate-pulse" style={{ gridColumn: `span ${slot.colSm}` }} />)}
          </div>
        ))}
      </div>
    );
  }

  if (nonCmp.length === 0) {
    return (
      <div className="rounded-[24px] border border-white/[0.08] bg-zinc-900/80 px-6 py-14 text-center">
        <p className="text-[14px] font-black text-white/35">Nenhum conteúdo neste período.</p>
        <p className="mt-1 text-[11px] text-white/20">Aguardando novos eventos no feed.</p>
      </div>
    );
  }

  const renderedRows: Array<{ rowDef: RowDef; items: EditorialGroup[] }> = [];
  const spillover: EditorialGroup[] = [];
  let cursor = 0; let rIdx = 0;
  while (cursor < nonCmp.length) {
    const rowDef  = rows[rIdx % rows.length];
    const remaining = nonCmp.length - cursor;
    if (remaining === 0) break;
    if (remaining >= rowDef.length) {
      renderedRows.push({ rowDef, items: nonCmp.slice(cursor, cursor + rowDef.length) });
      cursor += rowDef.length;
    } else {
      const smaller = rows.find(r => r.length === remaining);
      if (smaller) renderedRows.push({ rowDef: smaller, items: nonCmp.slice(cursor, cursor + remaining) });
      else spillover.push(...nonCmp.slice(cursor, cursor + remaining));
      cursor += remaining;
    }
    rIdx++;
  }
  const allCompact = [...spillover, ...compact].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-3">
      {renderedRows.map((row, rIdx) => {
        const dominantType = row.rowDef.reduce<CardType>((best, slot) => {
          const order: CardType[] = ["hero", "wide", "poster", "square", "tall"];
          return order.indexOf(slot.cardType) < order.indexOf(best) ? slot.cardType : best;
        }, "square");
        return (
          <div key={rIdx} className={`grid gap-3 ${ROW_H[dominantType]}`} style={{ gridTemplateColumns: "repeat(12, 1fr)" }}>
            {row.items.map((item, cIdx) => {
              const slot = row.rowDef[cIdx];
              const key  = `${item.group.key}-${item.dateStr}-${rIdx}-${cIdx}`;
              return (
                <div key={key} className="h-full min-w-0" style={{ gridColumn: `span ${slot.colSm}` }}>
                  {slot.cardType === "hero"   && <AgendaEditorialHeroCard   item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                  {slot.cardType === "wide"   && <AgendaEditorialWideCard   item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                  {slot.cardType === "square" && <AgendaEditorialSquareCard item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                  {slot.cardType === "poster" && <AgendaEditorialPosterCard item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                </div>
              );
            })}
          </div>
        );
      })}
      {allCompact.length > 0 && <AgendaCompactCluster items={allCompact} />}
    </div>
  );
}

// ── RadarHero com seletor de modo ──────────────────────────────────────────────

function RadarHero({
  phase, viewMode, onChangeViewMode, filteredCount, filteredEps, enrichProgress, spotlightItems,
  radarMode, onChangeRadarMode, isLoadingMode,
}: {
  phase: Phase; viewMode: ViewMode; onChangeViewMode: (m: ViewMode) => void;
  filteredCount: number; filteredEps: number; enrichProgress: number;
  spotlightItems: SpotlightItem[]; radarMode: RadarMode;
  onChangeRadarMode: (m: RadarMode) => void; isLoadingMode: boolean;
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  const [idx, setIdx]         = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((nextIdx: number) => {
    setVisible(false);
    setTimeout(() => { setIdx(nextIdx); setVisible(true); }, 280);
  }, []);

  useEffect(() => {
    if (spotlightItems.length === 0) return;
    timerRef.current = setTimeout(() => goTo((idx + 1) % spotlightItems.length), SPOTLIGHT_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [idx, spotlightItems.length, goTo]);

  // Reseta idx quando itens mudam (troca de modo)
  useEffect(() => { setIdx(0); setVisible(true); }, [spotlightItems]);

  const item     = spotlightItems[idx] ?? null;
  const tmdb     = item?.group.tmdb ?? null;
  const backdrop = tmdb ? bestHorizontalImg(tmdb, "w1280") : null;
  const poster   = tmdb ? bestVerticalImg(tmdb) : null;
  const itemName = tmdb?.name ?? null;
  const { label: catLabel, color: catColor } = item ? resolveCatLabel(item.group) : { label: "", color: "" };
  const badge = item
    ? (item.isTrendingDay  ? { text: "Em alta hoje",       cls: "bg-rose-500/20 text-rose-300 border-rose-500/25" }
    : item.isPremiere      ? { text: "Estreia",            cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/25" }
    : item.isFinale        ? { text: "Final de temporada", cls: "bg-violet-500/20 text-violet-300 border-violet-500/25" }
    : item.isTrendingWeek  ? { text: "Em alta na semana",  cls: "bg-amber-500/20 text-amber-300 border-amber-500/25" }
    : null)
    : null;
  const href = tmdb ? `/title/tv/${tmdb.tmdb_id}` : "#";

  return (
    <div className="relative isolate mb-9 overflow-hidden rounded-[2rem] border border-white/[0.10] shadow-[0_32px_100px_rgba(0,0,0,0.55)]">
      <div className="absolute inset-0 -z-10 bg-zinc-950" />
      <div className="absolute inset-0 -z-10 transition-opacity duration-700" style={{ opacity: visible ? 1 : 0.6 }}>
        {backdrop ? <img src={backdrop} alt="" className="h-full w-full object-cover object-center" /> : <div className="h-full w-full bg-gradient-to-br from-zinc-900 to-black" />}
        <div className="absolute inset-0 bg-black/75" />
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
      </div>
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 15% 0%, rgba(56,189,248,0.18) 0%, transparent 55%)" }} />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 90% 100%, rgba(16,185,129,0.10) 0%, transparent 50%)" }} />
      <div className="absolute inset-0 -z-10 opacity-[0.015]" style={{ backgroundImage: "linear-gradient(0deg,white 1px,transparent 1px),linear-gradient(90deg,white 1px,transparent 1px)", backgroundSize: "64px 64px" }} />

      {/* Faixa superior */}
      <div className="relative px-6 pt-6 pb-0 sm:px-9 sm:pt-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-400/80">Radar · POPLOG</span>
              <span className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${phase === "done" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/70" : "border-sky-500/20 bg-sky-500/10 text-sky-400/70"}`}>
                <span className={`w-1 h-1 rounded-full ${phase === "done" ? "bg-emerald-400/80" : "bg-sky-400/80 animate-pulse"}`} />
                {phase === "done" ? "Engine ativa" : PHASE_LABELS[phase]}
              </span>
            </div>
            <p className="text-[12px] text-white/25 capitalize">{today}</p>
          </div>

          {/* Tabs de período */}
          <div className="flex items-center gap-1 rounded-2xl border border-white/[0.09] bg-black/30 p-1 backdrop-blur-md shrink-0">
            {(["day", "week", "month"] as ViewMode[]).map((v) => (
              <button key={v} type="button" onClick={() => onChangeViewMode(v)}
                className={`text-[11px] font-bold px-3.5 py-1.5 rounded-lg transition-all duration-200 ${viewMode === v ? "border border-sky-300/25 bg-sky-300/[0.14] text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.12)]" : "text-white/30 hover:text-white/55"}`}>
                {v === "day" ? "Hoje" : v === "week" ? "Semana" : "30 dias"}
              </button>
            ))}
          </div>
        </div>

        {/* Título + métricas + seletor de modo */}
        <div className="flex items-center gap-4 flex-wrap mt-4 mb-5">
          <h1 className="text-4xl sm:text-5xl font-black text-white leading-none tracking-[-0.06em]">Radar</h1>
          {filteredCount > 0 && (
            <>
              <div className="h-6 w-px bg-white/10 ml-1" />
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black text-white/75 tabular-nums">{filteredCount}</span>
                <span className="text-[11px] text-white/30">séries</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black text-emerald-300 tabular-nums">{filteredEps.toLocaleString("pt-BR")}</span>
                <span className="text-[11px] text-white/30">episódios</span>
              </div>
            </>
          )}
        </div>

        {/* ── Seletor de modo Geral / Personalizado ── */}
        <div className="flex items-center gap-2 pb-5">
          <div className="flex items-center gap-1 rounded-2xl border border-white/[0.09] bg-black/40 p-1 backdrop-blur-md">
            <button
              type="button"
              onClick={() => onChangeRadarMode("general")}
              disabled={isLoadingMode}
              className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-all duration-200 ${
                radarMode === "general"
                  ? "border border-sky-300/20 bg-sky-400/[0.12] text-sky-100 shadow-[0_0_20px_rgba(56,189,248,0.10)]"
                  : "text-white/35 hover:text-white/60"
              }`}
            >
              {/* Ícone globo */}
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
                <circle cx="10" cy="10" r="8" />
                <path d="M2 10h16M10 2c-2 2.5-3 5-3 8s1 5.5 3 8M10 2c2 2.5 3 5 3 8s-1 5.5-3 8" strokeLinecap="round" />
              </svg>
              Geral
              {radarMode === "general" && (
                <span className="text-[8px] font-black uppercase tracking-wide text-sky-400/60">Ativo</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onChangeRadarMode("personal")}
              disabled={isLoadingMode}
              className={`group flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-all duration-200 ${
                radarMode === "personal"
                  ? "border border-violet-300/20 bg-violet-400/[0.12] text-violet-100 shadow-[0_0_20px_rgba(139,92,246,0.10)]"
                  : "text-white/35 hover:text-white/60"
              }`}
            >
              {/* Ícone usuário */}
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-3.5 h-3.5 shrink-0">
                <circle cx="10" cy="7" r="3.5" />
                <path d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6" strokeLinecap="round" />
              </svg>
              Personalizado
              {radarMode === "personal" && (
                <span className="text-[8px] font-black uppercase tracking-wide text-violet-400/60">Ativo</span>
              )}
              {isLoadingMode && radarMode !== "personal" && (
                <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
              )}
            </button>
          </div>

          {radarMode === "personal" && (
            <span className="text-[10px] text-white/25">
              Baseado na sua watchlist e histórico
            </span>
          )}
          {radarMode === "general" && (
            <span className="text-[10px] text-white/25">
              Descoberta ampla — todos os lançamentos
            </span>
          )}
        </div>
      </div>

      {/* Hero cinematográfico */}
      {spotlightItems.length > 0 && item && tmdb && (
        <div className="relative cursor-pointer overflow-hidden" style={{ minHeight: 220 }} onClick={() => router.push(href)}>
          <div className="absolute top-0 inset-x-6 sm:inset-x-9 h-px bg-white/[0.06]" />
          {spotlightItems.length > 1 && (
            <>
              <button type="button" aria-label="Anterior" onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx - 1 + spotlightItems.length) % spotlightItems.length); }} className="sm:hidden absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.20] bg-black/50 backdrop-blur-sm">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/70"><path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" aria-label="Próximo" onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx + 1) % spotlightItems.length); }} className="sm:hidden absolute right-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.20] bg-black/50 backdrop-blur-sm">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/70"><path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
          <div className="relative flex items-end gap-5 p-5 sm:p-7 min-h-[240px] transition-opacity duration-300" style={{ opacity: visible ? 1 : 0 }}>
            {poster && <div className="hidden sm:block w-[80px] shrink-0 rounded-xl overflow-hidden border border-white/[0.10] shadow-xl shadow-black/40"><img src={poster} alt={itemName ?? ""} className="w-full aspect-[2/3] object-cover" /></div>}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${catColor}`}>{catLabel}</span>
                {item.group.streamingProvider && <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border bg-emerald-500/15 text-emerald-300/80 border-emerald-500/20">{item.group.streamingProvider.name}</span>}
                {badge && <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${badge.cls}`}>{badge.text}</span>}
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/35 border border-white/[0.08] rounded-lg px-2 py-0.5">{item.label}</span>
              </div>
              <h3 className="text-2xl sm:text-[28px] font-black tracking-[-0.04em] text-white/95 leading-none mb-2 line-clamp-2">{itemName}</h3>
              {tmdb.overview && <p className="text-[12px] text-white/40 leading-relaxed line-clamp-2 max-w-lg mb-2.5">{tmdb.overview}</p>}
              <div className="flex items-center gap-3 flex-wrap">
                {(tmdb.vote_average ?? 0) > 0 && <div className="flex items-center gap-1"><svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg><span className="text-[12px] font-black text-amber-300">{tmdb.vote_average.toFixed(1)}</span></div>}
                {tmdb.networks && tmdb.networks.length > 0 && <span className="text-[11px] text-white/30">{tmdb.networks[0].name}</span>}
                {(tmdb.number_of_seasons ?? 0) > 0 && <span className="text-[11px] text-white/20">{tmdb.number_of_seasons} temporada{(tmdb.number_of_seasons ?? 0) !== 1 ? "s" : ""}</span>}
              </div>
            </div>
            {spotlightItems.length > 1 && (
              <div className="hidden sm:flex flex-col items-center gap-2 shrink-0 self-center">
                <button type="button" aria-label="Anterior" onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx - 1 + spotlightItems.length) % spotlightItems.length); }} className="flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.15] bg-white/[0.06] hover:bg-white/[0.14] transition-all"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/60"><path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                <button type="button" aria-label="Próximo" onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx + 1) % spotlightItems.length); }} className="flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.15] bg-white/[0.06] hover:bg-white/[0.14] transition-all"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/60"><path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg></button>
                <div className="flex flex-col gap-1 mt-1">
                  {spotlightItems.slice(0, Math.min(spotlightItems.length, 8)).map((_, i) => (
                    <button key={i} type="button" onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo(i); }} className={`rounded-full transition-all duration-300 ${i === idx ? "h-4 w-1.5 bg-white/60" : "h-1.5 w-1.5 bg-white/20 hover:bg-white/35"}`} aria-label={`Slide ${i + 1}`} />
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/[0.05]">
            <div className="h-full bg-white/25 rounded-full" style={{ animation: `spotlight-progress ${SPOTLIGHT_MS}ms linear`, animationPlayState: "running", width: "100%", transformOrigin: "left" }} key={idx} />
          </div>
        </div>
      )}

      {spotlightItems.length === 0 && phase !== "done" && <div className="min-h-[180px] animate-pulse" />}

      <style>{`@keyframes spotlight-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
    </div>
  );
}

// ── Painel do modo Personalizado ───────────────────────────────────────────────

function PersonalRadarPanel({ data }: { data: AgendaV2CompatResponse | null }) {
  if (!data) {
    return (
      <div className="rounded-[24px] border border-white/[0.08] bg-zinc-900/80 px-6 py-14 text-center">
        <p className="text-[14px] font-black text-white/35">Carregando radar personalizado…</p>
      </div>
    );
  }

  const { personal, calendar } = data;
  const allPersonal = [
    ...personal.today,
    ...personal.thisWeek,
    ...personal.upcoming,
  ].slice(0, 40);

  if (allPersonal.length === 0 && calendar.cinemaHighlights.length === 0) {
    return (
      <div className="rounded-[24px] border border-violet-500/10 bg-violet-950/10 px-6 py-14 text-center">
        <p className="text-[14px] font-black text-white/35">Nenhum conteúdo personalizado disponível.</p>
        <p className="mt-2 text-[12px] text-white/20">Adicione títulos à sua watchlist para ver sugestões personalizadas.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {personal.today.length > 0 && (
        <section>
          <SectionEyebrow color="rose">Hoje</SectionEyebrow>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-3">
            {personal.today.slice(0, 9).map((ev) => (
              <a key={ev.id} href={`/title/${ev.mediaType}/${ev.tmdbId}`}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 hover:bg-white/[0.05] transition-colors">
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                  {ev.backdropPath && <img src={TMDB_IMG(ev.backdropPath, "w185")!} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-white/85">{ev.title}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">
                    {ev.episodeNumber ? `S${ev.seasonNumber ?? 1}E${ev.episodeNumber}` : ""}
                    {ev.airDate ? ` · ${daysUntilDate(ev.airDate) <= 0 ? "Hoje" : `Em ${daysUntilDate(ev.airDate)} dias`}` : ""}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {personal.thisWeek.length > 0 && (
        <section>
          <SectionEyebrow color="sky">Esta semana</SectionEyebrow>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-3">
            {personal.thisWeek.slice(0, 9).map((ev) => (
              <a key={ev.id} href={`/title/${ev.mediaType}/${ev.tmdbId}`}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 hover:bg-white/[0.05] transition-colors">
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                  {ev.backdropPath && <img src={TMDB_IMG(ev.backdropPath, "w185")!} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-white/85">{ev.title}</p>
                  <p className="text-[10px] text-white/35 mt-0.5">
                    {ev.episodeNumber ? `S${ev.seasonNumber ?? 1}E${ev.episodeNumber}` : ""}
                    {ev.airDate ? ` · ${daysUntilDate(ev.airDate) <= 0 ? "Hoje" : `Em ${daysUntilDate(ev.airDate)} dias`}` : ""}
                    {ev.provider ? ` · ${ev.provider.name}` : ""}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {personal.leavingSoon.length > 0 && (
        <section>
          <SectionEyebrow color="amber">Saindo em breve</SectionEyebrow>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 mt-3">
            {personal.leavingSoon.slice(0, 6).map((ev) => (
              <a key={ev.id} href={`/title/${ev.mediaType}/${ev.tmdbId}`}
                className="flex items-center gap-3 rounded-2xl border border-amber-500/15 bg-amber-950/10 p-3 hover:bg-amber-950/20 transition-colors">
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                  {ev.backdropPath && <img src={TMDB_IMG(ev.backdropPath, "w185")!} alt="" className="h-full w-full object-cover" loading="lazy" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-white/85">{ev.title}</p>
                  <p className="text-[10px] text-amber-300/60 mt-0.5">
                    {ev.daysUntil != null ? `Sai em ${ev.daysUntil} dias` : "Saindo em breve"}
                    {ev.provider ? ` · ${ev.provider.name}` : ""}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}

      {calendar.cinemaHighlights.length > 0 && (
        <section>
          <SectionEyebrow color="violet">Cinema</SectionEyebrow>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 mt-3">
            {calendar.cinemaHighlights.slice(0, 8).map((ev) => (
              <a key={ev.id} href={`/title/${ev.mediaType}/${ev.tmdbId}`}
                className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.05] transition-colors aspect-[2/3] block">
                {ev.posterPath && <img src={TMDB_IMG(ev.posterPath, "w342")!} alt={ev.title} className="absolute inset-0 h-full w-full object-cover" loading="lazy" />}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-2 right-2">
                  <p className="text-[11px] font-black text-white/90 leading-tight line-clamp-2">{ev.title}</p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ── RadarClient — componente principal ─────────────────────────────────────────

export default function RadarClient({
  initialData,
  initialMode,
}: {
  initialData: IcsAgendaResponse | null;
  initialMode: RadarMode;
}) {
  const hydrate = (gs: IcsSeriesGroup[]): IcsSeriesGroup[] =>
    gs.map((g) => ({ ...g, episodes: g.episodes.map((ep) => ({ ...ep })) }));

  // ── Estado do Radar Geral ──────────────────────────────────────────────────
  const [groups, setGroups]           = useState<IcsSeriesGroup[]>(() =>
    initialData ? hydrate(initialData.groups ?? []) : []
  );
  const [featuredGroups, setFeatured] = useState<IcsSeriesGroup[]>(() =>
    initialData ? hydrate(initialData.featuredGroups ?? []) : []
  );
  const [movies, setMovies]           = useState<MovieGroup[]>(() => initialData?.movies ?? []);
  const [phase, setPhase]             = useState<Phase>(() => initialData ? "done" : "idle");
  const [error, setError]             = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState(0);

  const trendingDayRef  = useRef<Set<number>>(new Set(initialData?.trendingDay  ?? []));
  const trendingWeekRef = useRef<Set<number>>(new Set(initialData?.trendingWeek ?? []));

  // ── Estado do Radar Personalizado ────────────────────────────────────────
  const [personalData, setPersonalData] = useState<AgendaV2CompatResponse | null>(null);

  // ── Estado do modo ────────────────────────────────────────────────────────
  const [radarMode, setRadarMode]       = useState<RadarMode>(initialMode);
  const [isLoadingMode, setIsLoadingMode] = useState(false);

  // ── Estado de navegação ────────────────────────────────────────────────────
  const now = new Date();
  const [viewMode, setViewMode]             = useState<ViewMode>("week");
  const [navYear, setNavYear]               = useState(now.getFullYear());
  const [navMonth, setNavMonth]             = useState(now.getMonth());
  const [navWeekStart, setNavWeekStart]     = useState(() => startOfWeek(now));
  const [selectedDay, setSelectedDay]       = useState(todayStr());

  // ── Carregamento inicial do modo geral (cache frio) ───────────────────────
  useEffect(() => {
    if (initialData) return; // cache quente — sem fetch necessário

    let cancelled = false;
    async function load() {
      setPhase("fetching_ics");
      try {
        const res = await fetch("/api/ics/agenda");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPhase("grouping");
        const data = await res.json() as IcsAgendaResponse;
        if (cancelled) return;
        setPhase("cache_check");
        trendingDayRef.current  = new Set(data.trendingDay  ?? []);
        trendingWeekRef.current = new Set(data.trendingWeek ?? []);
        const hydratedGroups   = hydrate(data.groups ?? []);
        const hydratedFeatured = hydrate(data.featuredGroups ?? []);
        setGroups(hydratedGroups);
        setFeatured(hydratedFeatured);
        setMovies(data.movies ?? []);
        const needsEnrich = hydratedFeatured.filter((g) => !g.tmdb);
        if (needsEnrich.length === 0) { setPhase("done"); return; }
        setPhase("enriching");
        const batches: IcsSeriesGroup[][] = [];
        for (let i = 0; i < needsEnrich.length; i += ENRICH_BATCH) batches.push(needsEnrich.slice(i, i + ENRICH_BATCH));
        let done = 0;
        for (const batch of batches) {
          if (cancelled) break;
          try {
            const enrichRes = await fetch("/api/ics/enrich", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ titles: batch.map((g) => g.rawTitle) }) });
            if (enrichRes.ok) {
              const { results } = await enrichRes.json() as { results: Record<string, import("@/lib/ics-engine").TmdbEnrichment | null> };
              const td = trendingDayRef.current; const tw = trendingWeekRef.current;
              const apply = (prev: IcsSeriesGroup[]) => prev.map((g) => results[g.rawTitle] !== undefined && !g.tmdb ? { ...g, tmdb: results[g.rawTitle] } : g).filter((g) => filterEnrichedGroup(g, td, tw));
              setFeatured(apply); setGroups(apply);
            }
          } catch (e) { console.warn("[radar] enrich batch error:", e); }
          done += batch.length;
          setEnrichProgress((done / needsEnrich.length) * 100);
          if (done < needsEnrich.length) await new Promise((r) => setTimeout(r, ENRICH_PAUSE));
        }
        if (!cancelled) setPhase("done");
      } catch (err) {
        if (!cancelled) { setError(err instanceof Error ? err.message : "Erro"); setPhase("done"); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [initialData]);

  // ── Alternância de modo ────────────────────────────────────────────────────
  const handleChangeRadarMode = useCallback(async (newMode: RadarMode) => {
    if (newMode === radarMode || isLoadingMode) return;
    setIsLoadingMode(true);
    setRadarMode(newMode);

    if (newMode === "personal") {
      try {
        const res = await fetch("/api/radar?mode=personal");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { personal?: AgendaV2CompatResponse };
        setPersonalData(data.personal ?? null);
      } catch (err) {
        console.warn("[radar] erro ao carregar modo personalizado:", err);
        setPersonalData(null);
      }
    }
    // Para o modo geral os dados já estão carregados

    setIsLoadingMode(false);
  }, [radarMode, isLoadingMode]);

  // ── Dados visíveis ────────────────────────────────────────────────────────
  const visibleFeatured = useMemo(() => featuredGroups.filter(hasValidTmdb), [featuredGroups]);

  const filteredCount = visibleFeatured.length;
  const filteredEps   = useMemo(
    () => visibleFeatured.reduce((acc, g) => acc + g.episodeCount, 0),
    [visibleFeatured],
  );

  const spotlightItems = useMemo(
    () => buildSpotlightItems(visibleFeatured, trendingDayRef.current, trendingWeekRef.current),
    [visibleFeatured],
  );

  const isLoading = phase !== "done" && phase !== "idle";
  const editorialItems = useMemo(
    () => buildEditorialGroups(visibleFeatured, movies, {
      mode: viewMode, selectedDay, weekStart: navWeekStart, year: navYear, month: navMonth,
      trendingDay: trendingDayRef.current, trendingWeek: trendingWeekRef.current,
    }),
    [viewMode, selectedDay, navWeekStart, navYear, navMonth, visibleFeatured, movies],
  );

  return (
    <PageShell variant="wide">

      <RadarHero
        phase={phase}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        filteredCount={filteredCount}
        filteredEps={filteredEps}
        enrichProgress={enrichProgress}
        spotlightItems={spotlightItems}
        radarMode={radarMode}
        onChangeRadarMode={handleChangeRadarMode}
        isLoadingMode={isLoadingMode}
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-950/20 px-5 py-4 text-[12px] text-red-300/80">
          Erro ao carregar feed: {error}
        </div>
      )}

      <SectionDivider />

      {/* Conteúdo varia conforme o modo */}
      {radarMode === "general" ? (
        <section>
          <AgendaEditorialFeed
            items={editorialItems}
            mode={viewMode}
            isLoading={isLoading || isLoadingMode}
            trendingDay={trendingDayRef.current}
            trendingWeek={trendingWeekRef.current}
          />
        </section>
      ) : (
        <section>
          {isLoadingMode ? (
            <div className="flex flex-col gap-3">
              {[0,1,2].map((i) => (
                <div key={i} className="h-[60px] rounded-2xl bg-white/[0.035] animate-pulse" />
              ))}
            </div>
          ) : (
            <PersonalRadarPanel data={personalData} />
          )}
        </section>
      )}

      <div className="mt-10 flex items-center gap-2 border-t border-white/[0.05] pt-6">
        <span className={`w-1.5 h-1.5 rounded-full ${phase === "done" ? "bg-emerald-400/60" : "bg-amber-400/60 animate-pulse"}`} />
        <ContextualAttribution
          context="calendar"
          sourcesUsed={["bancodeseries", "tmdb"]}
        />
      </div>

    </PageShell>
  );
}
