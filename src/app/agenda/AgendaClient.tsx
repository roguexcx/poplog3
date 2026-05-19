"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/layout/PageShell";
import type { IcsSeriesGroup, ContentCategory } from "@/lib/ics-engine";
import { FEATURED_CATEGORIES, CATEGORY_PRIORITY, filterEnrichedGroup } from "@/lib/ics-engine";
import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";

// ── Constantes ─────────────────────────────────────────────────────────────────

const TMDB_IMG = (path: string | null, size: string) =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

const ENRICH_BATCH   = 10;
const ENRICH_PAUSE   = 700;
const SPOTLIGHT_MS   = 6000; // ms entre slides do spotlight

// ── Fases do carregamento ──────────────────────────────────────────────────────

type Phase =
  | "idle"
  | "fetching_ics"
  | "grouping"
  | "cache_check"
  | "enriching"
  | "done";

const PHASE_LABELS: Record<Phase, string> = {
  idle:         "Iniciando…",
  fetching_ics: "Lendo calendário…",
  grouping:     "Agrupando séries…",
  cache_check:  "Consultando cache…",
  enriching:    "Enriquecendo dados…",
  done:         "Agenda pronta",
};

// ── Tipos de view ──────────────────────────────────────────────────────────────

type ViewMode = "month" | "week" | "day";

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

function formatMonthYear(y: number, m: number) {
  return new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
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
  // isoStr is like "2025-05-20T01:00:00.000Z"
  const d = new Date(isoStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function getDaysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }

function getFirstDayOfMonth(y: number, m: number) {
  const d = new Date(y, m, 1).getDay();
  return d === 0 ? 6 : d - 1; // 0=Seg
}

// ── Filtro: só mostra grupos com poster + nome TMDB ───────────────────────────

function hasValidTmdb(g: IcsSeriesGroup): boolean {
  return !!(g.tmdb?.poster_path && g.tmdb?.name);
}

// ── Agrupamento por dia para o calendário ──────────────────────────────────────

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

// ── Categoria label ────────────────────────────────────────────────────────────

const CAT_LABEL: Partial<Record<ContentCategory, string>> = {
  CINEMATIC: "Prestige", SERIES: "Série", ANIMATION: "Animação",
  DOCUMENTARY: "Doc", REALITY_PREMIUM: "Reality", REALITY: "Reality",
  DAILY_SOAP: "Soap", VARIETY: "Variedade", KIDS: "Kids",
};

const CAT_COLOR: Partial<Record<ContentCategory, string>> = {
  CINEMATIC:       "bg-violet-500/20 text-violet-300/80 border-violet-500/20",
  SERIES:          "bg-indigo-500/20 text-indigo-300/80 border-indigo-500/20",
  ANIMATION:       "bg-teal-500/20 text-teal-300/80 border-teal-500/20",
  DOCUMENTARY:     "bg-cyan-500/20 text-cyan-300/80 border-cyan-500/20",
  REALITY_PREMIUM: "bg-amber-500/20 text-amber-300/80 border-amber-500/20",
  REALITY:         "bg-orange-500/15 text-orange-300/60 border-orange-500/15",
  DAILY_SOAP:      "bg-white/[0.04] text-white/25 border-white/[0.07]",
  VARIETY:         "bg-white/[0.04] text-white/25 border-white/[0.07]",
};

// ── Componentes visuais ────────────────────────────────────────────────────────

function SectionEyebrow({ children, color = "indigo" }: {
  children: React.ReactNode;
  color?: "indigo" | "rose" | "cyan" | "violet" | "teal" | "amber";
}) {
  const colors = {
    indigo: "bg-indigo-400/60 text-indigo-400/80",
    rose:   "bg-rose-400/60 text-rose-400/80",
    cyan:   "bg-cyan-400/60 text-cyan-400/80",
    violet: "bg-violet-400/60 text-violet-400/80",
    teal:   "bg-teal-400/60 text-teal-400/80",
    amber:  "bg-amber-400/60 text-amber-400/80",
  };
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

// ── Phase indicator ────────────────────────────────────────────────────────────

function PhaseBar({ phase, enrichProgress }: { phase: Phase; enrichProgress: number }) {
  if (phase === "done") return null;
  return (
    <div className="flex items-center gap-3 mb-6 px-4 py-3 rounded-2xl border border-white/[0.06] bg-white/[0.02]">
      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/80 animate-pulse shrink-0" />
      <span className="text-[11px] font-bold text-white/40">{PHASE_LABELS[phase]}</span>
      {phase === "enriching" && enrichProgress > 0 && (
        <>
          <div className="flex-1 h-px bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500/50 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, enrichProgress)}%` }}
            />
          </div>
          <span className="text-[9px] font-bold text-white/20">{Math.round(enrichProgress)}%</span>
        </>
      )}
    </div>
  );
}

// ── Série card ─────────────────────────────────────────────────────────────────

function SeriesCard({
  group, href, compact = false,
}: {
  group: IcsSeriesGroup;
  href: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const tmdb = group.tmdb;
  const poster   = tmdb ? TMDB_IMG(tmdb.poster_path, "w185") : null;
  const backdrop = tmdb ? TMDB_IMG(tmdb.backdrop_path, "w780") : null;
  const name     = tmdb?.name ?? group.rawTitle;
  const catLabel = CAT_LABEL[group.category] ?? group.category;
  const catColor = CAT_COLOR[group.category] ?? "bg-white/[0.05] text-white/30 border-white/[0.08]";

  const nextDate = new Date(group.nextAirDate);
  const daysUntil = Math.ceil((nextDate.getTime() - Date.now()) / 86_400_000);
  const dateLabel =
    daysUntil <= 0 ? "Hoje" :
    daysUntil === 1 ? "Amanhã" :
    daysUntil <= 7 ? `Em ${daysUntil} dias` :
    nextDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const dateFull = nextDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const urgencyColor =
    daysUntil <= 0  ? "text-rose-400" :
    daysUntil <= 1  ? "text-amber-400" :
    daysUntil <= 7  ? "text-indigo-400" :
    "text-white/30";

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    router.push(href);
  };

  if (compact) {
    return (
      <a
        href={href}
        onClick={handleClick}
        className="group relative w-full text-left rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.12] transition-all duration-300 overflow-hidden p-3.5 block"
      >
        {backdrop && (
          <div className="absolute inset-0 opacity-[0.07]">
            <img src={backdrop} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
          </div>
        )}
        <div className="relative flex items-center gap-3.5">
          <div className="relative w-[46px] h-[68px] rounded-xl overflow-hidden bg-white/[0.05] shrink-0 border border-white/[0.08]">
            {poster ? (
              <img src={poster} alt={name} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="h-full w-full flex items-center justify-center">
                <span className="text-[9px] font-black text-white/15 text-center leading-tight px-1">
                  {name.slice(0, 3).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${catColor}`}>
                {catLabel}
              </span>
            </div>
            <p className="text-[14px] font-black tracking-[-0.02em] text-white/88 leading-tight truncate">
              {name}
            </p>
            <p className="text-[11px] text-white/35 mt-1">
              {group.episodeCount} ep · S{group.seasons[0] ?? 1}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={`text-[12px] font-black tabular-nums ${urgencyColor}`}>{dateLabel}</p>
            <p className="text-[9px] text-white/20 tabular-nums mt-0.5">{dateFull}</p>
          </div>
        </div>
      </a>
    );
  }

  // Card grande (carrossel)
  return (
    <a
      href={href}
      onClick={handleClick}
      className="group relative w-[160px] sm:w-[176px] text-left shrink-0 block"
    >
      <div className="relative aspect-[2/3] rounded-2xl overflow-hidden border border-white/[0.08] mb-3 bg-white/[0.04]">
        {poster ? (
          <img
            src={poster} alt={name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3 p-4">
            <div className="w-10 h-10 rounded-2xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-white/20">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
            <p className="text-[11px] font-bold text-white/25 text-center leading-tight line-clamp-3">{name}</p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
        <div className="absolute top-2.5 left-2.5">
          <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${catColor}`}>
            {catLabel}
          </span>
        </div>
        {tmdb?.vote_average && tmdb.vote_average > 0 && (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/40 rounded-lg px-1.5 py-0.5">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-[10px] font-bold text-amber-300">{tmdb.vote_average.toFixed(1)}</span>
          </div>
        )}
        <div className="absolute bottom-2.5 left-2.5 right-2.5">
          <p className={`text-[10px] font-black ${urgencyColor}`}>{dateLabel}</p>
          <p className="text-[9px] text-white/30 tabular-nums mt-0.5">{dateFull}</p>
        </div>
      </div>
      <div className="px-0.5">
        <p className="text-[13px] font-bold text-white/88 leading-tight tracking-[-0.02em] line-clamp-2 mb-1">{name}</p>
        <p className="text-[11px] text-white/35">
          {group.episodeCount} ep{group.episodeCount !== 1 ? "s" : ""} · S{group.seasons[0] ?? 1}
        </p>
      </div>
    </a>
  );
}

// ── ScrollRail ─────────────────────────────────────────────────────────────────

function ScrollRail({ children }: { children: React.ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft]   = useState(false);
  const [canRight, setCanRight] = useState(false);

  const sync = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", sync); ro.disconnect(); };
  }, [sync]);

  const nudge = (dir: 1 | -1) => {
    const el = railRef.current;
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.65), behavior: "smooth" });
  };

  return (
    <div className="relative group/rail -mx-4 sm:-mx-6 md:-mx-8 lg:mx-0">
      <div className="absolute left-0 top-0 bottom-3 w-14 pointer-events-none z-10 transition-opacity duration-200"
        style={{ opacity: canLeft ? 1 : 0, background: "linear-gradient(to right, #020617 25%, transparent)" }} />
      {canLeft && (
        <button type="button" onClick={() => nudge(-1)} aria-label="Anterior"
          className="absolute left-2 top-1/2 -translate-y-[calc(50%+6px)] z-20 w-8 h-8 rounded-full border border-white/[0.12] bg-zinc-900/95 flex items-center justify-center text-white/60 hover:text-white hover:bg-zinc-800 transition-all duration-200 opacity-0 group-hover/rail:opacity-100 shadow-lg">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div ref={railRef} className="flex gap-3.5 overflow-x-auto px-4 sm:px-6 md:px-8 lg:px-0 pb-3 no-scrollbar [&>*]:shrink-0">
        {children}
      </div>
      <div className="absolute right-0 top-0 bottom-3 w-14 pointer-events-none z-10 transition-opacity duration-200"
        style={{ opacity: canRight ? 1 : 0, background: "linear-gradient(to left, #020617 25%, transparent)" }} />
      {canRight && (
        <button type="button" onClick={() => nudge(1)} aria-label="Próximo"
          className="absolute right-2 top-1/2 -translate-y-[calc(50%+6px)] z-20 w-8 h-8 rounded-full border border-white/[0.12] bg-zinc-900/95 flex items-center justify-center text-white/60 hover:text-white hover:bg-zinc-800 transition-all duration-200 opacity-0 group-hover/rail:opacity-100 shadow-lg">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Spotlight Hero ─────────────────────────────────────────────────────────────
// Seção que substitui o "Estreando hoje / Na agenda hoje" com um slide hero
// auto-rotativo mostrando destaques do dia + semana, priorizando estreias/finais/trending.

interface SpotlightItem {
  group: IcsSeriesGroup;
  dateStr: string;   // dia do episódio em destaque
  isPremiere: boolean;
  isFinale: boolean;
  isTrendingDay: boolean;
  isTrendingWeek: boolean;
  label: string;     // "Hoje", "Amanhã", "5 de jun." etc.
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

    // Encontra o episódio mais próximo nos próximos 7 dias
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

    // Detecta estreias (S01E01 ou E01) e finais (último ep da temporada)
    const seasonEps = g.episodes.filter((ep) => ep.season === upcomingEp.season);
    const isPremiere = upcomingEp.episode === 1;
    const maxEp = Math.max(...seasonEps.map((e) => e.episode));
    const isFinale = upcomingEp.episode === maxEp && maxEp > 1;

    items.push({ group: g, dateStr, isPremiere, isFinale, isTrendingDay, isTrendingWeek, label });
    seen.add(g.key);
  }

  // Ordena: trending_day > premiere > finale > trending_week > score > popularidade
  items.sort((a, b) => {
    const scoreA =
      (a.isTrendingDay  ? 100 : 0) +
      (a.isPremiere     ? 50  : 0) +
      (a.isFinale       ? 40  : 0) +
      (a.isTrendingWeek ? 30  : 0) +
      (a.group.relevanceScore ?? 0);
    const scoreB =
      (b.isTrendingDay  ? 100 : 0) +
      (b.isPremiere     ? 50  : 0) +
      (b.isFinale       ? 40  : 0) +
      (b.isTrendingWeek ? 30  : 0) +
      (b.group.relevanceScore ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.group.tmdb?.popularity ?? 0) - (a.group.tmdb?.popularity ?? 0);
  });

  // Máx 20 itens no spotlight
  return items.slice(0, 20);
}

function SpotlightHero({
  items,
  isLoading,
}: {
  items: SpotlightItem[];
  isLoading: boolean;
}) {
  const router = useRouter();
  const [idx, setIdx]         = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((nextIdx: number) => {
    setVisible(false);
    setTimeout(() => {
      setIdx(nextIdx);
      setVisible(true);
    }, 300);
  }, []);

  useEffect(() => {
    if (items.length === 0) return;
    timerRef.current = setTimeout(() => {
      goTo((idx + 1) % items.length);
    }, SPOTLIGHT_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [idx, items.length, goTo]);

  if (isLoading && items.length === 0) {
    return (
      <div className="relative rounded-[20px] overflow-hidden bg-white/[0.02] border border-white/[0.06] min-h-[280px] animate-pulse" />
    );
  }

  if (items.length === 0) return null;

  const item = items[idx];
  const { group, label, isPremiere, isFinale, isTrendingDay, isTrendingWeek } = item;
  const tmdb = group.tmdb!;
  const backdrop = TMDB_IMG(tmdb.backdrop_path, "w1280");
  const poster   = TMDB_IMG(tmdb.poster_path,   "w342");
  const name     = tmdb.name;
  const catLabel = CAT_LABEL[group.category] ?? group.category;
  const catColor = CAT_COLOR[group.category] ?? "bg-white/[0.05] text-white/30 border-white/[0.08]";

  // Badge de destaque: prioridade nos badges
  const badge =
    isTrendingDay  ? { text: "Em alta hoje",    cls: "bg-rose-500/20 text-rose-300 border-rose-500/25" } :
    isPremiere     ? { text: "Estreia",          cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/25" } :
    isFinale       ? { text: "Final de temporada", cls: "bg-violet-500/20 text-violet-300 border-violet-500/25" } :
    isTrendingWeek ? { text: "Em alta na semana", cls: "bg-amber-500/20 text-amber-300 border-amber-500/25" } :
    null;

  const href = `/title/tv/${tmdb.tmdb_id}`;

  return (
    <section className="mb-10">
      <div className="flex items-end justify-between mb-4">
        <div>
          <SectionEyebrow color="rose">Destaques</SectionEyebrow>
          <h2 className="text-xl font-black tracking-[-0.03em] text-white/90 leading-tight">Em destaque</h2>
        </div>
        {/* Dots de navegação */}
        {items.length > 1 && (
          <div className="flex items-center gap-1.5">
            {items.slice(0, Math.min(items.length, 8)).map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => { if (timerRef.current) clearTimeout(timerRef.current); goTo(i); }}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === idx ? "w-5 bg-white/60" : "w-1.5 bg-white/20 hover:bg-white/35"
                }`}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>
        )}
      </div>

      <div
        className="relative rounded-[20px] overflow-hidden border border-white/[0.08] cursor-pointer"
        style={{ minHeight: 280 }}
        onClick={() => router.push(href)}
      >
        {/* Botões de navegação mobile (overlay nas bordas) */}
        {items.length > 1 && (
          <>
            <button
              type="button"
              aria-label="Anterior"
              onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx - 1 + items.length) % items.length); }}
              className="sm:hidden absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.20] bg-black/50 backdrop-blur-sm"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/70">
                <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <button
              type="button"
              aria-label="Próximo"
              onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx + 1) % items.length); }}
              className="sm:hidden absolute right-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.20] bg-black/50 backdrop-blur-sm"
            >
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/70">
                <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </>
        )}
        {/* Backdrop */}
        <div
          className="absolute inset-0 transition-opacity duration-300"
          style={{ opacity: visible ? 1 : 0 }}
        >
          {backdrop ? (
            <img src={backdrop} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="h-full w-full bg-gradient-to-br from-indigo-950 to-black" />
          )}
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        </div>

        {/* Conteúdo */}
        <div
          className="relative flex items-end gap-5 p-6 sm:p-8 min-h-[280px] transition-opacity duration-300"
          style={{ opacity: visible ? 1 : 0 }}
        >
          {/* Poster */}
          {poster && (
            <div className="hidden sm:block w-[90px] shrink-0 rounded-xl overflow-hidden border border-white/[0.10] shadow-xl shadow-black/40">
              <img src={poster} alt={name} className="w-full aspect-[2/3] object-cover" />
            </div>
          )}

          {/* Info */}
          <div className="flex-1 min-w-0">
            {/* Badges */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${catColor}`}>
                {catLabel}
              </span>
              {badge && (
                <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${badge.cls}`}>
                  {badge.text}
                </span>
              )}
              <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/35 border border-white/[0.08] rounded-lg px-2 py-0.5">
                {label}
              </span>
              <span className="text-[9px] text-white/20 tabular-nums">
                {new Date(item.dateStr + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })}
              </span>
            </div>

            <h3 className="text-2xl sm:text-3xl font-black tracking-[-0.04em] text-white/95 leading-none mb-2 line-clamp-2">
              {name}
            </h3>

            {tmdb.overview && (
              <p className="text-[12px] text-white/45 leading-relaxed line-clamp-2 max-w-lg mb-3">
                {tmdb.overview}
              </p>
            )}

            <div className="flex items-center gap-3 flex-wrap">
              {tmdb.vote_average > 0 && (
                <div className="flex items-center gap-1">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span className="text-[12px] font-black text-amber-300">{tmdb.vote_average.toFixed(1)}</span>
                </div>
              )}
              {tmdb.networks && tmdb.networks.length > 0 && (
                <span className="text-[11px] text-white/35">{tmdb.networks[0].name}</span>
              )}
              {tmdb.number_of_seasons && (
                <span className="text-[11px] text-white/25">{tmdb.number_of_seasons} temporada{tmdb.number_of_seasons !== 1 ? "s" : ""}</span>
              )}
            </div>
          </div>

          {/* Setas de navegação ← → */}
          {items.length > 1 && (
            <div className="hidden sm:flex flex-col gap-2 shrink-0 self-center">
              <button
                type="button"
                aria-label="Anterior"
                onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx - 1 + items.length) % items.length); }}
                className="flex items-center justify-center w-9 h-9 rounded-full border border-white/[0.15] bg-white/[0.06] hover:bg-white/[0.14] transition-all"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-white/60">
                  <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                type="button"
                aria-label="Próximo"
                onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx + 1) % items.length); }}
                className="flex items-center justify-center w-9 h-9 rounded-full border border-white/[0.15] bg-white/[0.06] hover:bg-white/[0.14] transition-all"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4 text-white/60">
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Barra de progresso do timer */}
        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/[0.06]">
          <div
            className="h-full bg-white/30 rounded-full"
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

      {/* CSS animation keyframes via style tag */}
      <style>{`
        @keyframes spotlight-progress {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
      `}</style>
    </section>
  );
}

// ── AgendaHero ─────────────────────────────────────────────────────────────────

function AgendaHero({
  phase, mode, onChangeMode, filteredCount, filteredEps, enrichProgress,
}: {
  phase: Phase;
  mode: ViewMode;
  onChangeMode: (m: ViewMode) => void;
  filteredCount: number;
  filteredEps: number;
  enrichProgress: number;
}) {
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  return (
    <div className="relative isolate rounded-[24px] overflow-hidden mb-8 min-h-[240px] sm:min-h-[280px] flex flex-col justify-between p-6 sm:p-8 border border-white/[0.06]">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-950/80 via-black to-black" />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 20% 0%, rgba(99,102,241,0.15) 0%, transparent 60%)" }} />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 90% 100%, rgba(6,182,212,0.08) 0%, transparent 50%)" }} />
      <div className="absolute inset-0 -z-10 opacity-[0.025]"
        style={{ backgroundImage: "linear-gradient(0deg,white 1px,transparent 1px),linear-gradient(90deg,white 1px,transparent 1px)", backgroundSize: "64px 64px" }} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <SectionEyebrow color="indigo">Calendário · bancodeseries.com.br</SectionEyebrow>
          <p className="text-[12px] text-white/30 capitalize">{today}</p>
        </div>
        {/* View toggle */}
        <div className="flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1">
          {(["month", "week", "day"] as ViewMode[]).map((v) => (
            <button key={v} type="button" onClick={() => onChangeMode(v)}
              className={`text-[11px] font-bold px-3.5 py-1.5 rounded-xl transition-all duration-200 capitalize ${
                mode === v
                  ? "bg-indigo-500/20 text-indigo-200 border border-indigo-500/20"
                  : "text-white/30 hover:text-white/55"
              }`}>
              {v === "month" ? "Mês" : v === "week" ? "Semana" : "Dia"}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-4">
        <h1 className="text-5xl sm:text-6xl font-black tracking-[-0.05em] text-white/90 leading-none mb-2">Agenda</h1>
        <p className="text-[13px] text-white/35 leading-relaxed max-w-sm">
          {phase !== "done"
            ? PHASE_LABELS[phase]
            : filteredCount > 0
              ? `${filteredCount} séries · ${filteredEps.toLocaleString("pt-BR")} episódios nos próximos 30 dias`
              : "Calendário de episódios"}
        </p>
      </div>

      {/* Stats row */}
      {filteredCount > 0 && (
        <div className="flex items-center gap-4 flex-wrap mt-4">
          <div className="flex items-center gap-2">
            <span className="text-xl font-black text-white/80">{filteredCount}</span>
            <span className="text-[11px] text-white/30">séries</span>
          </div>
          <div className="h-3 w-px bg-white/10" />
          <div className="flex items-center gap-2">
            <span className="text-xl font-black text-cyan-300/80">{filteredEps.toLocaleString("pt-BR")}</span>
            <span className="text-[11px] text-white/30">episódios</span>
          </div>
          {phase === "enriching" && (
            <>
              <div className="h-3 w-px bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-indigo-400/60 animate-pulse" />
                <span className="text-[11px] text-white/25">Enriquecendo… {Math.round(enrichProgress)}%</span>
              </div>
            </>
          )}
          {phase === "done" && (
            <>
              <div className="h-3 w-px bg-white/10" />
              <div className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
                <span className="text-[11px] text-white/20 uppercase tracking-[0.15em] text-[9.5px] font-bold">Feed ICS ativo</span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ── Vista Mensal ───────────────────────────────────────────────────────────────

const WEEK_HEADERS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function MonthView({
  year, month, byDay, selectedDay, onSelectDay,
}: {
  year: number; month: number;
  byDay: Map<string, IcsSeriesGroup[]>;
  selectedDay: string; onSelectDay: (d: string) => void;
}) {
  const today = todayStr();
  const totalDays  = getDaysInMonth(year, month);
  const firstOff   = getFirstDayOfMonth(year, month);
  const prevMonthDays = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1);

  const cells: Array<{ dateStr: string; isCurrent: boolean }> = [];
  for (let i = firstOff - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const mo = month - 1 < 0 ? 11 : month - 1;
    const y  = month - 1 < 0 ? year - 1 : year;
    cells.push({ dateStr: `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, isCurrent: false });
  }
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ dateStr: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, isCurrent: true });
  }
  const rem = cells.length % 7;
  if (rem > 0) {
    const nextMo = month + 1 > 11 ? 0 : month + 1;
    const nextY  = month + 1 > 11 ? year + 1 : year;
    for (let d = 1; d <= 7 - rem; d++) {
      cells.push({ dateStr: `${nextY}-${String(nextMo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, isCurrent: false });
    }
  }

  return (
    <div>
      <div className="grid grid-cols-7 mb-1.5">
        {WEEK_HEADERS.map((h) => (
          <div key={h} className="text-center text-[11px] font-bold uppercase tracking-[0.14em] text-white/30 py-2.5">{h}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ dateStr, isCurrent }) => {
          const groups = byDay.get(dateStr) ?? [];
          const isToday = dateStr === today;
          const isSel   = dateStr === selectedDay;
          const dayNum  = parseInt(dateStr.split("-")[2], 10);
          const hasContent = groups.length > 0;

          const visible = groups.slice(0, 3);
          const extra   = groups.length - visible.length;

          const pillColor = (g: IcsSeriesGroup) => {
            const c = g.category;
            if (c === "CINEMATIC")       return "bg-violet-500/20 border-violet-500/20 text-violet-200/80";
            if (c === "ANIMATION")       return "bg-teal-500/20 border-teal-500/20 text-teal-200/80";
            if (c === "DOCUMENTARY")     return "bg-cyan-500/20 border-cyan-500/20 text-cyan-200/80";
            if (c === "REALITY_PREMIUM") return "bg-amber-500/20 border-amber-500/20 text-amber-200/80";
            return "bg-indigo-500/15 border-indigo-500/15 text-indigo-200/75";
          };

          return (
            <button key={dateStr} type="button" onClick={() => onSelectDay(dateStr)}
              className={[
                "relative min-h-[90px] sm:min-h-[110px] rounded-xl p-2 text-left transition-all duration-200 border group/cell",
                !isCurrent ? "opacity-20 border-white/[0.03] bg-transparent cursor-default" : "",
                isCurrent && !isToday && !isSel && !hasContent ? "border-white/[0.05] bg-transparent hover:bg-white/[0.02] hover:border-white/[0.08]" : "",
                isCurrent && !isToday && !isSel && hasContent  ? "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.13]" : "",
                isToday && !isSel ? "border-indigo-500/50 bg-indigo-500/[0.08] hover:bg-indigo-500/[0.12]" : "",
                isSel ? "border-indigo-400/70 bg-indigo-500/[0.16] ring-1 ring-indigo-500/30" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={[
                  "text-[13px] font-black leading-none",
                  isToday ? "text-indigo-300" : isCurrent ? "text-white/50" : "text-white/15",
                ].join(" ")}>
                  {dayNum}
                </span>
                {hasContent && (
                  <span className={`text-[9px] font-black tabular-nums ${isToday ? "text-indigo-400/80" : "text-white/20"}`}>
                    {groups.length}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-[3px]">
                {visible.map((g) => {
                  const poster = g.tmdb ? TMDB_IMG(g.tmdb.poster_path, "w92") : null;
                  const pc = pillColor(g);
                  return (
                    <div key={g.key} className={`flex items-center gap-1 rounded-[5px] px-1.5 py-[3px] border ${pc}`}>
                      {poster && (
                        <img src={poster} alt="" className="w-3.5 h-5 rounded-[2px] object-cover shrink-0 opacity-90" />
                      )}
                      <span className="text-[9px] font-bold truncate leading-tight">
                        {g.tmdb?.name ?? g.rawTitle}
                      </span>
                    </div>
                  );
                })}
                {extra > 0 && (
                  <span className="text-[9px] font-bold text-white/30 pl-1">+{extra} mais</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Vista Semanal ──────────────────────────────────────────────────────────────

function WeekView({
  weekStart, byDay, selectedDay, onSelectDay,
}: {
  weekStart: Date; byDay: Map<string, IcsSeriesGroup[]>;
  selectedDay: string; onSelectDay: (d: string) => void;
}) {
  const today = todayStr();
  const days  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return toLocalDateStr(d);
  });
  const DAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  return (
    <div className="space-y-2">
      {days.map((dateStr, i) => {
        const groups   = byDay.get(dateStr) ?? [];
        const isToday  = dateStr === today;
        const isSel    = dateStr === selectedDay;
        const dayNum   = parseInt(dateStr.split("-")[2], 10);

        return (
          <button key={dateStr} type="button" onClick={() => onSelectDay(dateStr)}
            className={[
              "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border transition-all duration-200 text-left",
              isSel ? "border-indigo-400/50 bg-indigo-500/[0.12]" :
              isToday ? "border-indigo-500/35 bg-indigo-500/[0.07] hover:bg-indigo-500/[0.10]" :
              groups.length > 0 ? "border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.05]" :
              "border-white/[0.04] bg-transparent hover:bg-white/[0.02]",
            ].join(" ")}
          >
            <div className="flex flex-col items-center justify-center w-[48px] shrink-0 gap-0.5">
              <span className={`text-[10px] font-bold uppercase tracking-[0.15em] leading-none ${isToday ? "text-indigo-400" : "text-white/25"}`}>
                {DAY_SHORT[i]}
              </span>
              <span className={`text-[22px] font-black tabular-nums leading-none ${isToday ? "text-indigo-200" : "text-white/55"}`}>
                {dayNum}
              </span>
            </div>

            <div className={`w-px self-stretch rounded-full ${isToday ? "bg-indigo-500/30" : "bg-white/[0.06]"}`} />

            {groups.length === 0 ? (
              <span className="text-[11px] text-white/15 flex-1 italic">Nenhuma série</span>
            ) : (
              <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                {groups.slice(0, 6).map((g) => {
                  const poster = g.tmdb ? TMDB_IMG(g.tmdb.poster_path, "w92") : null;
                  const c = g.category;
                  const pc =
                    c === "CINEMATIC"       ? "bg-violet-500/20 border-violet-500/20 text-violet-200/85" :
                    c === "ANIMATION"       ? "bg-teal-500/20 border-teal-500/20 text-teal-200/85" :
                    c === "DOCUMENTARY"     ? "bg-cyan-500/20 border-cyan-500/20 text-cyan-200/85" :
                    c === "REALITY_PREMIUM" ? "bg-amber-500/20 border-amber-500/20 text-amber-200/85" :
                    "bg-indigo-500/15 border-indigo-500/15 text-indigo-200/80";
                  return (
                    <div key={g.key} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border ${pc}`}>
                      {poster && (
                        <img src={poster} alt="" className="w-4 h-6 rounded-[3px] object-cover shrink-0 opacity-90" />
                      )}
                      <span className="text-[10px] font-bold max-w-[100px] truncate leading-tight">
                        {g.tmdb?.name ?? g.rawTitle}
                      </span>
                    </div>
                  );
                })}
                {groups.length > 6 && (
                  <span className="text-[10px] text-white/30 font-bold">+{groups.length - 6}</span>
                )}
              </div>
            )}

            {groups.length > 0 && (
              <span className="shrink-0 text-[13px] font-black text-white/20 tabular-nums">{groups.length}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Vista Diária ───────────────────────────────────────────────────────────────

function DayView({
  dateStr, groups,
}: {
  dateStr: string; groups: IcsSeriesGroup[];
}) {
  const router = useRouter();
  const label = formatDayFull(dateStr);

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] px-6 py-12 text-center">
        <p className="text-[13px] font-bold text-white/25 mb-1">Nenhuma série neste dia</p>
        <p className="text-[11px] text-white/15">{label}</p>
      </div>
    );
  }

  // Ordena grupos pelo horário do primeiro ep do dia
  const sortedGroups = [...groups].sort((a, b) => {
    const aEp = a.episodes.find((ep) => ep.startAt.slice(0, 10) === dateStr);
    const bEp = b.episodes.find((ep) => ep.startAt.slice(0, 10) === dateStr);
    if (!aEp) return 1;
    if (!bEp) return -1;
    return aEp.startAt.localeCompare(bEp.startAt);
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <SectionEyebrow color="indigo">Episódios do dia</SectionEyebrow>
          <h3 className="text-[16px] font-black tracking-[-0.03em] text-white/80 capitalize leading-tight">{label}</h3>
        </div>
        <span className="text-[11px] font-black text-white/20 border border-white/[0.08] rounded-full px-2.5 py-0.5">
          {sortedGroups.length} série{sortedGroups.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-2">
        {sortedGroups.map((g) => {
          // Episódios deste dia, ordenados por horário
          const eps = g.episodes
            .filter((ep) => ep.startAt.slice(0, 10) === dateStr)
            .sort((a, b) => a.startAt.localeCompare(b.startAt));
          const firstEpTime = eps[0]?.startAt;
          const showTime = firstEpTime && !firstEpTime.endsWith("T00:00:00.000Z");

          return (
            <div
              key={g.key}
              className="group relative rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:border-white/[0.10] transition-all duration-300 overflow-hidden cursor-pointer"
              onClick={() => g.tmdb?.tmdb_id && router.push(`/title/tv/${g.tmdb.tmdb_id}`)}
            >
              {g.tmdb?.backdrop_path && (
                <div className="absolute inset-0 opacity-[0.06]">
                  <img src={TMDB_IMG(g.tmdb.backdrop_path, "w780")!} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
                </div>
              )}
              <div className="relative flex items-start gap-4 p-4">
                <div className="relative w-[56px] h-[84px] rounded-xl overflow-hidden bg-white/[0.04] shrink-0 border border-white/[0.08]">
                  {g.tmdb?.poster_path ? (
                    <img src={TMDB_IMG(g.tmdb.poster_path, "w185")!} alt={g.tmdb.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-white/15">
                        <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${CAT_COLOR[g.category] ?? "bg-white/[0.05] text-white/30 border-white/[0.08]"}`}>
                      {CAT_LABEL[g.category] ?? g.category}
                    </span>
                    {showTime && (
                      <span className="text-[10px] font-bold text-white/30 border border-white/[0.07] rounded-full px-2 py-0.5">
                        {formatTime(firstEpTime)}
                      </span>
                    )}
                    {g.tmdb?.vote_average && g.tmdb.vote_average > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-300/80">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                        {g.tmdb.vote_average.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="text-[15px] font-black tracking-[-0.02em] text-white/90 leading-tight truncate mb-2">
                    {g.tmdb?.name ?? g.rawTitle}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {eps.map((ep) => (
                      <span key={ep.uid} className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white/[0.07] text-white/55 border border-white/[0.10]">
                        S{String(ep.season).padStart(2,"0")}E{String(ep.episode).padStart(2,"0")}
                        {ep.episodeName && ep.episodeName.toLowerCase() !== "tba"
                          ? ` · ${ep.episodeName.slice(0, 35)}`
                          : ""}
                      </span>
                    ))}
                  </div>
                </div>
                {eps.length > 1 && (
                  <div className="shrink-0 text-right">
                    <p className="text-[24px] font-black tabular-nums text-white/10 leading-none">{eps.length}</p>
                    <p className="text-[8px] text-white/15 uppercase tracking-wide">eps</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Period nav ─────────────────────────────────────────────────────────────────

function PeriodNav({ label, onPrev, onNext, onToday }: {
  label: string; onPrev: () => void; onNext: () => void; onToday: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-[20px] font-black tracking-[-0.03em] text-white/85 capitalize">{label}</h2>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToday}
          className="text-[11px] font-bold text-white/40 hover:text-white/65 border border-white/[0.09] rounded-xl px-3.5 py-1.5 transition-colors">
          Hoje
        </button>
        {(["prev", "next"] as const).map((dir) => (
          <button key={dir} type="button" onClick={dir === "prev" ? onPrev : onNext}
            aria-label={dir === "prev" ? "Anterior" : "Próximo"}
            className="w-9 h-9 rounded-xl border border-white/[0.09] bg-white/[0.03] flex items-center justify-center text-white/40 hover:text-white/75 hover:bg-white/[0.07] transition-all">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              {dir === "prev"
                ? <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
                : <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Day detail panel ───────────────────────────────────────────────────────────

function DayPanel({ dateStr, groups, onClose }: {
  dateStr: string; groups: IcsSeriesGroup[]; onClose: () => void;
}) {
  return (
    <div className="mt-8 rounded-[20px] border border-indigo-500/20 bg-indigo-950/10 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <SectionEyebrow color="indigo">Detalhe do dia</SectionEyebrow>
        <button type="button" onClick={onClose}
          className="text-[10px] font-bold text-white/25 hover:text-white/50 border border-white/[0.07] rounded-lg px-2.5 py-1 transition-colors">
          Fechar
        </button>
      </div>
      <DayView dateStr={dateStr} groups={groups} />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────



export default function AgendaClient({ initialData }: { initialData: IcsAgendaResponse | null }) {
  // ── Inicialização com dados do servidor ──────────────────────────────────────
  // Quando initialData existe (cache quente), inicializa o estado diretamente
  // nos useState — sem useEffect, sem fetch, sem loading state.
  const hydrate = (gs: IcsSeriesGroup[]): IcsSeriesGroup[] =>
    gs.map((g) => ({ ...g, episodes: g.episodes.map((ep) => ({ ...ep })) }));

  const [groups, setGroups]           = useState<IcsSeriesGroup[]>(() =>
    initialData ? hydrate(initialData.groups ?? []) : []
  );
  const [featuredGroups, setFeatured] = useState<IcsSeriesGroup[]>(() =>
    initialData ? hydrate(initialData.featuredGroups ?? []) : []
  );
  const [phase, setPhase]             = useState<Phase>(() => initialData ? "done" : "idle");
  const [error, setError]             = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState(0);

  const trendingDayRef  = useRef<Set<number>>(
    new Set(initialData?.trendingDay  ?? [])
  );
  const trendingWeekRef = useRef<Set<number>>(
    new Set(initialData?.trendingWeek ?? [])
  );

  const now = new Date();
  const [mode, setMode]                 = useState<ViewMode>("month");
  const [navYear, setNavYear]           = useState(now.getFullYear());
  const [navMonth, setNavMonth]         = useState(now.getMonth());
  const [navWeekStart, setNavWeekStart] = useState(() => startOfWeek(now));
  const [selectedDay, setSelectedDay]   = useState(todayStr());

  // Fallback: só executa se não tínhamos initialData (cache frio)
  useEffect(() => {
    if (initialData) return; // dados já estão no estado — nada a fazer

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

        const needsEnrich = hydratedFeatured.filter((g) => !g.tmdb);
        if (needsEnrich.length === 0) { setPhase("done"); return; }
        setPhase("enriching");
        const batches: IcsSeriesGroup[][] = [];
        for (let i = 0; i < needsEnrich.length; i += ENRICH_BATCH) {
          batches.push(needsEnrich.slice(i, i + ENRICH_BATCH));
        }
        let done = 0;
        for (const batch of batches) {
          if (cancelled) break;
          try {
            const titles = batch.map((g) => g.rawTitle);
            const enrichRes = await fetch("/api/ics/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ titles }),
            });
            if (enrichRes.ok) {
              const { results } = await enrichRes.json() as { results: Record<string, import("@/lib/ics-engine").TmdbEnrichment | null> };
              const td = trendingDayRef.current;
              const tw = trendingWeekRef.current;
              const apply = (prev: IcsSeriesGroup[]) =>
                prev
                  .map((g) => results[g.rawTitle] !== undefined && !g.tmdb
                    ? { ...g, tmdb: results[g.rawTitle] }
                    : g)
                  .filter((g) => filterEnrichedGroup(g, td, tw));
              setFeatured(apply);
              setGroups(apply);
            }
          } catch (e) { console.warn("[agenda] enrich batch error:", e); }
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

  // Só mostra grupos com poster + nome TMDB
  const visibleGroups   = useMemo(() => groups.filter(hasValidTmdb),        [groups]);
  const visibleFeatured = useMemo(() => featuredGroups.filter(hasValidTmdb), [featuredGroups]);

  const byDay = useMemo(() => buildDayMap(groups), [groups]);

  // Stats contadores filtrados
  const filteredCount = visibleFeatured.length;
  const filteredEps   = useMemo(
    () => visibleFeatured.reduce((acc, g) => acc + g.episodeCount, 0),
    [visibleFeatured],
  );

  const handlePrev = useCallback(() => {
    if (mode === "month") {
      setNavYear((y) => navMonth === 0 ? y - 1 : y);
      setNavMonth((m) => m === 0 ? 11 : m - 1);
    } else if (mode === "week") {
      setNavWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
    } else {
      setSelectedDay((s) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - 1); return toLocalDateStr(d); });
    }
  }, [mode, navMonth]);

  const handleNext = useCallback(() => {
    if (mode === "month") {
      setNavYear((y) => navMonth === 11 ? y + 1 : y);
      setNavMonth((m) => m === 11 ? 0 : m + 1);
    } else if (mode === "week") {
      setNavWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
    } else {
      setSelectedDay((s) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + 1); return toLocalDateStr(d); });
    }
  }, [mode, navMonth]);

  const handleToday = useCallback(() => {
    const t = new Date();
    setNavYear(t.getFullYear()); setNavMonth(t.getMonth());
    setNavWeekStart(startOfWeek(t)); setSelectedDay(todayStr());
  }, []);

  const periodLabel = useMemo(() => {
    if (mode === "month") return formatMonthYear(navYear, navMonth);
    if (mode === "week")  return `Semana de ${formatWeekRange(navWeekStart)}`;
    return formatDayFull(selectedDay);
  }, [mode, navYear, navMonth, navWeekStart, selectedDay]);

  const selectedDayGroups = byDay.get(selectedDay) ?? [];
  const showDayPanel = mode !== "day" && selectedDay !== "" && selectedDayGroups.length > 0;

  // Spotlight: destaques do dia+semana com prioridade para estreias/finais/trending
  const spotlightItems = useMemo(
    () => buildSpotlightItems(visibleFeatured, trendingDayRef.current, trendingWeekRef.current),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleFeatured],
  );

  const isLoading = phase !== "done" && phase !== "idle";

  return (
    <PageShell variant="wide">

      <AgendaHero
        phase={phase} mode={mode} onChangeMode={setMode}
        filteredCount={filteredCount} filteredEps={filteredEps}
        enrichProgress={enrichProgress}
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-950/20 px-5 py-4 text-[12px] text-red-300/80">
          Erro ao carregar feed: {error}
        </div>
      )}

      {/* Spotlight — substitui "Estreando hoje / Na agenda hoje" */}
      <SpotlightHero items={spotlightItems} isLoading={isLoading} />

      <SectionDivider />

      <section>
        <PeriodNav label={periodLabel} onPrev={handlePrev} onNext={handleNext} onToday={handleToday} />

        {isLoading && groups.length === 0 ? (
          mode === "month" ? (
            <div className="grid grid-cols-7 gap-[3px]">
              {Array.from({ length: 35 }).map((_, i) => (
                <div key={i} className="h-[68px] rounded-xl bg-white/[0.025] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-[72px] rounded-2xl bg-white/[0.03] animate-pulse" />
              ))}
            </div>
          )
        ) : (
          <>
            {mode === "month" && (
              <MonthView year={navYear} month={navMonth} byDay={byDay} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
            )}
            {mode === "week" && (
              <WeekView weekStart={navWeekStart} byDay={byDay} selectedDay={selectedDay} onSelectDay={setSelectedDay} />
            )}
            {mode === "day" && (
              <DayView dateStr={selectedDay} groups={selectedDayGroups} />
            )}
          </>
        )}

        {showDayPanel && (
          <DayPanel dateStr={selectedDay} groups={selectedDayGroups} onClose={() => setSelectedDay("")} />
        )}
      </section>

      {visibleFeatured.length > 0 && (
        <>
          <SectionDivider />
          <section className="mb-10">
            <div className="flex items-end justify-between mb-5">
              <div>
                <SectionEyebrow color="indigo">Próximos 30 dias</SectionEyebrow>
                <h2 className="text-xl font-black tracking-[-0.03em] text-white/90 leading-tight">Todas as séries</h2>
              </div>
              <span className="text-[11px] text-white/25 border border-white/10 rounded-full px-2.5 py-0.5">{visibleFeatured.length}</span>
            </div>
            {isLoading && visibleFeatured.length === 0 ? (
              <div className="space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-[72px] rounded-2xl bg-white/[0.03] animate-pulse" />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {visibleFeatured
                  .slice()
                  .sort((a, b) => CATEGORY_PRIORITY[a.category] - CATEGORY_PRIORITY[b.category])
                  .map((g) => (
                    <SeriesCard
                      key={g.key}
                      group={g}
                      href={`/title/tv/${g.tmdb!.tmdb_id}`}
                      compact
                    />
                  ))}
              </div>
            )}
          </section>
        </>
      )}

      <div className="mt-10 pt-6 border-t border-white/[0.05] flex items-center gap-2">
        <span className={`w-1.5 h-1.5 rounded-full ${phase === "done" ? "bg-emerald-400/60" : "bg-amber-400/60 animate-pulse"}`} />
        <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-white/15">
          Fonte: bancodeseries.com.br/ical.php · Cache 30 min · Enriquecimento TMDB por série
        </span>
      </div>

    </PageShell>
  );
}
