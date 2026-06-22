"use client";

// ── RadarClient ────────────────────────────────────────────────────────────────
// Componente principal da página /radar.
//
// Dois modos de visualização, alternáveis com um clique:
//   • Geral   — engine Trakt Calendar/Releases, descoberta ampla
//   • Personalizado — mesma engine Trakt, filtrada pela biblioteca do usuário
//
// MODO BRUTO (ativo agora):
//   Sem filtros editoriais de idioma, gênero, popularidade ou plataforma.
//   A engine recebe e exibe tudo que for válido. Filtros e pesos ficam
//   preparados na estrutura mas desligados, prontos para ativação gradual.
// ──────────────────────────────────────────────────────────────────────────────

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useOptionalUserData } from "@/context/UserDataContext";
import { useRouter } from "next/navigation";
import ContextualAttribution from "@/components/attribution/ContextualAttribution";
import PageShell from "@/components/layout/PageShell";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";
import type {
  IcsSeriesGroup,
  MovieGroup,
  CinemaReleaseGroup,
  ContentCategory,
} from "@/lib/ics-engine";
import {
  classifyContentType,
  itemMatchesFilter,
  CONTENT_FILTER_LABELS,
  type ContentFilterKey,
  type ContentTypeResult,
} from "@/lib/radar/content-type-filter";
import type {
  IcsAgendaResponse,
  RadarSections,
} from "@/app/api/ics/agenda/route";
import type { RadarMode } from "@/app/api/radar/route";
import type {
  AgendaV2CompatResponse,
  LegacyAgendaTv,
  LegacyAgendaMovie,
} from "@/server/agenda/types";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";

// ── Library state context ───────────────────────────────────────────────────────

type LibraryEntry = { status: string; isFavorite: boolean };
type LibraryLookup = Map<string, LibraryEntry>;

const RadarLibraryCtx = createContext<LibraryLookup>(new Map());

const STATUS_BADGE_MAP: Record<string, { label: string; cls: string }> = {
  watched:   { label: "Assistido",  cls: "border-emerald-500/40 bg-emerald-900/70 text-emerald-300" },
  watchlist: { label: "Watchlist",  cls: "border-sky-500/40 bg-sky-900/70 text-sky-300" },
  watching:  { label: "Assistindo", cls: "border-violet-500/40 bg-violet-900/70 text-violet-300" },
  abandoned: { label: "Abandonado", cls: "border-rose-500/40 bg-rose-900/70 text-rose-300" },
  fridge:    { label: "Geladeira",  cls: "border-amber-500/40 bg-amber-900/70 text-amber-300" },
};

function RadarLibraryBadge({ tmdbId, mediaType }: { tmdbId: number; mediaType: "movie" | "tv" }) {
  const lib = useContext(RadarLibraryCtx);
  const entry = lib.get(`${tmdbId}:${mediaType}`);
  if (!entry) return null;

  const statusKey = entry.isFavorite && entry.status === "watched" ? "watched" : entry.status;
  const badge = STATUS_BADGE_MAP[statusKey];
  if (!badge) return null;

  return (
    <span
      className={`pointer-events-none absolute top-2.5 left-2.5 z-20 rounded-md border px-2 py-0.5 text-[8.5px] font-black uppercase tracking-wide backdrop-blur-sm ${badge.cls}`}
    >
      {entry.isFavorite && entry.status === "watched" ? `★ ${badge.label}` : badge.label}
    </span>
  );
}

// ── Constantes ─────────────────────────────────────────────────────────────────

const TMDB_IMG = (path: string | null | undefined, size: string) =>
  resolveCatalogImage(path, size);

const POSTER_TEXT_LANGS = new Set([
  "ja",
  "ko",
  "zh",
  "th",
  "hi",
  "ar",
  "he",
  "ru",
  "uk",
  "vi",
  "id",
]);

function bestHorizontalImg(
  tmdb: {
    backdrop_path: string | null;
    poster_path: string | null;
    clean_backdrop_path?: string | null;
  },
  size = "w780",
): string | null {
  const path = tmdb.clean_backdrop_path ?? tmdb.backdrop_path;
  if (!path) return null;
  return TMDB_IMG(path, size);
}

function bestVerticalImg(tmdb: {
  backdrop_path: string | null;
  poster_path: string | null;
  clean_backdrop_path?: string | null;
  original_language?: string;
}): string | null {
  const lang = tmdb.original_language ?? "";
  const cleanBd = tmdb.clean_backdrop_path ?? tmdb.backdrop_path;
  if (POSTER_TEXT_LANGS.has(lang)) {
    // Idiomas com texto no poster — prefere backdrop limpo para evitar texto ilegível
    return TMDB_IMG(cleanBd, "w1280") || TMDB_IMG(tmdb.poster_path, "w500");
  }
  return TMDB_IMG(tmdb.poster_path, "w500") || TMDB_IMG(cleanBd, "w1280");
}

const SPOTLIGHT_MS = 6000;

// ── Fases do carregamento ──────────────────────────────────────────────────────

type Phase =
  | "idle"
  | "fetching_ics"
  | "grouping"
  | "cache_check"
  | "enriching"
  | "done";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "Iniciando radar…",
  fetching_ics: "Lendo Trakt…",
  grouping: "Agrupando séries…",
  cache_check: "Consultando cache…",
  enriching: "Enriquecendo dados…",
  done: "Radar ativo",
};

// Progresso base por fase (0-100) — o enrich complementa de 65% a 95%
const PHASE_PROGRESS: Record<Phase, number> = {
  idle: 0,
  fetching_ics: 15,
  grouping: 40,
  cache_check: 55,
  enriching: 65,
  done: 100,
};

type ViewMode = "all" | "day" | "week" | "month";

const VIEW_MODE_OPTIONS: { value: ViewMode; label: string }[] = [
  { value: "all", label: "Visão Geral" },
  { value: "day", label: "Destaques" },
  { value: "week", label: "Semana" },
  { value: "month", label: "Próximos" },
];

// ── Helpers de data ────────────────────────────────────────────────────────────

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function todayStr() {
  return toLocalDateStr(new Date());
}
function addDaysStr(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return toLocalDateStr(date);
}
function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}
function formatWeekRange(start: Date) {
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const o: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return `${start.toLocaleDateString("pt-BR", o)} – ${end.toLocaleDateString("pt-BR", o)}`;
}
function formatDayFull(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
function formatTime(isoStr: string): string {
  return new Date(isoStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
function daysUntilDate(dateStr: string): number {
  const date = new Date(`${dateStr}T12:00:00`);
  const today = new Date(`${todayStr()}T12:00:00`);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}
function hasDisplayableData(g: IcsSeriesGroup): boolean {
  return !!(g.tmdb?.name ?? g.rawTitle);
}

function hasValidTmdb(g: IcsSeriesGroup): boolean {
  return !!(g.tmdb?.name && (g.tmdb?.poster_path || g.tmdb?.backdrop_path));
}

function groupDisplayName(g: IcsSeriesGroup): string {
  const fallback = g as IcsSeriesGroup & { title?: string; name?: string };
  return (
    g.tmdb?.name ??
    fallback.title ??
    fallback.name ??
    g.rawTitle ??
    "Título sem nome"
  );
}

function hasDisplayableGroup(g: IcsSeriesGroup): boolean {
  return (
    !!groupDisplayName(g) && Array.isArray(g.episodes) && g.episodes.length > 0
  );
}

function sectionMetaColor(
  section: string | undefined,
): keyof typeof SIGNAL_STYLES {
  if (section === "destaques") return "emerald";
  if (section === "vemAi") return "cyan";
  if (section === "novosEpisodios") return "sky";
  return "slate";
}

function firstEpisodeOnDay(group: IcsSeriesGroup, dateStr: string) {
  return (
    group.episodes
      .filter((ep) => ep.startAt.slice(0, 10) === dateStr)
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null
  );
}
function isGenericTmdbSignal(group: IcsSeriesGroup): boolean {
  if (group.source !== "tmdb") return false;
  const tag = group.sourceTag ?? "";
  const hasEventSource =
    tag.includes("airing_today") ||
    tag.includes("tracked_") ||
    tag.includes("discover_") ||
    tag.includes("upcoming");
  return (
    !hasEventSource &&
    !group.episodes.some((ep) => ep.season > 0 && ep.episode > 0)
  );
}
function episodesOnDay(group: IcsSeriesGroup, dateStr: string) {
  return group.episodes
    .filter((ep) => ep.startAt.slice(0, 10) === dateStr)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}
function isPremiereEpisode(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  if (!ep || ep.season !== 1 || ep.episode !== 1) return false;
  // Conta como estreia se S01E01 foi ao ar nos últimos 180 dias (independente de nº de temporadas)
  if (group.tmdb?.first_air_date) {
    const airMs = new Date(group.tmdb.first_air_date).getTime();
    if (Date.now() - airMs > 180 * 24 * 3600 * 1000) return false;
  }
  return true;
}
function isSeasonStart(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  return !!ep && ep.season > 0 && ep.episode === 1;
}
function isSeasonFinaleGuess(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  if (!ep || ep.season <= 0 || ep.episode <= 0) return false;
  const seasonEps = group.episodes.filter((item) => item.season === ep.season);
  const maxEp = Math.max(...seasonEps.map((item) => item.episode));
  return maxEp > 1 && ep.episode === maxEp;
}

// ── Score editorial do cliente ─────────────────────────────────────────────────
// Usado apenas para ORDENAÇÃO. Sem penalidades de diversidade no modo bruto.

function normalizePopularity(raw: number): number {
  if (!raw || raw <= 0) return 0;
  // Teto 2000: séries mainstream (Euphoria ~1500, Stranger Things ~2000) ficam separadas
  return Math.log10(Math.min(raw, 2000) + 1) * 12;
}

// Fix 1: score de qualidade via vote_average — threshold mínimo de votos para evitar
// inflar séries de nicho com poucos votos altos (ex: 2 votos de 10.0)
function voteQualityScore(voteAvg: number, voteCount: number): number {
  if (voteCount < 50) return 0;          // sem votos suficientes, neutro
  const deviation = voteAvg - 5.5;       // centro em 5.5 (média real do TMDB)
  return Math.max(-10, deviation * 5);   // 5.5→0, 8.0→+12.5, 9.0→+17.5, 4.0→-7.5
}

function groupEditorialScore(
  group: IcsSeriesGroup,
  dateStr: string,
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
): number {
  const tmdbId = group.tmdb?.tmdb_id;
  const days = daysUntilDate(dateStr);

  // Boost temporal: episódio recente tem prioridade sobre "vem aí" distante
  const timeBoost =
    days <= 0
      ? 18
      : days === 1
        ? 12
        : days <= 7
          ? 7
          : Math.max(0, 6 - Math.floor(days / 5));

  const hasBackdrop = !!(
    group.tmdb?.clean_backdrop_path ?? group.tmdb?.backdrop_path
  );
  const hasPoster = !!group.tmdb?.poster_path;
  const imgPenalty = hasBackdrop ? 0 : hasPoster ? -25 : -60;

  // Fix 3: trending com boosts diferenciados (day >> week)
  const trendBoost = (() => {
    if (trendingDay.has(tmdbId ?? -1)) return 45;   // era 38 — dia tem mais peso
    if (trendingWeek.has(tmdbId ?? -1)) return 22;  // era 20
    return 0;
  })();

  // Fix 5: tier da plataforma entra no score (Netflix/HBO/Apple > canais locais)
  // Cria um EditorialGroup temporário apenas com os dados necessários para editorialTier
  const fakeItem = { group, movie: undefined } as unknown as EditorialGroup;
  const tierBoost = editorialTier(fakeItem) * 6;  // tier4→+24, tier3→+18, tier2→+12, tier1→+6

  // Fix 1: qualidade via vote_average (mínimo 50 votos para contar)
  const quality = voteQualityScore(
    group.tmdb?.vote_average ?? 0,
    group.tmdb?.vote_count ?? 0,
  );

  const isPremiere   = isPremiereEpisode(group, dateStr);
  const isFinale     = isSeasonFinaleGuess(group, dateStr);
  const isStart      = isSeasonStart(group, dateStr);

  // Fix 6: "evento do dia" — estreia/finale + trending ou alta relevância = boost extra
  const isEventDay =
    (isPremiere || isFinale) &&
    (trendingDay.has(tmdbId ?? -1) || (group.relevanceScore ?? 0) >= 70);
  const eventDayBoost = isEventDay ? 20 : 0;

  return (
    (group.relevanceScore ?? 0) +
    normalizePopularity(group.tmdb?.popularity ?? 0) +
    trendBoost +
    tierBoost +
    quality +
    (isPremiere ? 34 : 0) +
    (isFinale   ? 30 : 0) +
    (isStart    ? 12 : 0) +
    eventDayBoost +
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
  const timeBoost =
    days <= 0
      ? 20
      : days <= 3
        ? 14
        : days <= 7
          ? 8
          : Math.max(0, 5 - Math.floor(days / 7));
  const hasBackdrop = !!(m.clean_backdrop_path ?? m.backdrop_path);
  const hasPoster = !!m.poster_path;
  const imgPenalty = hasBackdrop ? 0 : hasPoster ? -20 : -50;
  const isPremiereToday = days >= -3 && days <= 1;

  // Fix 3: trending day mais pesado
  const trendBoost =
    trendingDay.has(m.tmdb_id) ? 45 :
    trendingWeek.has(m.tmdb_id) ? 22 : 0;

  // Fix 1: qualidade via vote_average
  const quality = voteQualityScore(m.vote_average ?? 0, m.vote_count ?? 0);

  const rawScore =
    (movie.relevanceScore ?? 0) +
    normalizePopularity(m.popularity ?? 0) +
    trendBoost +
    quality +
    (isPremiereToday ? 28 : 0) +
    timeBoost +
    imgPenalty;
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
    if (trendingDay.has(tmdbId))
      return { label: "Explodindo agora", color: "rose" as const };
    const days = daysUntilDate(movie.movie.release_date ?? dateStr);
    if (days === 0) return { label: "Estreia hoje", color: "emerald" as const };
    if (days > 0 && days <= 3)
      return { label: "Em breve", color: "cyan" as const };
    if (days > 3 && days <= 14)
      return { label: `Estreia em ${days}d`, color: "cyan" as const };
    if (days > 14) return { label: "Próxima estreia", color: "slate" as const };
    if (trendingWeek.has(tmdbId))
      return { label: "Trending", color: "amber" as const };
    if ((movie.relevanceScore ?? 0) >= 65)
      return { label: "Imperdível", color: "sky" as const };
    return { label: "Nos cinemas", color: "slate" as const };
  }
  const meta = group.sectionMeta as
    | { section?: string; badge?: string; reason?: string }
    | undefined;

  if (meta?.badge || meta?.reason) {
    return {
      // Badge principal deve ser curto. Detalhes de episódio/data ficam no subtítulo.
      label: meta.badge ?? "Novo episódio",
      color: sectionMetaColor(meta.section),
    };
  }

  const tmdbId = group.tmdb?.tmdb_id;
  if (trendingDay.has(tmdbId ?? -1))
    return { label: "Explodindo agora", color: "rose" as const };
  if (isSeasonFinaleGuess(group, dateStr))
    return { label: "Final de temporada", color: "violet" as const };
  if (isPremiereEpisode(group, dateStr))
    return { label: "Estreia de série", color: "emerald" as const };
  if (isSeasonStart(group, dateStr))
    return { label: "Nova temporada", color: "cyan" as const };
  if (trendingWeek.has(tmdbId ?? -1))
    return { label: "Trending", color: "amber" as const };
  if ((group.relevanceScore ?? 0) >= 70)
    return { label: "Hype alto", color: "sky" as const };
  return { label: "Novo episódio", color: "slate" as const };
}

// ── Categorias ─────────────────────────────────────────────────────────────────

const CAT_LABEL: Partial<Record<ContentCategory, string>> = {
  MOVIE: "Filme",
  SERIES: "Série",
  ANIMATION: "Animação",
  DOCUMENTARY: "Doc",
  REALITY_PREMIUM: "Reality",
  REALITY: "Reality",
  DAILY_SOAP: "Soap",
  VARIETY: "Variedade",
  KIDS: "Kids",
};
const CAT_COLOR: Partial<Record<ContentCategory, string>> = {
  MOVIE: "bg-rose-500/20 text-rose-300/80 border-rose-500/20",
  SERIES: "bg-sky-500/20 text-sky-300/80 border-sky-500/20",
  ANIMATION: "bg-teal-500/20 text-teal-300/80 border-teal-500/20",
  DOCUMENTARY: "bg-cyan-500/20 text-cyan-300/80 border-cyan-500/20",
  REALITY_PREMIUM: "bg-amber-500/20 text-amber-300/80 border-amber-500/20",
  REALITY: "bg-orange-500/15 text-orange-300/60 border-orange-500/15",
  DAILY_SOAP: "bg-white/[0.04] text-white/25 border-white/[0.07]",
};

function isCinematicPrestige(group: IcsSeriesGroup): boolean {
  if ((group.relevanceScore ?? 0) < 70) return false;
  const prestigeIds = new Set([
    49, 2552, 213, 1024, 453, 2739, 3353, 6, 67, 41077, 3268,
  ]);
  return (
    (group.tmdb?.networks ?? []).some((n) => prestigeIds.has(n.id)) ||
    (group.tmdb?.production_companies ?? []).some((c) => prestigeIds.has(c.id))
  );
}
function cinematicFallbackLabel(group: IcsSeriesGroup): string {
  const genres = group.tmdb?.genres ?? [];
  if (genres.some((g) => /crime|mistério|thriller/i.test(g)))
    return "Crime / Mistério";
  if (genres.some((g) => /drama/i.test(g))) return "Drama";
  if (genres.some((g) => /ficção|sci.fi|fantasy/i.test(g))) return "Ficção";
  return "Cinematic";
}
function resolveCinematicLabel(group: IcsSeriesGroup): {
  label: string;
  color: string;
} {
  if (isCinematicPrestige(group))
    return {
      label: "Prestige",
      color: "bg-violet-500/20 text-violet-300/80 border-violet-500/20",
    };
  return {
    label: cinematicFallbackLabel(group),
    color: "bg-sky-500/20 text-sky-300/80 border-sky-500/10",
  };
}
function resolveCatLabel(group: IcsSeriesGroup): {
  label: string;
  color: string;
} {
  if (group.category === "CINEMATIC") return resolveCinematicLabel(group);
  const label = CAT_LABEL[group.category] ?? group.category;
  const color =
    CAT_COLOR[group.category] ??
    "bg-white/[0.05] text-white/30 border-white/[0.08]";
  return { label, color };
}

// ── Tipos de grid ──────────────────────────────────────────────────────────────

type CardType = "hero" | "wide" | "square" | "poster" | "tall";
interface SlotDef {
  cardType: CardType;
  colSm: number;
  colXs: number;
}
type RowDef = SlotDef[];

const ROW_H_SM: Record<CardType, string> = {
  hero: "sm:h-[320px]",
  wide: "sm:h-[240px]",
  square: "sm:h-[220px]",
  poster: "sm:h-[260px]",
  tall: "sm:h-[320px]",
};

const MOBILE_CARD_H: Record<CardType, string> = {
  hero: "h-[300px]",
  wide: "h-[230px]",
  square: "h-[210px]",
  poster: "h-[260px]",
  tall: "h-[300px]",
};

function mobileColSpan(rowDef: RowDef, slotIndex: number): number {
  const slot = rowDef[slotIndex];
  if (slot.colXs !== 6) return slot.colXs;

  let runStart = slotIndex;
  while (runStart > 0 && rowDef[runStart - 1].colXs === 6) runStart--;

  let runEnd = slotIndex;
  while (runEnd + 1 < rowDef.length && rowDef[runEnd + 1].colXs === 6)
    runEnd++;

  const runLength = runEnd - runStart + 1;
  const runPosition = slotIndex - runStart;
  return runLength % 2 === 1 && runPosition === runLength - 1 ? 12 : 6;
}

const slotGridStyle = (slot: SlotDef, rowDef: RowDef, slotIndex: number): CSSProperties =>
  ({
    "--radar-col-xs": mobileColSpan(rowDef, slotIndex),
    "--radar-col-sm": slot.colSm,
  }) as CSSProperties;

const ROWS_DAY: RowDef[] = [
  [
    { cardType: "hero", colSm: 8, colXs: 12 },
    { cardType: "poster", colSm: 4, colXs: 6 },
  ],
  [
    { cardType: "square", colSm: 4, colXs: 6 },
    { cardType: "square", colSm: 4, colXs: 6 },
    { cardType: "square", colSm: 4, colXs: 6 },
  ],
  [
    { cardType: "poster", colSm: 4, colXs: 6 },
    { cardType: "wide", colSm: 8, colXs: 12 },
  ],
  [
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
  ],
  [
    { cardType: "wide", colSm: 6, colXs: 12 },
    { cardType: "square", colSm: 3, colXs: 6 },
    { cardType: "square", colSm: 3, colXs: 6 },
  ],
];
const ROWS_WEEK: RowDef[] = [
  [
    { cardType: "hero", colSm: 6, colXs: 12 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
  ],
  [
    { cardType: "square", colSm: 3, colXs: 6 },
    { cardType: "square", colSm: 3, colXs: 6 },
    { cardType: "square", colSm: 3, colXs: 6 },
    { cardType: "square", colSm: 3, colXs: 6 },
  ],
  [
    { cardType: "wide", colSm: 8, colXs: 12 },
    { cardType: "poster", colSm: 4, colXs: 6 },
  ],
  [
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "wide", colSm: 6, colXs: 12 },
    { cardType: "poster", colSm: 3, colXs: 6 },
  ],
  [
    { cardType: "square", colSm: 4, colXs: 6 },
    { cardType: "square", colSm: 4, colXs: 6 },
    { cardType: "wide", colSm: 4, colXs: 12 },
  ],
  [
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
  ],
];
const ROWS_MONTH: RowDef[] = [
  [
    { cardType: "wide", colSm: 6, colXs: 12 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
  ],
  [
    { cardType: "square", colSm: 4, colXs: 6 },
    { cardType: "square", colSm: 4, colXs: 6 },
    { cardType: "square", colSm: 4, colXs: 6 },
  ],
  [
    { cardType: "hero", colSm: 8, colXs: 12 },
    { cardType: "poster", colSm: 4, colXs: 6 },
  ],
  [
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
  ],
  [
    { cardType: "square", colSm: 3, colXs: 6 },
    { cardType: "wide", colSm: 6, colXs: 12 },
    { cardType: "square", colSm: 3, colXs: 6 },
  ],
  [
    { cardType: "wide", colSm: 6, colXs: 12 },
    { cardType: "poster", colSm: 3, colXs: 6 },
    { cardType: "poster", colSm: 3, colXs: 6 },
  ],
  [
    { cardType: "poster", colSm: 4, colXs: 6 },
    { cardType: "hero", colSm: 8, colXs: 12 },
  ],
  [
    { cardType: "square", colSm: 3, colXs: 6 },
    { cardType: "square", colSm: 3, colXs: 6 },
    { cardType: "square", colSm: 3, colXs: 6 },
    { cardType: "square", colSm: 3, colXs: 6 },
  ],
];
function getRows(mode: ViewMode): RowDef[] {
  if (mode === "all") return ROWS_WEEK;
  if (mode === "day") return ROWS_DAY;
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
  /** Classificação de tipo de conteúdo para os filtros do Radar */
  contentType: ContentTypeResult;
};

function itemOriginalLanguage(item: EditorialGroup): string {
  return item.movie
    ? (item.movie.movie.original_language ?? "")
    : (item.group.tmdb?.original_language ?? "");
}

function itemIsAnime(item: EditorialGroup): boolean {
  if (item.movie) return item.movie.movie.genre_ids?.includes(16) ?? false;
  return (
    item.group.category === "ANIMATION" ||
    item.group.tmdb?.genre_ids?.includes(16) === true
  );
}

// ── Classificação de tipo de conteúdo ─────────────────────────────────────────

function resolveContentType(group: IcsSeriesGroup, movie?: MovieGroup): ContentTypeResult {
  if (movie) {
    return classifyContentType({
      category: "MOVIE",
      isMovie: true,
      originalLanguage: movie.movie.original_language ?? null,
      originCountry: movie.movie.origin_country ?? null,
      genreIds: movie.movie.genre_ids ?? null,
      tmdbType: null,
      title: movie.movie.name ?? movie.movie.original_name ?? "",
    });
  }
  // Usa refined_category quando disponível — pode reclassificar SERIES→KIDS etc.
  const effectiveCategory = group.tmdb?.refined_category ?? group.category;
  return classifyContentType({
    category: effectiveCategory,
    isMovie: false,
    originalLanguage: group.tmdb?.original_language ?? null,
    originCountry: group.tmdb?.origin_country ?? null,
    genreIds: group.tmdb?.genre_ids ?? null,
    tmdbType: group.tmdb?.tmdb_type ?? null,
    title: group.tmdb?.name ?? group.rawTitle ?? "",
  });
}

// ── buildEditorialGroups ──────────────────────────────────────────────────────

function episodeKey(
  group: IcsSeriesGroup,
  ep: { startAt?: string; season?: number; episode?: number },
  fallbackDate: string,
): string {
  const tmdbId = group.tmdb?.tmdb_id ?? "no-tmdb";
  const groupKey = group.key ?? group.rawTitle ?? groupDisplayName(group);
  const date = ep.startAt?.slice(0, 10) ?? fallbackDate;
  const season = ep.season ?? 0;
  const episode = ep.episode ?? 0;
  return `${tmdbId}-${groupKey}-${date}-S${season}-E${episode}`;
}

function syntheticEpisodeFromMeta(group: IcsSeriesGroup) {
  const meta = group.sectionMeta;
  if (!meta?.selectedEpisode || !meta.episodeDate) return null;
  return {
    startAt: `${meta.episodeDate}T00:00:00.000Z`,
    season: meta.selectedEpisode.season,
    episode: meta.selectedEpisode.episode,
    episodeName: meta.selectedEpisode.episodeName ?? "",
  };
}


function selectedEpisodesForGroup(
  group: IcsSeriesGroup,
  useSectionGroups: boolean,
  rangeStart: string,
  rangeEnd: string,
) {
  const episodes = Array.isArray(group.episodes) ? group.episodes : [];

  // RAW/sections: cada grupo já representa um cluster de evento
  // (mesmo título + mesma data + mesma temporada). Então o card deve ser único.
  if (useSectionGroups) {
    return episodes
      .filter((ep) => !!ep.startAt)
      .sort((a, b) =>
        String(a.startAt ?? "").localeCompare(String(b.startAt ?? "")),
      );
  }

  // Fallback legado: respeita janela temporal.
  return episodes
    .filter((ep) => {
      const day = ep.startAt?.slice(0, 10);
      return !!day && day >= rangeStart && day <= rangeEnd;
    })
    .sort((a, b) =>
      String(a.startAt ?? "").localeCompare(String(b.startAt ?? "")),
    );
}

function editorialClusterKey(group: IcsSeriesGroup, dateStr: string): string {
  const firstEp = (group.episodes ?? [])[0];
  const season = firstEp?.season ?? group.sectionMeta?.selectedEpisode?.season ?? 0;
  const tmdbId = group.tmdb?.tmdb_id ? `tmdb:${group.tmdb.tmdb_id}` : "";
  const title = groupDisplayName(group).toLowerCase().trim();
  return `${tmdbId || title}|${dateStr}|s${season}`;
}

function itemPopularity(item: EditorialGroup): number {
  if (item.movie) return item.movie.movie.popularity ?? 0;
  return item.group.tmdb?.popularity ?? 0;
}

function itemEventText(item: EditorialGroup): string {
  return [
    item.group.sectionMeta?.reason,
    item.group.sectionMeta?.episodeLabel,
    item.group.sectionMeta?.clusterLabel,
    item.group.sectionMeta?.releasePattern,
    item.movie?.sourceTag,
    item.group.sourceTag,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function itemMatchesRadarFilter(item: EditorialGroup, filter: ContentFilterKey): boolean {
  if (filter === "all") return true;
  const text = itemEventText(item);
  const diff = daysUntilDate(item.dateStr);
  if (filter === "today") return diff === 0;
  if (filter === "week") return diff >= 0 && diff <= 10;
  if (filter === "streaming") return text.includes("streaming") || text.includes("digital") || text.includes("movie_streaming") || text.includes("movie_digital");
  if (filter === "premieres") return text.includes("estreia") || text.includes("premiere") || text.includes("new_show") || text.includes("season_premiere");
  if (filter === "finales") return text.includes("final");
  if (filter === "recent") return diff < 0 || text.includes("ainda em tempo");
  if (filter === "cinema") return text.includes("cinema") || text.includes("theatrical") || text.includes("movie_theatrical");
  if (filter === "physical") return text.includes("physical") || text.includes("mídia física") || text.includes("midia fisica");
  if (filter === "season_drop") return text.includes("temporada completa") || text.includes("season_drop");
  if (filter === "talk_news") return item.group.category === "NEWS" || item.group.category === "VARIETY";
  if (filter === "sports") return item.group.category === "SPORTS";
  if (filter === "live") return item.group.category === "LIVE_EVENT";
  if (filter === "kids") return item.group.category === "KIDS";
  return itemMatchesFilter(item.contentType, filter);
}

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
    /** Quando fornecido, ignora filtragem por data — backend já particionou */
    sectionGroups?: IcsSeriesGroup[];
    /** Filmes de cinema para o modo atual (cinemaToday / cinemaThisWeek / cinemaNext) */
    cinemaGroups?: CinemaReleaseGroup[];
  },
): EditorialGroup[] {
  const today = todayStr();

  const useSectionGroups = options.sectionGroups != null;
  const groupsToUse = useSectionGroups ? options.sectionGroups! : sourceGroups;

  const rangeStart =
    options.mode === "day"
      ? addDaysStr(-3)
      : options.mode === "week"
        ? addDaysStr(1)
        : addDaysStr(1);
  const rangeEnd =
    options.mode === "day"
      ? today
      : options.mode === "week"
        ? addDaysStr(30)
        : addDaysStr(30);

  const seen = new Set<string>();
  const items: EditorialGroup[] = [];

  // Séries: sem filtro por TMDB, imagem, idioma, categoria, score ou origem.
  // No RAW/sections, cada grupo já é um cluster por data+temporada e vira 1 card.
  for (const group of groupsToUse) {
    const selectedEpisodes = selectedEpisodesForGroup(
      group,
      useSectionGroups,
      rangeStart,
      rangeEnd,
    );

    const fallbackDate = group.sectionMeta?.episodeDate ?? today;

    // Filtro mínimo: precisa ter pelo menos um título exibível
    if (!hasDisplayableData(group)) continue;
    // Grupos sem backdrop/poster recebem penalidade de imagem no score (-60),
    // mas não são descartados — aparecem como cards de texto compactos.

    if (useSectionGroups) {
      const dateStr =
        selectedEpisodes[0]?.startAt?.slice(0, 10) ??
        group.sectionMeta?.episodeDate ??
        fallbackDate;

      const key = editorialClusterKey(group, dateStr);
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({
        group,
        dateStr,
        score: groupEditorialScore(
          group,
          dateStr,
          options.trendingDay,
          options.trendingWeek,
        ),
        visualWeight: "poster",
        contentType: resolveContentType(group),
      });
      continue;
    }

    if (selectedEpisodes.length === 0) {
      const key = `${group.key ?? group.rawTitle ?? groupDisplayName(group)}-${fallbackDate}-synthetic`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        group,
        dateStr: fallbackDate,
        score: group.relevanceScore ?? 0,
        visualWeight: "poster",
        contentType: resolveContentType(group),
      });
      continue;
    }

    // Legado: um item por episódio apenas quando não estamos usando sections/RAW.
    for (const ep of selectedEpisodes) {
      const dateStr =
        ep.startAt?.slice(0, 10) || group.sectionMeta?.episodeDate || today;
      const key = episodeKey(group, ep, dateStr);
      if (seen.has(key)) continue;
      seen.add(key);
      const score = groupEditorialScore(
        group,
        dateStr,
        options.trendingDay,
        options.trendingWeek,
      );
      items.push({ group, dateStr, score, visualWeight: "poster", contentType: resolveContentType(group) });
    }
  }

  // Cinema: usa cinemaGroups (pré-selecionados por aba) ou sourceMovies como fallback.
  const cinemaReleaseToMovieGroup = (cr: CinemaReleaseGroup): MovieGroup => ({
    key: cr.key,
    source: "tmdb",
    movie: {
      tmdb_id: cr.movie.tmdb_id,
      release_date: cr.releaseDate,
      backdrop_path: cr.movie.backdrop_path ?? null,
      poster_path: cr.movie.poster_path ?? null,
      clean_backdrop_path: cr.movie.clean_backdrop_path ?? null,
      popularity: cr.movie.popularity,
      vote_average: cr.movie.vote_average,
      vote_count: cr.movie.vote_count,
      original_language: cr.movie.original_language,
      overview: cr.movie.overview ?? null,
      name: cr.movie.name,
      original_name: cr.movie.original_name,
      genre_ids: cr.movie.genre_ids,
      genres: cr.movie.genres,
      origin_country: cr.movie.origin_country,
    },
  });

  // Threshold de relevância para filmes — exclui títulos muito obscuros.
  // Popularidade TMDB >= 8 OU vote_count >= 20 garante que há audiência real.
  const MOVIE_MIN_POPULARITY = 8;
  const MOVIE_MIN_VOTE_COUNT = 20;
  function isRelevantMovie(m: MovieGroup["movie"]): boolean {
    const pop = m.popularity ?? 0;
    const votes = m.vote_count ?? 0;
    return pop >= MOVIE_MIN_POPULARITY || votes >= MOVIE_MIN_VOTE_COUNT;
  }

  const cinemaSource: MovieGroup[] = options.cinemaGroups
    ? options.cinemaGroups
        .filter((cr) => !!(cr.movie.backdrop_path || cr.movie.clean_backdrop_path))
        .filter((cr) => isRelevantMovie(cr.movie))
        .map(cinemaReleaseToMovieGroup)
    : !useSectionGroups
      ? sourceMovies.filter((mg) => isRelevantMovie(mg.movie))
      : [];

  const cinemaItems: EditorialGroup[] = [];
  for (const movie of cinemaSource) {
    const releaseDate = movie.movie.release_date ?? today;
    const key = `movie-${movie.movie.tmdb_id}-${releaseDate}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = movieEditorialScore(movie, options.trendingDay, options.trendingWeek);
    cinemaItems.push({ group: {} as IcsSeriesGroup, movie, dateStr: releaseDate, score, visualWeight: "poster", contentType: resolveContentType({} as IcsSeriesGroup, movie) });
  }

  // Sort: tier editorial (empresa) → popularidade TMDB → data
  const sortByTierThenPop = (a: EditorialGroup, b: EditorialGroup): number => {
    const td = editorialTier(b) - editorialTier(a);
    if (td !== 0) return td;
    return itemPopularity(b) - itemPopularity(a);
  };
  items.sort(sortByTierThenPop);
  cinemaItems.sort(sortByTierThenPop);

  // Intercalar filmes de cinema a cada 5 posições.
  const merged: EditorialGroup[] = [];
  let ciIdx = 0;
  for (let i = 0; i < items.length; i++) {
    if (ciIdx < cinemaItems.length && i > 0 && i % 5 === 0) merged.push(cinemaItems[ciIdx++]);
    merged.push(items[i]);
  }
  while (ciIdx < cinemaItems.length) merged.push(cinemaItems[ciIdx++]);

  return merged;
}

// ── TMDB ID → editorial tier (sem risco de falso positivo) ──────────────────
const TIER_BY_TMDB_ID: Record<number, number> = {
  // Tier 4 — Apple TV+, HBO, Max, Warner
  2552: 4, 49: 4, 3268: 4, 3081: 4, 174: 4, 22213: 4,
  // Tier 3 — Disney, Marvel, Lucasfilm, Pixar, FX, Hulu, Universal, Netflix
  2739: 3, 6125: 3, 53: 3, 2: 3, 1024: 3, 3: 3, 1081: 3, 6394: 3, 7505: 3, 2301: 3, 33: 3,
  // Tier 2 — Paramount, Prime, Sony, MGM, A24, Neon, BBC, AMC, Lionsgate
  4: 2, 9: 2, 332: 2, 67: 2, 1709: 2, 21: 2, 318: 2,
  // Tier 1 — Peacock, Sky, Canal+, Blumhouse etc.
  3353: 1, 1375: 1,
};

// Regex estritos com word boundary ou anchors para evitar falsos positivos.
const EDITORIAL_TIERS: Array<{ tier: number; patterns: RegExp[] }> = [
  {
    tier: 4,
    patterns: [
      /apple\s+tv\+/i, /apple\s+original/i, /apple\s+studios/i,
      /hbo/i, /hbo\s+max/i, /^max$/i,
      /warner\s+bros\.?\s+discovery/i, /dc\s+studios/i,
    ],
  },
  {
    tier: 3,
    patterns: [
      /disney\+/i, /walt\s+disney\s+(pictures|television|animation|studios)/i, /^disney$/i,
      /marvel\s+studios/i, /lucasfilm/i, /pixar/i,
      /searchlight\s+pictures/i,
      /^fx$/i, /fx\s+productions/i, /^hulu$/i,
      /universal\s+pictures/i, /nbcuniversal/i, /^focus\s+features$/i,
      /^netflix$/i,
    ],
  },
  {
    tier: 2,
    patterns: [
      /^paramount\+?$/i, /paramount\s+(network|pictures|television)/i,
      /^showtime$/i,
      /^prime\s+video$/i, /amazon\s+(studios|mgm|prime)/i,
      /^mgm$/i, /mgm\+/i,
      /sony\s+pictures/i, /columbia\s+pictures/i, /tristar\s+pictures/i,
      /new\s+line\s+cinema/i,
      /^a24$/i, /^neon$/i, /^lionsgate$/i, /^starz$/i,
      /^amc$/i,
      /^bbc\s+(one|two|three|four|studios|america)$/i, /^bbc$/i,
    ],
  },
  {
    tier: 1,
    patterns: [
      /^peacock$/i,
      /^sky\s+(atlantic|studios|one|uk|italia|witness)$/i,
      /^itv/i, /^canal\+$/i, /^studiocanal$/i, /^film4$/i,
      /path[eé]/i, /^mubi$/i, /criterion/i,
      /blumhouse/i, /legendary\s+(pictures|entertainment|television)/i,
      /dreamworks/i, /illumination/i, /toho/i,
      /cj\s+enm/i, /gaumont/i, /participant/i,
      /annapurna/i, /plan\s+b\s+entertainment/i, /bad\s+robot/i,
    ],
  },
];

// ── editorialTier ──────────────────────────────────────────────────────────────
// Retorna 0–4. Lookup por TMDB ID primeiro (preciso), regex como fallback.
// Usado apenas como desempate de ordem dentro da seção — nunca filtra entrada.
function editorialTier(item: EditorialGroup): number {
  type E = { id?: number | null; name?: string | null };
  const entities: E[] = [];

  if (item.movie) {
    const m = item.movie.movie as { networks?: E[] | null; production_companies?: E[] | null };
    for (const n of m.networks ?? []) entities.push(n);
    for (const c of m.production_companies ?? []) entities.push(c);
  } else {
    const tmdb = item.group.tmdb as { networks?: E[] | null; production_companies?: E[] | null } | null | undefined;
    for (const n of tmdb?.networks ?? []) entities.push(n);
    for (const c of tmdb?.production_companies ?? []) entities.push(c);
    if (item.group.streamingProvider?.name) entities.push({ name: item.group.streamingProvider.name });
  }

  if (entities.length === 0) return 0;

  let best = 0;
  for (const { id, name } of entities) {
    if (id != null) {
      const t = TIER_BY_TMDB_ID[id];
      if (t != null && t > best) { best = t; if (best === 4) return 4; }
    }
    if (name && best < 4) {
      for (const { tier, patterns } of EDITORIAL_TIERS) {
        if (tier <= best) continue;
        if (patterns.some((rx) => rx.test(name))) { best = tier; if (best === 4) return 4; break; }
      }
    }
  }
  return best;
}

// ── applyLanguageCap ──────────────────────────────────────────────────────────
// • en, pt → sem limite (idiomas nativos do público)
// • anime (genre_ids ∋ 16) → máx ~20% do total, mínimo 5; excedente → compact
// • outros idiomas → máx 2 por idioma por aba; excedente → compact
function applyLanguageCap(items: EditorialGroup[]): EditorialGroup[] {
  const FREE = new Set(["en", "pt", "pt-BR", ""]);
  const cnt = new Map<string, number>();
  let animeCnt = 0;
  // Escala com o total: ~20% dos itens podem ser anime no grid, mínimo 5
  const ANIME_LIMIT = Math.max(5, Math.ceil(items.length * 0.20));
  // Máx 2 itens por idioma não-livre para diversidade sem exclusão total
  const LANG_LIMIT = 2;

  return items.map((item) => {
    if (item.movie) return item;
    const lang = itemOriginalLanguage(item);
    const isAnime = itemIsAnime(item);

    if (isAnime) {
      animeCnt++;
      return animeCnt > ANIME_LIMIT ? { ...item, visualWeight: "compact" as const } : item;
    }

    if (FREE.has(lang)) return item;

    const n = cnt.get(lang) ?? 0;
    cnt.set(lang, n + 1);
    return n >= LANG_LIMIT ? { ...item, visualWeight: "compact" as const } : item;
  });
}

// ── Cinema badge helpers ───────────────────────────────────────────────────────
// (usados nos cards para distinguir filmes de séries)

// ── buildDayMap ────────────────────────────────────────────────────────────────

function buildDayMap(groups: IcsSeriesGroup[]): Map<string, IcsSeriesGroup[]> {
  const map = new Map<string, IcsSeriesGroup[]>();
  for (const g of groups) {
    for (const ep of g.episodes ?? []) {
      const day = ep.startAt.slice(0, 10);
      const arr = map.get(day) ?? [];
      if (!arr.find((x) => x.key === g.key)) arr.push(g);
      map.set(day, arr);
    }
  }
  return map;
}

// ── RAW merge helpers ─────────────────────────────────────────────────────────
// Teste sem barreiras: cada aba recebe as sections do backend + fallback bruto
// vindo de groups/featuredGroups, filtrado apenas por janela temporal da aba.
// Agrupamento obrigatório: mesmo título/TMDB + mesma data + mesma temporada = 1 card.
// Não filtra por TMDB, imagem, categoria, idioma, score ou origem.

type RadarEpisode = IcsSeriesGroup["episodes"][number];

function episodeDay(ep: RadarEpisode): string {
  return ep.startAt.slice(0, 10);
}

function rawClusterBase(group: IcsSeriesGroup): string {
  const tmdbId = group.tmdb?.tmdb_id ? `tmdb:${group.tmdb.tmdb_id}` : "";
  return tmdbId || groupDisplayName(group).toLowerCase().trim();
}

function rawClusterKey(
  group: IcsSeriesGroup,
  day: string,
  season: number,
): string {
  return `${rawClusterBase(group)}|${day}|s${season}`;
}

function uniqueSortedEpisodes(episodes: RadarEpisode[]): RadarEpisode[] {
  const seen = new Set<string>();
  const out: RadarEpisode[] = [];

  for (const ep of episodes) {
    const key = `${episodeDay(ep)}|s${ep.season ?? 0}|e${ep.episode ?? 0}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...ep });
  }

  return out.sort((a, b) => {
    const dateCompare = String(a.startAt).localeCompare(String(b.startAt));
    if (dateCompare !== 0) return dateCompare;
    if ((a.season ?? 0) !== (b.season ?? 0)) {
      return (a.season ?? 0) - (b.season ?? 0);
    }
    return (a.episode ?? 0) - (b.episode ?? 0);
  });
}

function episodeCode(season: number, episode: number): string {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}`;
}

function buildEpisodeClusterLabel(episodes: RadarEpisode[]): string {
  const eps = uniqueSortedEpisodes(episodes).filter(
    (ep) => (ep.season ?? 0) > 0 && (ep.episode ?? 0) > 0,
  );

  if (eps.length === 0) return "Novo evento";

  const first = eps[0];
  const season = first.season ?? 0;

  if (eps.length === 1) {
    const name = first.episodeName;
    const base = episodeCode(season, first.episode ?? 0);
    return name && name.toLowerCase() !== "tba" ? `${base} · ${name}` : base;
  }

  const sameSeason = eps.every((ep) => ep.season === season);
  const consecutive =
    sameSeason &&
    eps.every((ep, index) =>
      index === 0
        ? true
        : (ep.episode ?? 0) === (eps[index - 1].episode ?? 0) + 1,
    );

  if (sameSeason) {
    const startsAtOne = (first.episode ?? 0) === 1;

    // Quando uma leva grande começa no E01, trata como temporada liberada.
    // Evita prometer "completa" sem saber o total oficial da temporada.
    if (startsAtOne && eps.length >= 6) {
      return `T${season} liberada · ${eps.length} episódios`;
    }

    // Para lotes no mesmo dia, o card já é o evento. Mostrar "X episódios"
    // fica mais limpo do que listar E02, E03, E04...
    if (consecutive || eps.length >= 2) {
      return `S${String(season).padStart(2, "0")} · ${eps.length} episódios`;
    }
  }

  return `${eps.length} episódios novos`;
}

function cloneGroupForEpisodeCluster(
  group: IcsSeriesGroup,
  episodes: RadarEpisode[],
  sourceSuffix: string,
): IcsSeriesGroup {
  const sorted = uniqueSortedEpisodes(episodes);
  const first = sorted[0];
  const last = sorted[sorted.length - 1] ?? first;
  const day = first?.startAt.slice(0, 10) ?? group.sectionMeta?.episodeDate ?? todayStr();
  const season = first?.season ?? group.sectionMeta?.selectedEpisode?.season ?? 0;
  const clusterLabel = buildEpisodeClusterLabel(sorted);

  return {
    ...group,
    key: `${group.key}::${sourceSuffix}::${day}::s${season}`,
    episodes: sorted,
    episodeCount: sorted.length,
    nextAirDate: first?.startAt ?? group.nextAirDate,
    lastAirDate: last?.startAt ?? group.lastAirDate,
    sectionMeta: {
      ...(group.sectionMeta ?? {}),
      episodeDate: day,
      selectedEpisode: {
        season: first?.season ?? 0,
        episode: first?.episode ?? 0,
      },
      episodeCount: sorted.length,
      episodeLabel: clusterLabel,
      clusterLabel,
      firstEpisode: first
        ? { season: first.season, episode: first.episode }
        : undefined,
      lastEpisode: last
        ? { season: last.season, episode: last.episode }
        : undefined,
    } as IcsSeriesGroup["sectionMeta"],
  };
}

function expandGroupsByEpisodeWindow(
  groups: IcsSeriesGroup[],
  startDay: string,
  endDay: string,
  sourceSuffix: string,
): IcsSeriesGroup[] {
  const expanded: IcsSeriesGroup[] = [];

  for (const group of groups) {
    if (!Array.isArray(group.episodes) || group.episodes.length === 0) continue;

    const buckets = new Map<string, RadarEpisode[]>();

    for (const ep of group.episodes) {
      const day = episodeDay(ep);
      if (day < startDay || day > endDay) continue;

      const season = ep.season ?? 0;
      const key = rawClusterKey(group, day, season);
      const arr = buckets.get(key) ?? [];
      arr.push(ep);
      buckets.set(key, arr);
    }

    for (const [key, episodes] of buckets) {
      expanded.push(cloneGroupForEpisodeCluster(group, episodes, `${sourceSuffix}-${key}`));
    }
  }

  return expanded;
}

function mergeExpandedClusters(groups: IcsSeriesGroup[]): IcsSeriesGroup[] {
  const byCluster = new Map<string, IcsSeriesGroup>();

  for (const group of groups) {
    const first = group.episodes?.[0];
    if (!first) continue;

    const day = episodeDay(first);
    const season = first.season ?? 0;
    const key = rawClusterKey(group, day, season);
    const existing = byCluster.get(key);

    if (!existing) {
      byCluster.set(key, group);
      continue;
    }

    const mergedEpisodes = uniqueSortedEpisodes([
      ...(existing.episodes ?? []),
      ...(group.episodes ?? []),
    ]);

    byCluster.set(key, {
      ...existing,
      episodes: mergedEpisodes,
      episodeCount: mergedEpisodes.length,
      sectionMeta: {
        ...(existing.sectionMeta ?? group.sectionMeta ?? {}),
        episodeDate: day,
        selectedEpisode: {
          season: mergedEpisodes[0]?.season ?? 0,
          episode: mergedEpisodes[0]?.episode ?? 0,
        },
        episodeCount: mergedEpisodes.length,
        episodeLabel: buildEpisodeClusterLabel(mergedEpisodes),
        clusterLabel: buildEpisodeClusterLabel(mergedEpisodes),
        firstEpisode: mergedEpisodes[0]
          ? { season: mergedEpisodes[0].season, episode: mergedEpisodes[0].episode }
          : undefined,
        lastEpisode: mergedEpisodes[mergedEpisodes.length - 1]
          ? {
              season: mergedEpisodes[mergedEpisodes.length - 1].season,
              episode: mergedEpisodes[mergedEpisodes.length - 1].episode,
            }
          : undefined,
      } as IcsSeriesGroup["sectionMeta"],
    });
  }

  return Array.from(byCluster.values()).sort((a, b) => {
    const aDate = a.sectionMeta?.episodeDate ?? a.episodes?.[0]?.startAt?.slice(0, 10) ?? "9999";
    const bDate = b.sectionMeta?.episodeDate ?? b.episodes?.[0]?.startAt?.slice(0, 10) ?? "9999";
    if (aDate !== bDate) return aDate.localeCompare(bDate);
    return groupDisplayName(a).localeCompare(groupDisplayName(b));
  });
}

function buildRawGroupsForViewMode(
  viewMode: ViewMode,
  sections: RadarSections | null,
  groups: IcsSeriesGroup[],
  featuredGroups: IcsSeriesGroup[],
): IcsSeriesGroup[] | undefined {
  if (!sections && groups.length === 0 && featuredGroups.length === 0)
    return undefined;

  // Quando o backend já particionou os dados por aba (sections disponível),
  // retorna diretamente a fatia correta — sem misturar rawPool, que contém
  // todos os episódios e reintroduziria duplicatas entre abas.
  if (sections) {
    if (viewMode === "all") {
      // Merge todas as janelas, deduplicando por tmdb_id
      const seen = new Set<number>();
      const merged: IcsSeriesGroup[] = [];
      for (const g of [...sections.today, ...sections.thisWeek, ...sections.next30Days]) {
        const id = g.tmdb?.tmdb_id;
        if (id != null) {
          if (seen.has(id)) continue;
          seen.add(id);
        }
        merged.push(g);
      }
      return merged;
    }
    if (viewMode === "day")   return sections.today;
    if (viewMode === "week")  return sections.thisWeek;
    return sections.next30Days;
  }

  // Fallback: sem sections, usa o pool bruto filtrado por janela de datas.
  const today = todayStr();
  const recentStart = addDaysStr(-3);
  const tomorrow = addDaysStr(1);
  const next7 = addDaysStr(7);
  const next8 = addDaysStr(8);
  const next30 = addDaysStr(30);

  const rawPool = [...groups, ...featuredGroups];

  const [startDay, endDay, suffix] =
    viewMode === "day"
      ? [recentStart, today, "raw-day"]
      : viewMode === "week"
        ? [tomorrow, next7, "raw-week"]
        : [next8, next30, "raw-month"];

  return mergeExpandedClusters([
    ...expandGroupsByEpisodeWindow(rawPool, startDay, endDay, suffix),
  ]);
}

// ── buildSpotlightItems ───────────────────────────────────────────────────────

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
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = toLocalDateStr(nextWeek);

  const items: SpotlightItem[] = [];
  const seen = new Set<string>();

  for (const g of featuredGroups) {
    const groupKey = g.key ?? g.rawTitle ?? groupDisplayName(g);
    if (seen.has(groupKey)) continue;
    const upcomingEp = (g.episodes ?? []).find(
      (ep) =>
        ep.startAt.slice(0, 10) >= today &&
        ep.startAt.slice(0, 10) <= nextWeekStr,
    );
    if (!upcomingEp) continue;
    if (!bestHorizontalImg(g.tmdb ?? { backdrop_path: null, poster_path: null }, "w1280")) continue;
    const dateStr = upcomingEp.startAt.slice(0, 10);
    const daysUntil = Math.ceil(
      (new Date(dateStr + "T12:00:00").getTime() - Date.now()) / 86_400_000,
    );
    const label =
      daysUntil <= 0
        ? "Hoje"
        : daysUntil === 1
          ? "Amanhã"
          : new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", {
              day: "numeric",
              month: "short",
            });
    const tmdbId = g.tmdb?.tmdb_id;
    const isTrendingDay = tmdbId != null ? trendingDay.has(tmdbId) : false;
    const isTrendingWeek = tmdbId != null ? trendingWeek.has(tmdbId) : false;
    const seasonEps = g.episodes.filter(
      (ep) => ep.season === upcomingEp.season,
    );
    const isPremiere = upcomingEp.season > 0 && upcomingEp.episode === 1;
    const maxEp = Math.max(...seasonEps.map((e) => e.episode));
    const isFinale =
      upcomingEp.episode === maxEp && maxEp > 1 && upcomingEp.season > 0;
    const eventLabel = String(g.sectionMeta?.reason ?? g.sectionMeta?.episodeLabel ?? "").toLowerCase();
    const hasStrongLabel =
      isPremiere ||
      isFinale ||
      eventLabel.includes("estreia") ||
      eventLabel.includes("final") ||
      eventLabel.includes("temporada completa") ||
      eventLabel.includes("streaming") ||
      eventLabel.includes("cinema");
    const recurringCommon =
      g.category === "NEWS" ||
      g.category === "SPORTS" ||
      g.category === "DAILY_SOAP" ||
      g.category === "VARIETY";
    if (!hasStrongLabel && (g.relevanceScore ?? 0) < 62) continue;
    if (recurringCommon && !isTrendingDay && (g.relevanceScore ?? 0) < 72) continue;
    items.push({
      group: g,
      dateStr,
      isPremiere,
      isFinale,
      isTrendingDay,
      isTrendingWeek,
      label,
    });
    seen.add(groupKey);
  }

  items.sort((a, b) => {
    const sA =
      (a.isTrendingDay ? 100 : 0) +
      (a.isPremiere ? 50 : 0) +
      (a.isFinale ? 40 : 0) +
      (a.isTrendingWeek ? 30 : 0) +
      (a.group.relevanceScore ?? 0);
    const sB =
      (b.isTrendingDay ? 100 : 0) +
      (b.isPremiere ? 50 : 0) +
      (b.isFinale ? 40 : 0) +
      (b.isTrendingWeek ? 30 : 0) +
      (b.group.relevanceScore ?? 0);
    if (sB !== sA) return sB - sA;
    return (b.group.tmdb?.popularity ?? 0) - (a.group.tmdb?.popularity ?? 0);
  });

  return items;
}

// ── Componentes de UI ──────────────────────────────────────────────────────────

function SectionEyebrow({
  children,
  color = "sky",
}: {
  children: React.ReactNode;
  color?: "sky" | "rose" | "cyan" | "violet" | "teal" | "amber";
}) {
  const colors = {
    sky: "bg-sky-400/60 text-sky-400/80",
    rose: "bg-rose-400/60 text-rose-400/80",
    cyan: "bg-cyan-400/60 text-cyan-400/80",
    violet: "bg-violet-400/60 text-violet-400/80",
    teal: "bg-teal-400/60 text-teal-400/80",
    amber: "bg-amber-400/60 text-amber-400/80",
  };
  const [bg, text] = colors[color].split(" ");
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${bg}`} />
      <p
        className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${text}`}
      >
        {children}
      </p>
    </div>
  );
}

function SectionDivider() {
  return (
    <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent my-10" />
  );
}

const SIGNAL_STYLES = {
  rose: "border-rose-400/25 bg-rose-500/15 text-rose-200",
  violet: "border-violet-400/25 bg-violet-500/15 text-violet-200",
  emerald: "border-emerald-400/25 bg-emerald-500/15 text-emerald-200",
  cyan: "border-cyan-400/25 bg-cyan-500/15 text-cyan-200",
  amber: "border-amber-400/25 bg-amber-500/15 text-amber-200",
  sky: "border-sky-400/25 bg-sky-500/15 text-sky-200",
  slate: "border-white/[0.08] bg-white/[0.05] text-white/50",
};

function SignalBadge({
  label,
  color,
}: {
  label: string;
  color: keyof typeof SIGNAL_STYLES;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${SIGNAL_STYLES[color]}`}
    >
      {label}
    </span>
  );
}

// ── NormalizedItem ─────────────────────────────────────────────────────────────

interface NormalizedItem {
  tmdbId: number;
  name: string;
  originalName: string | null;
  overview: string | null;
  backdrop: string | null;
  poster: string | null;
  voteAvg: number;
  category: ContentCategory;
  href: string;
  subLabel: string;
  dateLabel: string;
  days: number;
  isMovie: boolean;
}

function resolveItemData(item: EditorialGroup): NormalizedItem {
  const { movie, group, dateStr } = item;
  if (movie) {
    const m = movie.movie;
    const days = daysUntilDate(m.release_date ?? dateStr);
    const dateLabel =
      days < -7
        ? "Nos cinemas"
        : days < 0
          ? `Estreou há ${Math.abs(days)} dias`
          : days === 0
            ? "Estreia hoje"
            : days === 1
              ? "Amanhã"
              : `Em ${days} dias`;
    const backdrop =
      m.clean_backdrop_path != null
        ? TMDB_IMG(m.clean_backdrop_path, "w1280")
        : TMDB_IMG(m.backdrop_path ?? null, "w1280");
    return {
      tmdbId: m.tmdb_id,
      name: m.name ?? "",
      originalName: m.original_name ?? null,
      overview: m.overview ?? null,
      backdrop,
      poster: TMDB_IMG(m.poster_path ?? null, "w342"),
      voteAvg: m.vote_average ?? 0,
      category: "MOVIE",
      href: `/title/movie/${m.tmdb_id}`,
      subLabel: (m.genres ?? []).slice(0, 2).join(" · ") || "Cinema",
      dateLabel,
      days,
      isMovie: true,
    };
  }
  const tmdb = group.tmdb;
  const days = daysUntilDate(dateStr);

  // Se o backend forneceu sectionMeta, usa o badge já computado para essa seção.
  // Isso garante que "Ontem", "Nova temporada", "Em 2 dias" etc. sejam precisos
  // independente de como o frontend calcularia days a partir de dateStr.
  const dateLabel =
    group.sectionMeta?.badge ??
    (days <= 0 ? "Hoje" : days === 1 ? "Amanhã" : `Em ${days} dias`);

  // Episódio/cluster a exibir: no RAW, o card representa um evento por data.
  // Se houver vários episódios do mesmo título+temporada+data, mostra label agrupada.
  const meta = group.sectionMeta as
    | {
        clusterLabel?: string;
        episodeLabel?: string;
        selectedEpisode?: { season: number; episode: number };
        section?: string;
        badge?: string;
      }
    | undefined;
  const eps = episodesOnDay(group, dateStr);
  const clusterLabel = meta?.clusterLabel ?? meta?.episodeLabel;
  const firstEp = eps[0];
  const hasEpisodeNumber =
    !!firstEp && firstEp.season > 0 && firstEp.episode > 0;

  const fallbackLabel: string =
    meta?.section === "vemAi"
      ? (meta.badge ?? "Novo episódio")
      : group.sourceTag?.includes("tracked_upcoming")
        ? "Retorno da temporada"
        : group.sourceTag?.includes("tracked_recent")
          ? "Episódio recente"
          : group.sourceTag?.includes("airing_today")
            ? "Exibição hoje"
            : group.sourceTag?.includes("discover_upcoming")
              ? days <= 1
                ? "Estreia em breve"
                : "Nova série"
              : group.sourceTag?.includes("discover_new")
                ? "Estreia recente"
                : "";

  const subLabel: string =
    clusterLabel ??
    (eps.length > 1
      ? buildEpisodeClusterLabel(eps)
      : hasEpisodeNumber
        ? `S${String(firstEp.season).padStart(2, "0")}E${String(firstEp.episode).padStart(2, "0")}${firstEp.episodeName && firstEp.episodeName.toLowerCase() !== "tba" ? ` · ${firstEp.episodeName}` : ""}`
        : fallbackLabel);
  const tmdbId = tmdb?.tmdb_id ?? 0;
  const fallbackName = groupDisplayName(group);
  return {
    tmdbId,
    name: tmdb?.name ?? fallbackName,
    originalName: tmdb?.original_name ?? null,
    overview: tmdb?.overview ?? null,
    backdrop: tmdb ? bestHorizontalImg(tmdb, "w1280") : null,
    poster: tmdb ? bestVerticalImg(tmdb) : null,
    voteAvg: tmdb?.vote_average ?? 0,
    category: group.category,
    href: tmdbId ? `/title/tv/${tmdbId}` : "#",
    subLabel,
    dateLabel,
    days,
    isMovie: false,
  };
}

// ── Cards ──────────────────────────────────────────────────────────────────────

function AgendaEditorialHeroCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  const signal = editorialSignal(
    item.group,
    item.dateStr,
    trendingDay,
    trendingWeek,
    item.movie,
  );
  const { label: catLabel, color: catColor } = d.isMovie
    ? { label: "Cinema", color: "bg-amber-500/20 text-amber-300/90 border-amber-500/25" }
    : resolveCatLabel(item.group);
  const titleDisplay = useRandomizedTitleDisplay(d.name, d.originalName);
  const firstEp = !item.movie
    ? (episodesOnDay(item.group, item.dateStr)[0] ?? null)
    : null;
  const showTime = firstEp && !firstEp.startAt.endsWith("T00:00:00.000Z");
  const heroMediaType = item.movie ? "movie" : "tv";
  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[26px] border border-white/[0.08] bg-zinc-950/80 text-left shadow-[0_18px_44px_rgba(0,0,0,0.34)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.16] block"
    >
      <RadarLibraryBadge tmdbId={d.tmdbId} mediaType={heroMediaType} />
      {d.backdrop && (
        <img
          src={d.backdrop}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-[0.72] transition-transform duration-700 group-hover:scale-[1.03]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-zinc-950/38 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SignalBadge label={signal.label} color={signal.color} />
            <span
              className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${catColor}`}
            >
              {catLabel}
            </span>
            {!item.movie && item.group.streamingProvider && (
              <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/15 px-2 py-1 text-[9px] font-black uppercase text-emerald-300/80">
                {item.group.streamingProvider.name}
              </span>
            )}
            <span className="rounded-lg border border-white/[0.08] bg-black/20 px-2 py-1 text-[9px] font-black uppercase text-white/45">
              {d.dateLabel}
            </span>
          </div>
          {d.voteAvg > 0 && (
            <span className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] font-black text-amber-200">
              ★ {d.voteAvg.toFixed(1)}
            </span>
          )}
        </div>
        <div className="flex items-end gap-5">
          {d.poster && (
            <div className="hidden w-[104px] overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.04] shadow-[0_14px_32px_rgba(0,0,0,0.30)] sm:block">
              <img
                src={d.poster}
                alt={d.name}
                className="aspect-[2/3] w-full object-cover"
              />
            </div>
          )}
          <div className="min-w-0 max-w-[650px]">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.08em] text-emerald-300/90">
              {d.subLabel}
              {showTime && firstEp ? ` · ${formatTime(firstEp.startAt)}` : ""}
            </p>
            <h2 className="mb-3 text-3xl font-black leading-none tracking-[-0.04em] text-white sm:text-5xl">
              {titleDisplay.mainTitle}
            </h2>
            {titleDisplay.subTitle && (
              <p className="mb-2 line-clamp-1 text-[12px] font-medium text-white/45">
                {titleDisplay.subTitle}
              </p>
            )}
            {d.overview && (
              <p className="line-clamp-3 max-w-2xl text-[13px] leading-relaxed text-white/62">
                {d.overview}
              </p>
            )}
          </div>
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialWideCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  const titleDisplay = useRandomizedTitleDisplay(d.name, d.originalName);
  const signal = editorialSignal(
    item.group,
    item.dateStr,
    trendingDay,
    trendingWeek,
    item.movie,
  );
  const wideMediaType = item.movie ? "movie" : "tv";
  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.30)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block"
    >
      <RadarLibraryBadge tmdbId={d.tmdbId} mediaType={wideMediaType} />
      {d.backdrop && (
        <img
          src={d.backdrop}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-[0.65] transition-transform duration-700 group-hover:scale-[1.04]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/72 via-zinc-950/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/60 via-transparent to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SignalBadge label={signal.label} color={signal.color} />
            {d.isMovie && (
              <span className="rounded-lg border border-amber-500/25 bg-amber-500/20 px-2 py-1 text-[9px] font-black uppercase text-amber-300/90">Cinema</span>
            )}
          </div>
          <span className="text-[10px] font-bold uppercase text-white/38">{d.dateLabel}</span>
        </div>
        <div className="max-w-[560px]">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-300/80">
            {d.subLabel || ""}
          </p>
          <h3 className="line-clamp-2 text-2xl font-black leading-tight tracking-[-0.035em] text-white">
            {titleDisplay.mainTitle}
          </h3>
          {titleDisplay.subTitle && (
            <p className="mt-1 line-clamp-1 text-[11px] font-medium text-white/40">
              {titleDisplay.subTitle}
            </p>
          )}
          {d.overview && (
            <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-white/52">
              {d.overview}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialPosterCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  const titleDisplay = useRandomizedTitleDisplay(d.name, d.originalName);
  const bgImg = d.poster ?? d.backdrop;
  const signal = editorialSignal(
    item.group,
    item.dateStr,
    trendingDay,
    trendingWeek,
    item.movie,
  );
  const posterMediaType = item.movie ? "movie" : "tv";
  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.30)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block"
    >
      <RadarLibraryBadge tmdbId={d.tmdbId} mediaType={posterMediaType} />
      {bgImg && (
        <img
          src={bgImg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover object-top opacity-[0.75] transition-transform duration-700 group-hover:scale-[1.04]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/72 via-zinc-950/20 to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <SignalBadge label={signal.label} color={signal.color} />
            {d.isMovie && (
              <span className="rounded-lg border border-amber-500/25 bg-amber-500/20 px-2 py-1 text-[9px] font-black uppercase text-amber-300/90">Cinema</span>
            )}
          </div>
          {d.voteAvg > 0 && (
            <span className="rounded-lg border border-amber-400/15 bg-black/20 px-1.5 py-1 text-[10px] font-black text-amber-200/90">
              ★ {d.voteAvg.toFixed(1)}
            </span>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-300/80">
            {d.dateLabel}
            {d.subLabel ? ` · ${d.subLabel}` : ""}
          </p>
          <h3 className="line-clamp-2 text-[19px] font-black leading-tight tracking-[-0.035em] text-white">
            {titleDisplay.mainTitle}
          </h3>
          {d.overview && (
            <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-white/50">
              {d.overview}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialSquareCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  const titleDisplay = useRandomizedTitleDisplay(d.name, d.originalName);
  const bgImg = d.backdrop ?? d.poster;
  const signal = editorialSignal(
    item.group,
    item.dateStr,
    trendingDay,
    trendingWeek,
    item.movie,
  );
  const squareMediaType = item.movie ? "movie" : "tv";
  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block"
    >
      <RadarLibraryBadge tmdbId={d.tmdbId} mediaType={squareMediaType} />
      {bgImg && (
        <img
          src={bgImg}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-[0.60] transition-transform duration-700 group-hover:scale-[1.05]"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/50 via-transparent to-zinc-950/80" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/65 via-transparent to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-center justify-between gap-2">
          <SignalBadge label={signal.label} color={signal.color} />
          {d.voteAvg > 0 && (
            <span className="rounded-lg border border-amber-400/15 bg-black/25 px-1.5 py-1 text-[10px] font-black text-amber-200/90">
              ★ {d.voteAvg.toFixed(1)}
            </span>
          )}
        </div>
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-[0.09em] text-emerald-300/80">
            {d.dateLabel}
            {d.subLabel ? ` · ${d.subLabel}` : ""}
          </p>
          <h3 className="line-clamp-2 text-[16px] font-black leading-tight tracking-[-0.03em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
            {titleDisplay.mainTitle}
          </h3>
        </div>
      </div>
    </a>
  );
}

const MOBILE_COMPACT_PAGE_SIZE = 8;

function AgendaCompactCluster({ items }: { items: EditorialGroup[] }) {
  const [mobilePage, setMobilePage] = useState(0);
  const mobilePageCount = Math.max(
    1,
    Math.ceil(items.length / MOBILE_COMPACT_PAGE_SIZE),
  );
  const clampedMobilePage = Math.min(mobilePage, mobilePageCount - 1);
  const mobileItems = items.slice(
    clampedMobilePage * MOBILE_COMPACT_PAGE_SIZE,
    clampedMobilePage * MOBILE_COMPACT_PAGE_SIZE + MOBILE_COMPACT_PAGE_SIZE,
  );

  useEffect(() => {
    setMobilePage(0);
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="col-span-1 rounded-[24px] border border-white/[0.08] bg-zinc-900/80 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.40)] backdrop-blur-xl sm:col-span-2 sm:p-4 lg:col-span-4">
      <div className="sm:hidden">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.16em] text-white/30">
              Lista compacta
            </p>
            <p className="mt-0.5 text-[11px] font-bold text-white/45">
              {clampedMobilePage + 1} de {mobilePageCount}
            </p>
          </div>
          {mobilePageCount > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                data-testid="radar-compact-prev-mobile"
                onClick={() => setMobilePage((page) => Math.max(0, page - 1))}
                disabled={clampedMobilePage === 0}
                className="rounded-xl border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-[10px] font-black uppercase text-white/55 transition-colors disabled:opacity-35"
              >
                Anterior
              </button>
              <button
                type="button"
                data-testid="radar-compact-next-mobile"
                onClick={() =>
                  setMobilePage((page) => Math.min(mobilePageCount - 1, page + 1))
                }
                disabled={clampedMobilePage >= mobilePageCount - 1}
                className="rounded-xl border border-sky-300/20 bg-sky-400/[0.12] px-3 py-2 text-[10px] font-black uppercase text-sky-100 transition-colors disabled:opacity-35"
              >
                Próximo
              </button>
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-2">
          {mobileItems.map((editorialItem) => {
            const d = resolveItemData(editorialItem);
            const image = d.poster ?? d.backdrop;
            return (
              <a
                key={`${editorialItem.movie ? `movie-${d.tmdbId}` : editorialItem.group.key}-${editorialItem.dateStr}-mobile`}
                href={d.href}
                className="flex min-h-[82px] min-w-0 gap-2 overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.035] p-2 text-left"
              >
                <div className="h-[68px] w-[45px] shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                  {image && (
                    <img
                      src={image}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                  <p className="w-fit max-w-full rounded-md border border-sky-300/20 bg-sky-400/[0.12] px-1.5 py-0.5 text-[7px] font-black uppercase leading-none text-sky-100/75">
                    {d.dateLabel}
                  </p>
                  <div className="min-w-0">
                    <p className="line-clamp-2 text-[11px] font-black leading-tight text-white/85">
                      {d.name}
                    </p>
                    {d.subLabel && (
                      <p className="mt-1 line-clamp-1 text-[7.5px] font-bold uppercase leading-snug text-emerald-300/65">
                        {d.subLabel}
                      </p>
                    )}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>

      <div className="hidden grid-cols-1 gap-2 sm:grid sm:grid-cols-2 lg:grid-cols-3">
        {items.map((editorialItem) => {
          const d = resolveItemData(editorialItem);
          return (
            <a
              key={`${editorialItem.movie ? `movie-${d.tmdbId}` : editorialItem.group.key}-${editorialItem.dateStr}`}
              href={d.href}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-2.5 text-left transition-colors hover:border-white/[0.10] hover:bg-white/[0.05]"
            >
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                {(d.backdrop ?? d.poster) && (
                  <img
                    src={(d.backdrop ?? d.poster)!}
                    alt=""
                    className="h-full w-full object-cover object-center"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-black text-white/85">
                  {d.name}
                </p>
                <p className="mt-1 text-[10px] font-bold text-white/35">
                  {d.dateLabel}
                  {d.subLabel ? ` · ${d.subLabel}` : ""}
                  {!editorialItem.movie &&
                    editorialItem.group.streamingProvider && (
                      <span className="ml-1.5 text-emerald-400/70">
                        · {editorialItem.group.streamingProvider.name}
                      </span>
                    )}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── Feed editorial ─────────────────────────────────────────────────────────────

function AgendaEditorialFeed({
  items,
  mode,
  isLoading,
  trendingDay,
  trendingWeek,
  radarMode: feedRadarMode,
  contentFilter,
}: {
  items: EditorialGroup[];
  mode: ViewMode;
  isLoading: boolean;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
  radarMode?: RadarMode;
  contentFilter: ContentFilterKey;
}) {
  const rows = getRows(mode);
  const isPersonal = feedRadarMode === "personal";

  // Modo personal: tudo no grid, sem split e sem bloco compacto.
  // Modo geral: split 50/50 por score (comportamento original).
  const allCompact = isPersonal
    ? []  // no personal, não há compacts — tudo vai pro grid
    : items.filter((i) => i.visualWeight === "compact").sort((a, b) => b.score - a.score);
  const allNonCmp = isPersonal
    ? items.map(i => ({ ...i, visualWeight: "poster" as const }))  // promove todos a poster
    : items.filter((i) => i.visualWeight !== "compact").sort((a, b) => b.score - a.score);

  // Personal: splitAt = total (tudo no grid). Geral: top 50%.
  const initialShowcaseLimit = !isPersonal && mode === "all" && contentFilter === "all" ? 18 : Number.POSITIVE_INFINITY;
  const splitAt    = isPersonal ? allNonCmp.length : Math.min(Math.ceil(allNonCmp.length / 2), initialShowcaseLimit);
  const nonCmp     = allNonCmp.slice(0, splitAt);
  const bottomHalf = isPersonal ? [] : allNonCmp.slice(splitAt);
  const capSpill: EditorialGroup[] = [];



  if (isLoading && items.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {rows.slice(0, 2).map((row, rIdx) => (
          <div
            key={rIdx}
            className={`grid gap-3 ${ROW_H_SM[row[0].cardType]}`}
            style={{ gridTemplateColumns: "repeat(12, 1fr)" }}
          >
            {row.map((slot, sIdx) => (
              <div
                key={sIdx}
                className={`${MOBILE_CARD_H[slot.cardType]} rounded-2xl bg-white/[0.035] animate-pulse [grid-column:span_var(--radar-col-xs)_/_span_var(--radar-col-xs)] sm:h-full sm:[grid-column:span_var(--radar-col-sm)_/_span_var(--radar-col-sm)]`}
                style={slotGridStyle(slot, row, sIdx)}
              />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-[24px] border border-white/[0.08] bg-zinc-900/80 px-6 py-14 text-center">
        <p className="text-[14px] font-black text-white/35">
          Nenhum conteúdo neste período.
        </p>
        <p className="mt-1 text-[11px] text-white/20">
          Aguardando novos eventos no feed.
        </p>
      </div>
    );
  }

  // ── Helper: monta renderedRows + spillover para um conjunto de itens ──────
  function buildRows(pool: EditorialGroup[]) {
    const rendered: Array<{ rowDef: RowDef; items: EditorialGroup[] }> = [];
    const spill: EditorialGroup[] = [];
    let cursor = 0;
    let ri = 0;
    while (cursor < pool.length) {
      const rowDef = rows[ri % rows.length];
      const remaining = pool.length - cursor;
      if (remaining === 0) break;
      if (remaining >= rowDef.length) {
        rendered.push({ rowDef, items: pool.slice(cursor, cursor + rowDef.length) });
        cursor += rowDef.length;
      } else {
        const smaller = rows.find((r) => r.length === remaining);
        if (smaller) rendered.push({ rowDef: smaller, items: pool.slice(cursor, cursor + remaining) });
        else spill.push(...pool.slice(cursor, cursor + remaining));
        cursor += remaining;
      }
      ri++;
    }
    return { rendered, spill };
  }

  // ── Helper: renderiza uma lista de rows como grid ──────────────────────────
  function renderRows(
    rendered: Array<{ rowDef: RowDef; items: EditorialGroup[] }>,
    keyPrefix: string,
  ) {
    return rendered.map((row, rIdx) => {
      const dominantType = row.rowDef.reduce<CardType>((best, slot) => {
        const order: CardType[] = ["hero", "wide", "poster", "square", "tall"];
        return order.indexOf(slot.cardType) < order.indexOf(best) ? slot.cardType : best;
      }, "square");
      return (
        <div
          key={`${keyPrefix}-${rIdx}`}
          className={`grid gap-3 ${ROW_H_SM[dominantType]}`}
          style={{ gridTemplateColumns: "repeat(12, 1fr)" }}
        >
          {row.items.map((item, cIdx) => {
            const slot = row.rowDef[cIdx];
            const key = `${item.movie ? item.movie.key : item.group.key}-${item.dateStr}-${keyPrefix}-${rIdx}-${cIdx}`;
            return (
              <div
                key={key}
                className={`${MOBILE_CARD_H[slot.cardType]} min-w-0 [grid-column:span_var(--radar-col-xs)_/_span_var(--radar-col-xs)] sm:h-full sm:[grid-column:span_var(--radar-col-sm)_/_span_var(--radar-col-sm)]`}
                style={slotGridStyle(slot, row.rowDef, cIdx)}
              >
                {slot.cardType === "hero" && (
                  <AgendaEditorialHeroCard item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />
                )}
                {slot.cardType === "wide" && (
                  <AgendaEditorialWideCard item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />
                )}
                {slot.cardType === "square" && (
                  <AgendaEditorialSquareCard item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />
                )}
                {slot.cardType === "poster" && (
                  <AgendaEditorialPosterCard item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />
                )}
              </div>
            );
          })}
        </div>
      );
    });
  }

  // Seção principal: top 50% non-compact no grid
  const { rendered: topRows, spill: topSpill } = buildRows(nonCmp);

  // Seção "Também relevantes": bottom 50% não-compact + todos os compacts + spillover do grid.
  // Tudo reordenado por score desc — direto para AgendaCompactCluster (sem grid intermediário).
  const rawCompactPool = [...bottomHalf, ...capSpill, ...allCompact, ...topSpill]
    .sort((a, b) => b.score - a.score);
  const compactLimit = !isPersonal && contentFilter === "all" ? 18 : rawCompactPool.length;
  const compactPool = rawCompactPool.slice(0, compactLimit);
  const hiddenCompactCount = rawCompactPool.length - compactPool.length;

  const hasSecondSection = compactPool.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {/* Bloco 1: Destaques — top 50% por score */}
      {renderRows(topRows, "top")}

      {/* Bloco 2: Também relevantes — bottom 50% completo em lista compacta */}
      {hasSecondSection && (
        <>
          <div className="flex items-center gap-3 my-2">
            <div className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/25">
              Também relevantes
            </span>
            <div className="h-px flex-1 bg-white/[0.06]" />
          </div>
          <AgendaCompactCluster items={compactPool} />
          {hiddenCompactCount > 0 && (
            <div className="-mt-1 rounded-2xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 text-center text-[11px] font-semibold text-white/30">
              Mais {hiddenCompactCount} eventos disponíveis nos filtros.
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Estado de carregamento com barra de progresso ─────────────────────────────

function RadarLoadingState({
  phase,
  enrichProgress,
}: {
  phase: Phase;
  enrichProgress: number;
}) {
  // Calcula progresso total (0-100):
  // Fases até "enriching" têm progresso fixo; durante o enrich interpola 65→95.
  const baseProgress = PHASE_PROGRESS[phase] ?? 0;
  const totalProgress =
    phase === "enriching"
      ? 65 + (enrichProgress / 100) * 30
      : baseProgress;

  const steps: { key: Phase; label: string }[] = [
    { key: "fetching_ics", label: "Sinais" },
    { key: "grouping",     label: "Séries" },
    { key: "cache_check",  label: "Cache" },
    { key: "enriching",    label: "Dados" },
  ];

  const phaseOrder: Phase[] = ["idle", "fetching_ics", "grouping", "cache_check", "enriching", "done"];
  const currentIdx = phaseOrder.indexOf(phase);

  return (
    <div className="min-h-[220px] flex flex-col justify-center px-6 sm:px-9 py-8 gap-6">
      {/* Skeletons do hero */}
      <div className="flex items-end gap-5">
        <div className="hidden sm:block w-[80px] h-[120px] rounded-xl bg-white/[0.04] animate-pulse shrink-0" />
        <div className="flex-1 min-w-0 flex flex-col gap-3">
          <div className="flex gap-2">
            <div className="h-4 w-16 rounded-lg bg-white/[0.06] animate-pulse" />
            <div className="h-4 w-20 rounded-lg bg-white/[0.04] animate-pulse" />
          </div>
          <div className="h-7 w-2/3 rounded-lg bg-white/[0.06] animate-pulse" />
          <div className="h-3.5 w-full rounded-lg bg-white/[0.03] animate-pulse" />
          <div className="h-3.5 w-4/5 rounded-lg bg-white/[0.03] animate-pulse" />
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="flex flex-col gap-2.5">
        {/* Trilha de fases */}
        <div className="flex items-center gap-1.5">
          {steps.map(({ key, label }, i) => {
            const stepIdx = phaseOrder.indexOf(key);
            const isDone = currentIdx > stepIdx;
            const isActive = currentIdx === stepIdx;
            return (
              <div key={key} className="flex items-center gap-1.5 flex-1">
                <div className="flex flex-col items-center gap-1 flex-1">
                  <div
                    className={`h-0.5 w-full rounded-full transition-all duration-500 ${
                      isDone
                        ? "bg-sky-400/70"
                        : isActive
                          ? "bg-sky-400/40"
                          : "bg-white/[0.06]"
                    }`}
                  />
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wide transition-colors duration-300 ${
                      isDone
                        ? "text-sky-400/60"
                        : isActive
                          ? "text-sky-300/80"
                          : "text-white/15"
                    }`}
                  >
                    {label}
                  </span>
                </div>
                {i < steps.length - 1 && (
                  <div
                    className={`w-1 h-1 rounded-full shrink-0 mb-3 transition-colors duration-300 ${
                      isDone ? "bg-sky-400/50" : "bg-white/[0.08]"
                    }`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Barra contínua de progresso */}
        <div className="h-[3px] w-full rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-sky-500 to-sky-300 transition-all duration-700 ease-out"
            style={{ width: `${Math.max(4, totalProgress)}%` }}
          />
        </div>

        {/* Label da fase atual */}
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-sky-400/70 font-medium">
            {PHASE_LABELS[phase]}
          </span>
          <span className="text-[10px] text-white/25 tabular-nums">
            {Math.round(totalProgress)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ── RadarHero com seletor de modo ──────────────────────────────────────────────

function RadarHero({
  phase,
  viewMode,
  onChangeViewMode,
  filteredCount,
  filteredEps,
  enrichProgress,
  spotlightItems,
  radarMode,
  onChangeRadarMode,
  isLoadingMode,
}: {
  phase: Phase;
  viewMode: ViewMode;
  onChangeViewMode: (m: ViewMode) => void;
  filteredCount: number;
  filteredEps: number;
  enrichProgress: number;
  spotlightItems: SpotlightItem[];
  radarMode: RadarMode;
  onChangeRadarMode: (m: RadarMode) => void;
  isLoadingMode: boolean;
  personalLibrarySize?: number | null;
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });

  const [idx, setIdx] = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((nextIdx: number) => {
    setVisible(false);
    setTimeout(() => {
      setIdx(nextIdx);
      setVisible(true);
    }, 280);
  }, []);

  useEffect(() => {
    if (spotlightItems.length === 0) return;
    timerRef.current = setTimeout(
      () => goTo((idx + 1) % spotlightItems.length),
      SPOTLIGHT_MS,
    );
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [idx, spotlightItems.length, goTo]);

  // Reseta idx quando itens mudam (troca de modo)
  useEffect(() => {
    setIdx(0);
    setVisible(true);
  }, [spotlightItems]);

  const item = spotlightItems[idx] ?? null;
  const tmdb = item?.group.tmdb ?? null;
  const backdrop = tmdb ? bestHorizontalImg(tmdb, "w1280") : null;
  const poster = tmdb ? bestVerticalImg(tmdb) : null;
  const itemName = tmdb?.name ?? null;
  const itemTitleDisplay = useRandomizedTitleDisplay(
    itemName ?? "",
    tmdb?.original_name ?? null,
  );
  const { label: catLabel, color: catColor } = item
    ? resolveCatLabel(item.group)
    : { label: "", color: "" };
  const badge = item
    ? item.isTrendingDay
      ? {
          text: "Em alta hoje",
          cls: "bg-rose-500/20 text-rose-300 border-rose-500/25",
        }
      : item.isPremiere
        ? {
            text: "Estreia",
            cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/25",
          }
        : item.isFinale
          ? {
              text: "Final de temporada",
              cls: "bg-violet-500/20 text-violet-300 border-violet-500/25",
            }
          : item.isTrendingWeek
            ? {
                text: "Em alta na semana",
                cls: "bg-amber-500/20 text-amber-300 border-amber-500/25",
              }
            : null
    : null;
  const href = tmdb ? `/title/tv/${tmdb.tmdb_id}` : "#";

  return (
    <div className="relative isolate mb-9 overflow-hidden rounded-[2rem] border border-white/[0.10] shadow-[0_32px_100px_rgba(0,0,0,0.55)]">
      <div className="absolute inset-0 -z-10 bg-zinc-950" />
      <div
        className="absolute inset-0 -z-10 transition-opacity duration-700"
        style={{ opacity: visible ? 1 : 0.6 }}
      >
        {backdrop ? (
          <img
            src={backdrop}
            alt=""
            className="h-full w-full object-cover object-center"
          />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-zinc-900 to-black" />
        )}
        <div className="absolute inset-0 bg-black/75" />
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
      </div>
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at 15% 0%, rgba(56,189,248,0.18) 0%, transparent 55%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse at 90% 100%, rgba(16,185,129,0.10) 0%, transparent 50%)",
        }}
      />
      <div
        className="absolute inset-0 -z-10 opacity-[0.015]"
        style={{
          backgroundImage:
            "linear-gradient(0deg,white 1px,transparent 1px),linear-gradient(90deg,white 1px,transparent 1px)",
          backgroundSize: "64px 64px",
        }}
      />

      {/* Faixa superior */}
      <div className="relative px-5 pt-5 pb-0 sm:px-9 sm:pt-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-400/80">
                Radar · POPLOG
              </span>
              <span
                className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${phase === "done" ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/70" : "border-sky-500/20 bg-sky-500/10 text-sky-400/70"}`}
              >
                <span
                  className={`w-1 h-1 rounded-full ${phase === "done" ? "bg-emerald-400/80" : "bg-sky-400/80 animate-pulse"}`}
                />
                {phase === "done" ? "Engine ativa" : PHASE_LABELS[phase]}
              </span>
            </div>
            <p className="text-[12px] text-white/25 capitalize">{today}</p>
          </div>

          {/* Tabs de período */}
          <div className="hidden w-full items-center gap-1 rounded-2xl border border-white/[0.09] bg-black/30 p-1 backdrop-blur-md shrink-0 sm:w-auto">
            {VIEW_MODE_OPTIONS.map(({ value: v, label }) => (
              <button
                key={v}
                type="button"
                onClick={() => onChangeViewMode(v)}
                className={`flex-1 rounded-lg px-2 py-1.5 text-[10px] font-bold transition-all duration-200 sm:flex-none sm:px-3.5 sm:text-[11px] ${viewMode === v ? "border border-sky-300/25 bg-sky-300/[0.14] text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.12)]" : "text-white/30 hover:text-white/55"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Título + métricas + seletor de modo */}
        <div className="mt-4 mb-4 sm:mb-5">
          <div className="flex items-end justify-between gap-3 sm:hidden">
            <h1 className="text-4xl font-black text-white leading-none tracking-[-0.06em]">
              Radar
            </h1>
            {filteredCount > 0 && (
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-xl border border-white/[0.07] bg-black/20 px-2.5 py-1.5 text-right">
                  <p className="text-[20px] font-black leading-none text-white/78 tabular-nums">
                    {filteredCount}
                  </p>
                  <p className="mt-0.5 text-[9px] font-bold uppercase text-white/28">
                    séries
                  </p>
                </div>
                <div className="rounded-xl border border-emerald-300/[0.10] bg-emerald-400/[0.06] px-2.5 py-1.5 text-right">
                  <p className="text-[20px] font-black leading-none text-emerald-300 tabular-nums">
                    {filteredEps.toLocaleString("pt-BR")}
                  </p>
                  <p className="mt-0.5 text-[9px] font-bold uppercase text-white/28">
                    eps
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="hidden items-center gap-4 flex-wrap sm:flex">
          <h1 className="text-4xl sm:text-5xl font-black text-white leading-none tracking-[-0.06em]">
            Radar
          </h1>
          {filteredCount > 0 && (
            <>
              <div className="h-6 w-px bg-white/10 ml-1" />
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black text-white/75 tabular-nums">
                  {filteredCount}
                </span>
                <span className="text-[11px] text-white/30">séries</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black text-emerald-300 tabular-nums">
                  {filteredEps.toLocaleString("pt-BR")}
                </span>
                <span className="text-[11px] text-white/30">episódios</span>
              </div>
            </>
          )}
          </div>
        </div>

        {/* ── Seletor de modo Geral / Personalizado ── */}
        <div className="hidden flex-col items-start gap-2 pb-4 sm:flex-row sm:items-center sm:pb-5">
          <div className="flex w-full items-center gap-1 rounded-2xl border border-white/[0.09] bg-black/40 p-1 backdrop-blur-md sm:w-auto">
            <button
              type="button"
              onClick={() => onChangeRadarMode("general")}
              disabled={isLoadingMode}
              className={`group flex flex-1 items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-bold transition-all duration-200 sm:flex-none sm:gap-2 sm:px-4 sm:text-[12px] ${
                radarMode === "general"
                  ? "border border-sky-300/20 bg-sky-400/[0.12] text-sky-100 shadow-[0_0_20px_rgba(56,189,248,0.10)]"
                  : "text-white/35 hover:text-white/60"
              }`}
            >
              {/* Ícone globo */}
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="w-3.5 h-3.5 shrink-0"
              >
                <circle cx="10" cy="10" r="8" />
                <path
                  d="M2 10h16M10 2c-2 2.5-3 5-3 8s1 5.5 3 8M10 2c2 2.5 3 5 3 8s-1 5.5-3 8"
                  strokeLinecap="round"
                />
              </svg>
              Descobrir
              {radarMode === "general" && (
                <span className="hidden text-[8px] font-black uppercase tracking-wide text-sky-400/60 sm:inline">
                  Ativo
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => onChangeRadarMode("personal")}
              disabled={isLoadingMode}
              className={`group flex flex-1 items-center justify-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-bold transition-all duration-200 sm:flex-none sm:gap-2 sm:px-4 sm:text-[12px] ${
                radarMode === "personal"
                  ? "border border-violet-300/20 bg-violet-400/[0.12] text-violet-100 shadow-[0_0_20px_rgba(139,92,246,0.10)]"
                  : "text-white/35 hover:text-white/60"
              }`}
            >
              {/* Ícone usuário */}
              <svg
                viewBox="0 0 20 20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                className="w-3.5 h-3.5 shrink-0"
              >
                <circle cx="10" cy="7" r="3.5" />
                <path
                  d="M3 17c0-3.314 3.134-6 7-6s7 2.686 7 6"
                  strokeLinecap="round"
                />
              </svg>
              Meu Radar
              {radarMode === "personal" && (
                <span className="hidden text-[8px] font-black uppercase tracking-wide text-violet-400/60 sm:inline">
                  Ativo
                </span>
              )}
              {isLoadingMode && radarMode !== "personal" && (
                <span className="w-1.5 h-1.5 rounded-full bg-white/30 animate-pulse" />
              )}
            </button>
          </div>

          {radarMode === "personal" && (
            <span className="text-[9.5px] text-white/25 sm:text-[10px]">
              Baseado na sua watchlist e histórico
            </span>
          )}
          {radarMode === "general" && (
            <span className="text-[9.5px] text-white/25 sm:text-[10px]">
              Descoberta ampla — todos os lançamentos
            </span>
          )}
        </div>
      </div>

      {/* Hero cinematográfico */}
      {spotlightItems.length > 0 && item && tmdb && (
        <div
          className="relative min-h-[190px] cursor-pointer overflow-hidden sm:min-h-[220px]"
          onClick={() => router.push(href)}
        >
          <div className="absolute top-0 inset-x-6 sm:inset-x-9 h-px bg-white/[0.06]" />
          {spotlightItems.length > 1 && (
            <>
              <button
                type="button"
                aria-label="Anterior"
                onClick={(e) => {
                  e.stopPropagation();
                  if (timerRef.current) clearTimeout(timerRef.current);
                  goTo(
                    (idx - 1 + spotlightItems.length) % spotlightItems.length,
                  );
                }}
                className="sm:hidden absolute bottom-5 right-12 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.16] bg-black/45 backdrop-blur-md"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-3.5 h-3.5 text-white/70"
                >
                  <path
                    d="M10 3L5 8l5 5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Próximo"
                onClick={(e) => {
                  e.stopPropagation();
                  if (timerRef.current) clearTimeout(timerRef.current);
                  goTo((idx + 1) % spotlightItems.length);
                }}
                className="sm:hidden absolute bottom-5 right-3 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-white/[0.16] bg-black/45 backdrop-blur-md"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  className="w-3.5 h-3.5 text-white/70"
                >
                  <path
                    d="M6 3l5 5-5 5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            </>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />
          <div
            className="relative flex min-h-[210px] items-end gap-5 p-5 transition-opacity duration-300 sm:min-h-[240px] sm:p-7"
            style={{ opacity: visible ? 1 : 0 }}
          >
            {poster && (
              <div className="hidden sm:block w-[80px] shrink-0 rounded-xl overflow-hidden border border-white/[0.10] shadow-xl shadow-black/40">
                <img
                  src={poster}
                  alt={itemTitleDisplay.mainTitle}
                  className="w-full aspect-[2/3] object-cover"
                />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                <span
                  className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${catColor}`}
                >
                  {catLabel}
                </span>
                {item.group.streamingProvider && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border bg-emerald-500/15 text-emerald-300/80 border-emerald-500/20">
                    {item.group.streamingProvider.name}
                  </span>
                )}
                {badge && (
                  <span
                    className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${badge.cls}`}
                  >
                    {badge.text}
                  </span>
                )}
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/35 border border-white/[0.08] rounded-lg px-2 py-0.5">
                  {item.label}
                </span>
              </div>
              <h3 className="text-2xl sm:text-[28px] font-black tracking-[-0.04em] text-white/95 leading-none mb-2 line-clamp-2">
                {itemTitleDisplay.mainTitle}
              </h3>
              {itemTitleDisplay.subTitle && (
                <p className="mb-2 line-clamp-1 text-[12px] font-medium text-white/40">
                  {itemTitleDisplay.subTitle}
                </p>
              )}
              {tmdb.overview && (
                <p className="text-[12px] text-white/40 leading-relaxed line-clamp-2 max-w-lg mb-2.5">
                  {tmdb.overview}
                </p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                {(tmdb.vote_average ?? 0) > 0 && (
                  <div className="flex items-center gap-1">
                    <svg
                      width="11"
                      height="11"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="text-amber-400"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    <span className="text-[12px] font-black text-amber-300">
                      {tmdb.vote_average.toFixed(1)}
                    </span>
                  </div>
                )}
                {tmdb.networks && tmdb.networks.length > 0 && (
                  <span className="text-[11px] text-white/30">
                    {tmdb.networks[0].name}
                  </span>
                )}
                {(tmdb.number_of_seasons ?? 0) > 0 && (
                  <span className="text-[11px] text-white/20">
                    {tmdb.number_of_seasons} temporada
                    {(tmdb.number_of_seasons ?? 0) !== 1 ? "s" : ""}
                  </span>
                )}
              </div>
            </div>
            {spotlightItems.length > 1 && (
              <div className="hidden sm:flex flex-col items-center gap-2 shrink-0 self-center">
                <button
                  type="button"
                  aria-label="Anterior"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (timerRef.current) clearTimeout(timerRef.current);
                    goTo(
                      (idx - 1 + spotlightItems.length) % spotlightItems.length,
                    );
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.15] bg-white/[0.06] hover:bg-white/[0.14] transition-all"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="w-3.5 h-3.5 text-white/60"
                  >
                    <path
                      d="M10 3L5 8l5 5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  aria-label="Próximo"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (timerRef.current) clearTimeout(timerRef.current);
                    goTo((idx + 1) % spotlightItems.length);
                  }}
                  className="flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.15] bg-white/[0.06] hover:bg-white/[0.14] transition-all"
                >
                  <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="w-3.5 h-3.5 text-white/60"
                  >
                    <path
                      d="M6 3l5 5-5 5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                <div className="flex flex-col gap-1 mt-1">
                  {spotlightItems
                    .slice(0, Math.min(spotlightItems.length, 8))
                    .map((_, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (timerRef.current) clearTimeout(timerRef.current);
                          goTo(i);
                        }}
                        className={`rounded-full transition-all duration-300 ${i === idx ? "h-4 w-1.5 bg-white/60" : "h-1.5 w-1.5 bg-white/20 hover:bg-white/35"}`}
                        aria-label={`Slide ${i + 1}`}
                      />
                    ))}
                </div>
              </div>
            )}
          </div>
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/[0.05]">
            <div
              className="h-full bg-white/25 rounded-full"
              style={{
                animation: `spotlight-progress ${SPOTLIGHT_MS}ms linear`,
                animationPlayState: "running",
                width: "100%",
                transformOrigin: "left",
              }}
              key={idx}
            />
          </div>
        </div>
      )}

      {spotlightItems.length === 0 && phase !== "done" && (
        <RadarLoadingState phase={phase} enrichProgress={enrichProgress} />
      )}

      <style>{`@keyframes spotlight-progress { from { transform: scaleX(0); } to { transform: scaleX(1); } }`}</style>
    </div>
  );
}

function RadarStickyNav({
  radarMode,
  viewMode,
  isLoadingMode,
  filteredCount,
  contentFilter,
  filterCounts,
  onChangeRadarMode,
  onChangeViewMode,
  onChangeContentFilter,
}: {
  radarMode: RadarMode;
  viewMode: ViewMode;
  isLoadingMode: boolean;
  filteredCount: number;
  contentFilter: ContentFilterKey;
  filterCounts: FilterCount[];
  onChangeRadarMode: (m: RadarMode) => void;
  onChangeViewMode: (m: ViewMode) => void;
  onChangeContentFilter: (f: ContentFilterKey) => void;
}) {
  const visibleFilters = filterCounts.filter(
    (fc) => fc.key === "all" || fc.count > 0,
  );

  return (
    <div className="sticky top-0 z-40 -mx-4 mb-5 border-y border-white/[0.07] bg-[#050713]/94 px-4 py-2 shadow-[0_18px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:-mx-6 sm:px-6 md:-mx-8 md:px-8 lg:-mx-10 lg:mb-7 lg:px-10 lg:py-2.5">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-1.5 xl:flex-row xl:items-center xl:justify-between xl:gap-2">
        <div className="grid grid-cols-2 items-center gap-1.5 xl:flex xl:max-w-[30%] xl:gap-2 xl:overflow-x-auto xl:no-scrollbar">
          <button
            type="button"
            onClick={() => onChangeRadarMode("general")}
            disabled={isLoadingMode}
            className={`flex h-8 min-w-0 items-center justify-center gap-2 rounded-xl border px-2.5 text-[10px] font-black transition sm:px-4 sm:text-[11px] xl:h-9 xl:shrink-0 xl:rounded-full ${
              radarMode === "general"
                ? "border-sky-300/25 bg-sky-400/[0.14] text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.12)]"
                : "border-white/[0.09] bg-white/[0.035] text-white/45 hover:text-white/70"
            } disabled:opacity-60`}
          >
            Descobrir
          </button>

          <button
            type="button"
            onClick={() => onChangeRadarMode("personal")}
            disabled={isLoadingMode}
            className={`flex h-8 min-w-0 items-center justify-center gap-2 rounded-xl border px-2.5 text-[10px] font-black transition sm:px-4 sm:text-[11px] xl:h-9 xl:shrink-0 xl:rounded-full ${
              radarMode === "personal"
                ? "border-violet-300/25 bg-violet-400/[0.14] text-violet-100 shadow-[0_0_18px_rgba(139,92,246,0.12)]"
                : "border-white/[0.09] bg-white/[0.035] text-white/45 hover:text-white/70"
            } disabled:opacity-60`}
          >
            Meu Radar
            {isLoadingMode && (
              <span className="h-1.5 w-1.5 rounded-full bg-white/40 animate-pulse" />
            )}
          </button>

          <span className="hidden h-5 w-px shrink-0 bg-white/[0.10] lg:block" />
          <span className="hidden shrink-0 text-[11px] font-medium text-white/28 lg:inline">
            {filteredCount} {filteredCount === 1 ? "item" : "itens"}
          </span>
        </div>

        <div className="grid grid-cols-4 items-center gap-1 rounded-xl border border-white/[0.08] bg-black/28 p-1 xl:flex xl:overflow-x-auto xl:rounded-2xl xl:no-scrollbar">
          {VIEW_MODE_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onChangeViewMode(value)}
              className={`h-7 min-w-0 rounded-lg px-1.5 text-[9px] font-black transition sm:px-3 sm:text-[10px] xl:h-8 xl:shrink-0 xl:rounded-xl xl:px-4 xl:text-[11px] ${
                viewMode === value
                  ? "bg-sky-300/[0.15] text-sky-100 ring-1 ring-sky-300/25"
                  : "text-white/38 hover:bg-white/[0.05] hover:text-white/70"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {visibleFilters.length > 1 && (
          <div className="-mx-1 flex items-center gap-1.5 overflow-x-auto px-1 pb-0.5 no-scrollbar xl:mx-0 xl:max-w-[36%] xl:justify-end xl:px-0 xl:pb-0">
            {visibleFilters.map(({ key, count }) => {
              const isActive = key === contentFilter;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onChangeContentFilter(key)}
                  className={[
                    "flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[9px] font-black transition-all duration-200 sm:h-8 sm:rounded-xl sm:px-3 sm:text-[11px]",
                    isActive
                      ? "border-sky-300/25 bg-sky-400/[0.12] text-sky-100 shadow-[0_0_14px_rgba(56,189,248,0.10)]"
                      : "border-white/[0.08] bg-white/[0.035] text-white/38 hover:border-white/[0.14] hover:text-white/65",
                  ].join(" ")}
                >
                  {CONTENT_FILTER_LABELS[key]}
                  <span
                    className={[
                      "rounded-md px-1.5 py-0.5 text-[8px] font-black tabular-nums sm:text-[9px]",
                      isActive
                        ? "bg-sky-400/20 text-sky-200/80"
                        : "bg-white/[0.06] text-white/25",
                    ].join(" ")}
                  >
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Painel do modo Personalizado ───────────────────────────────────────────────

function PersonalRadarPanel({ data }: { data: AgendaV2CompatResponse | null }) {
  if (!data) {
    return (
      <div className="rounded-[24px] border border-white/[0.08] bg-zinc-900/80 px-6 py-14 text-center">
        <p className="text-[14px] font-black text-white/35">
          Carregando radar personalizado…
        </p>
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
        <p className="text-[14px] font-black text-white/35">
          Nenhum conteúdo personalizado disponível.
        </p>
        <p className="mt-2 text-[12px] text-white/20">
          Adicione títulos à sua watchlist para ver sugestões personalizadas.
        </p>
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
              <a
                key={ev.id}
                href={`/title/${ev.mediaType}/${ev.tmdbId}`}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 hover:bg-white/[0.05] transition-colors"
              >
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                  {ev.backdropPath && (
                    <img
                      src={TMDB_IMG(ev.backdropPath, "w185")!}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-white/85">
                    {ev.title}
                  </p>
                  <p className="text-[10px] text-white/35 mt-0.5">
                    {ev.episodeNumber
                      ? `S${ev.seasonNumber ?? 1}E${ev.episodeNumber}`
                      : ""}
                    {ev.airDate
                      ? ` · ${daysUntilDate(ev.airDate) <= 0 ? "Hoje" : `Em ${daysUntilDate(ev.airDate)} dias`}`
                      : ""}
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
              <a
                key={ev.id}
                href={`/title/${ev.mediaType}/${ev.tmdbId}`}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-3 hover:bg-white/[0.05] transition-colors"
              >
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                  {ev.backdropPath && (
                    <img
                      src={TMDB_IMG(ev.backdropPath, "w185")!}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-white/85">
                    {ev.title}
                  </p>
                  <p className="text-[10px] text-white/35 mt-0.5">
                    {ev.episodeNumber
                      ? `S${ev.seasonNumber ?? 1}E${ev.episodeNumber}`
                      : ""}
                    {ev.airDate
                      ? ` · ${daysUntilDate(ev.airDate) <= 0 ? "Hoje" : `Em ${daysUntilDate(ev.airDate)} dias`}`
                      : ""}
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
              <a
                key={ev.id}
                href={`/title/${ev.mediaType}/${ev.tmdbId}`}
                className="flex items-center gap-3 rounded-2xl border border-amber-500/15 bg-amber-950/10 p-3 hover:bg-amber-950/20 transition-colors"
              >
                <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                  {ev.backdropPath && (
                    <img
                      src={TMDB_IMG(ev.backdropPath, "w185")!}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-black text-white/85">
                    {ev.title}
                  </p>
                  <p className="text-[10px] text-amber-300/60 mt-0.5">
                    {ev.daysUntil != null
                      ? `Sai em ${ev.daysUntil} dias`
                      : "Saindo em breve"}
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
              <a
                key={ev.id}
                href={`/title/${ev.mediaType}/${ev.tmdbId}`}
                className="relative overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.05] transition-colors aspect-[2/3] block"
              >
                {ev.posterPath && (
                  <img
                    src={TMDB_IMG(ev.posterPath, "w342")!}
                    alt={ev.title}
                    className="absolute inset-0 h-full w-full object-cover"
                    loading="lazy"
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                <div className="absolute bottom-2 left-2 right-2">
                  <p className="text-[11px] font-black text-white/90 leading-tight line-clamp-2">
                    {ev.title}
                  </p>
                </div>
              </a>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

interface FilterCount {
  key: ContentFilterKey;
  count: number;
}

// ── RadarClient — componente principal ─────────────────────────────────────────

export default function RadarClient({
  initialData,
  initialMode,
}: {
  initialData: IcsAgendaResponse | null;
  initialMode: RadarMode;
}) {
  const userData = useOptionalUserData();

  // Mapa de estado da biblioteca indexado por "tmdbId:mediaType".
  // Atualiza automaticamente quando UserDataContext recarrega após mutações.
  const libraryLookup = useMemo((): LibraryLookup => {
    const map = new Map<string, LibraryEntry>();
    if (!userData) return map;
    for (const t of userData.titles) {
      map.set(`${t.tmdb_id}:${t.media_type}`, {
        status: t.status,
        isFavorite: Boolean(t.favorite),
      });
    }
    return map;
  }, [userData?.titles]); // eslint-disable-line react-hooks/exhaustive-deps

  const hydrate = (gs: IcsSeriesGroup[]): IcsSeriesGroup[] =>
    gs.map((g) => ({ ...g, episodes: g.episodes.map((ep) => ({ ...ep })) }));

  const hydrateSections = (
    s: RadarSections | undefined,
  ): RadarSections | null => {
    if (!s) return null;
    return {
      today: s.today.map((g) => ({
        ...g,
        episodes: g.episodes.map((ep) => ({ ...ep })),
      })),
      thisWeek: s.thisWeek.map((g) => ({
        ...g,
        episodes: g.episodes.map((ep) => ({ ...ep })),
      })),
      next30Days: s.next30Days.map((g) => ({
        ...g,
        episodes: g.episodes.map((ep) => ({ ...ep })),
      })),
      cinemaToday:    s.cinemaToday    ?? [],
      cinemaThisWeek: s.cinemaThisWeek ?? [],
      cinemaNext:     s.cinemaNext     ?? [],
    };
  };

  // ── Estado do Radar Geral ──────────────────────────────────────────────────
  const [groups, setGroups] = useState<IcsSeriesGroup[]>(() =>
    initialData ? hydrate(initialData.groups ?? []) : [],
  );
  const [featuredGroups, setFeatured] = useState<IcsSeriesGroup[]>(() =>
    initialData ? hydrate(initialData.featuredGroups ?? []) : [],
  );
  const [sections, setSections] = useState<RadarSections | null>(() =>
    initialData ? hydrateSections(initialData.sections) : null,
  );
  const [movies, setMovies] = useState<MovieGroup[]>(
    () => initialData?.movies ?? [],
  );
  const [phase, setPhase] = useState<Phase>(() =>
    initialData ? "done" : "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState(0);

  const trendingDayRef = useRef<Set<number>>(
    new Set(initialData?.trendingDay ?? []),
  );
  const trendingWeekRef = useRef<Set<number>>(
    new Set(initialData?.trendingWeek ?? []),
  );

  // ── Estado do Radar Personalizado ────────────────────────────────────────
  const [personalEmpty, setPersonalEmpty] = useState(false);
  const [personalLibrarySize, setPersonalLibrarySize] = useState<number | null>(null);

  // ── Estado do modo ────────────────────────────────────────────────────────
  const [radarMode, setRadarMode] = useState<RadarMode>(initialMode);
  const [isLoadingMode, setIsLoadingMode] = useState(false);

  // ── Estado de navegação ────────────────────────────────────────────────────
  const now = new Date();
  const [viewMode, setViewMode] = useState<ViewMode>("all");
  const [navYear, setNavYear] = useState(now.getFullYear());
  const [navMonth, setNavMonth] = useState(now.getMonth());
  const [navWeekStart, setNavWeekStart] = useState(() => startOfWeek(now));
  const [selectedDay, setSelectedDay] = useState(todayStr());

  // ── Filtro por tipo de conteúdo ────────────────────────────────────────────
  // Estado por aba de período — cada aba preserva seu filtro independentemente.
  const [filterByMode, setFilterByMode] = useState<Record<ViewMode, ContentFilterKey>>({
    all: "all",
    day: "all",
    week: "all",
    month: "all",
  });
  const contentFilter = filterByMode[viewMode];

  const handleContentFilter = useCallback(
    (f: ContentFilterKey) => {
      setFilterByMode((prev) => ({ ...prev, [viewMode]: f }));
    },
    [viewMode],
  );

  const [generalSnapshot, setGeneralSnapshot] = useState<IcsAgendaResponse | null>(initialData);

  function applyAgendaPayload(data: IcsAgendaResponse) {
    trendingDayRef.current = new Set(data.trendingDay ?? []);
    trendingWeekRef.current = new Set(data.trendingWeek ?? []);
    const hydratedGroups = hydrate(data.groups ?? []);
    const hydratedFeatured = hydrate(data.featuredGroups ?? []);
    setGroups(hydratedGroups);
    setFeatured(hydratedFeatured);
    setSections(hydrateSections(data.sections));
    setMovies(data.movies ?? []);
  }

  // ── Carregamento inicial do modo geral (cache frio) ───────────────────────
  useEffect(() => {
    if (initialData) return; // cache quente — sem fetch necessário

    let cancelled = false;
    async function load() {
      setPhase("fetching_ics");
      try {
        const res = await fetch("/api/radar?mode=general", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPhase("grouping");
        const data = (await res.json()) as { general?: IcsAgendaResponse };
        const agenda = data.general;
        if (!agenda) throw new Error("Payload do Radar vazio");
        if (cancelled) return;
        setPhase("cache_check");
        setGeneralSnapshot(agenda);
        applyAgendaPayload(agenda);
        setEnrichProgress(100);
        setPhase("done");
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Erro");
          setPhase("done");
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [initialData]);

  // ── Alternância de modo ────────────────────────────────────────────────────
  const handleChangeRadarMode = useCallback(
    async (newMode: RadarMode) => {
      if (newMode === radarMode || isLoadingMode) return;
      setIsLoadingMode(true);
      setRadarMode(newMode);

      if (newMode === "personal") {
        try {
          const res = await fetch(`/api/radar?mode=personal&t=${Date.now()}`, { cache: "no-store" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as {
            general?: IcsAgendaResponse;
            libraryFiltered?: boolean;
            librarySize?: number;
            matchedCount?: number;
          };

          const agenda = data.general;
          if (!agenda || (data.matchedCount ?? agenda.featuredGroups?.length ?? 0) === 0) {
            setPersonalEmpty(true);
            setPersonalLibrarySize(data.librarySize ?? 0);
            setIsLoadingMode(false);
            return;
          }

          applyAgendaPayload(agenda);
          setPersonalEmpty((agenda.featuredGroups?.length ?? 0) === 0);
          setPersonalLibrarySize(data.librarySize ?? null);
        } catch (err) {
          console.warn("[radar] erro ao carregar modo personalizado:", err);
          setPersonalEmpty(true);
          setPersonalLibrarySize(0);
        }
      } else {
        if (generalSnapshot) {
          applyAgendaPayload(generalSnapshot);
        } else {
          try {
            const res = await fetch(`/api/radar?mode=general&t=${Date.now()}`, { cache: "no-store" });
            if (res.ok) {
              const data = (await res.json()) as { general?: IcsAgendaResponse };
              if (data.general) {
                setGeneralSnapshot(data.general);
                applyAgendaPayload(data.general);
              }
            }
          } catch (err) {
            console.warn("[radar] erro ao restaurar modo geral:", err);
          }
        }
        setPersonalEmpty(false);
        setPersonalLibrarySize(null);
      }

      setIsLoadingMode(false);
    },
    [radarMode, isLoadingMode, generalSnapshot],
  );

  // ── Dados visíveis ────────────────────────────────────────────────────────
  const visibleFeatured = useMemo(
    () => featuredGroups,
    [featuredGroups],
  );

  const filteredCount = visibleFeatured.length;
  const filteredEps = useMemo(
    () => visibleFeatured.reduce((acc, g) => acc + g.episodeCount, 0),
    [visibleFeatured],
  );

  const spotlightItems = useMemo(
    () =>
      buildSpotlightItems(
        visibleFeatured,
        trendingDayRef.current,
        trendingWeekRef.current,
      ),
    [visibleFeatured],
  );

  const isLoading = phase !== "done" && phase !== "idle";

  // Seleciona a seção pré-particionada pelo backend conforme o viewMode.
  // Quando sections está disponível, o backend decide a janela temporal.
  const sectionGroupsForMode = useMemo(
    (): IcsSeriesGroup[] | undefined =>
      buildRawGroupsForViewMode(viewMode, sections, groups, featuredGroups),
    [sections, groups, featuredGroups, viewMode],
  );

  const cinemaGroupsForMode = useMemo(() => {
    if (!sections) return undefined;
    if (viewMode === "all") return [
      ...(sections.cinemaToday ?? []),
      ...(sections.cinemaThisWeek ?? []),
      ...(sections.cinemaNext ?? []),
    ];
    if (viewMode === "day") return sections.cinemaToday ?? [];
    if (viewMode === "week") return sections.cinemaThisWeek ?? [];
    return sections.cinemaNext ?? [];
  }, [sections, viewMode]);

  const editorialItems = useMemo(
    () =>
      buildEditorialGroups(visibleFeatured, movies, {
        mode: viewMode,
        selectedDay,
        weekStart: navWeekStart,
        year: navYear,
        month: navMonth,
        trendingDay: trendingDayRef.current,
        trendingWeek: trendingWeekRef.current,
        sectionGroups: sectionGroupsForMode,
        cinemaGroups: cinemaGroupsForMode,
      }),
    [
      viewMode,
      selectedDay,
      navWeekStart,
      navYear,
      navMonth,
      visibleFeatured,
      movies,
      sectionGroupsForMode,
      cinemaGroupsForMode,
    ],
  );

  // ── Contagens por filtro e lista filtrada ─────────────────────────────────
  const filterCounts = useMemo((): FilterCount[] => {
    const keys: ContentFilterKey[] = [
      "all",
      "today",
      "week",
      "series",
      "movies",
      "streaming",
      "premieres",
      "finales",
      "recent",
      "animation",
      "anime",
      "reality",
      "talk_news",
      "sports",
      "kids",
      "cinema",
      "physical",
      "season_drop",
      "live",
    ];
    return keys.map((key) => ({
      key,
      count: key === "all"
        ? editorialItems.length
        : editorialItems.filter((item) => itemMatchesRadarFilter(item, key)).length,
    }));
  }, [editorialItems]);

  const filteredEditorialItems = useMemo(() => {
    const filtered =
      contentFilter === "all"
        ? editorialItems
        : editorialItems.filter((item) => itemMatchesRadarFilter(item, contentFilter));

    // Bug #3: quando o filtro é um subtipo específico (anime, reality, documentary),
    // itens que foram marcados "compact" pelo applyLanguageCap devem ser promovidos
    // a "poster" — o cap de diversidade de idioma não faz sentido quando o usuário
    // já escolheu ver apenas aquele tipo de conteúdo.
    if (contentFilter === "all") return filtered;

    return filtered.map((item) =>
      item.visualWeight === "compact"
        ? { ...item, visualWeight: "poster" as const }
        : item,
    );
  }, [editorialItems, contentFilter]);

  return (
    <PageShell variant="wide">
      <RadarHero
        phase={phase}
        viewMode={viewMode}
        onChangeViewMode={setViewMode}
        filteredCount={filteredEditorialItems.length}
        filteredEps={filteredEps}
        enrichProgress={enrichProgress}
        spotlightItems={spotlightItems}
        radarMode={radarMode}
        onChangeRadarMode={handleChangeRadarMode}
        isLoadingMode={isLoadingMode}
        personalLibrarySize={personalLibrarySize}
      />

      <RadarStickyNav
        radarMode={radarMode}
        viewMode={viewMode}
        isLoadingMode={isLoadingMode}
        filteredCount={filteredEditorialItems.length}
        contentFilter={contentFilter}
        filterCounts={filterCounts}
        onChangeRadarMode={handleChangeRadarMode}
        onChangeViewMode={setViewMode}
        onChangeContentFilter={handleContentFilter}
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-950/20 px-5 py-4 text-[12px] text-red-300/80">
          Erro ao carregar feed: {error}
        </div>
      )}

      <SectionDivider />

      {/* Feed unificado — mesmo componente para Geral e Personalizado */}
      <RadarLibraryCtx.Provider value={libraryLookup}>
        <section>
          {radarMode === "personal" && !isLoadingMode && personalEmpty && (
            <div className="rounded-[24px] border border-violet-500/10 bg-violet-950/10 px-6 py-14 text-center">
              <p className="text-[14px] font-black text-white/35">
                Nenhum título da sua biblioteca está no radar agora.
              </p>
              <p className="mt-2 text-[12px] text-white/20">
                Adicione séries à sua watchlist para vê-las aqui quando tiverem novidades.
              </p>
            </div>
          )}
          {!(radarMode === "personal" && !isLoadingMode && personalEmpty) && (
            <AgendaEditorialFeed
              items={filteredEditorialItems}
              mode={viewMode}
              isLoading={isLoading || isLoadingMode}
              trendingDay={trendingDayRef.current}
              trendingWeek={trendingWeekRef.current}
              radarMode={radarMode}
              contentFilter={contentFilter}
            />
          )}
        </section>
      </RadarLibraryCtx.Provider>

      <div className="mt-10 flex items-center gap-2 border-t border-white/[0.05] pt-6">
        <span
          className={`w-1.5 h-1.5 rounded-full ${phase === "done" ? "bg-emerald-400/60" : "bg-amber-400/60 animate-pulse"}`}
        />
        <ContextualAttribution
          context="calendar"
          sourcesUsed={["trakt"]}
        />
      </div>
    </PageShell>
  );
}
