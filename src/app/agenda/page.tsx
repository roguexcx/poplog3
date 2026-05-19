"use client";

import { useCallback, useEffect, useRef, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/layout/PageShell";
import AgendaProviderSection from "@/features/agenda/AgendaProviderSection";
import AgendaNewEpisodeCard from "@/features/agenda/AgendaNewEpisodeCard";
import type { NewEpisodeItem } from "@/features/agenda/AgendaNewEpisodeCard";
import type {
  AgendaV2CompatResponse as AgendaResponse,
  LegacyAgendaMovie as AgendaMovie,
  LegacyAgendaTv as AgendaTv,
} from "@/server/agenda/types";
import type { UpcomingEpisodeItem } from "@/app/api/poplog3/continuity/upcoming-episodes/route";
import type { LeavingItem } from "@/app/api/poplog3/agenda/leaving-soon/route";

// ── Status filter ─────────────────────────────────────────────────────────────

const INACTIVE = new Set(["fridge", "abandoned"]);

function isActive(lib: Record<string, string>, key: string): boolean {
  const s = lib[key];
  return !!s && !INACTIVE.has(s);
}

// ── Language priority sort ────────────────────────────────────────────────────
// en > pt > outros — maior relevância regional para o Brasil

function sortByLang<T extends { original_language?: string; popularity: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const score = (l?: string) => (l === "en" ? 2 : l === "pt" ? 1 : 0);
    const diff = score(b.original_language) - score(a.original_language);
    return diff !== 0 ? diff : b.popularity - a.popularity;
  });
}

// ── Image helper ──────────────────────────────────────────────────────────────

const IMG = (path: string | null, size: string) =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

// ── Date helpers ──────────────────────────────────────────────────────────────

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function formatPtDate(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function formatPtShort(dateStr: string): string {
  if (!dateStr) return "";
  return new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", {
    weekday: "short", day: "2-digit", month: "short",
  });
}

function todayLong(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}

function countdownLabel(dateStr: string): { days: number; label: string } {
  const days = daysFromNow(dateStr);
  if (days <= 0) return { days: 0, label: "Hoje" };
  if (days === 1) return { days: 1, label: "Amanhã" };
  if (days < 7) return { days, label: `Em ${days} dias` };
  if (days < 30) return { days, label: `Em ${Math.floor(days / 7)} sem.` };
  return { days, label: `Em ${Math.floor(days / 30)} mes.` };
}

function weekDayLabel(airDate: string, daysUntil: number): { headline: string; sub: string; colorClass: string } {
  if (daysUntil <= 0) return { headline: "Vai ao ar hoje", sub: "Hoje", colorClass: "text-rose-400" };
  if (daysUntil === 1) return { headline: "Amanhã", sub: formatPtShort(airDate), colorClass: "text-amber-400" };
  const d = new Date(airDate + "T12:00:00");
  const weekday = d.toLocaleDateString("pt-BR", { weekday: "long" });
  const headline = weekday.charAt(0).toUpperCase() + weekday.slice(1);
  const sub = d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const colorClass = daysUntil <= 3 ? "text-indigo-400" : "text-cyan-400/80";
  return { headline, sub, colorClass };
}

// ── Design tokens ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  watching:  "bg-violet-500/80 text-violet-100 border-violet-400/30",
  watchlist: "bg-teal-600/60 text-teal-100 border-teal-400/20",
  watched:   "bg-white/10 text-white/50 border-white/10",
};

const STATUS_LABELS: Record<string, string> = {
  watching: "Assistindo",
  watchlist: "Watchlist",
  watched:  "Assistido",
};

// ── Primitives ────────────────────────────────────────────────────────────────

type EyebrowColor = "indigo" | "rose" | "amber" | "cyan" | "teal" | "violet" | "muted";

function SectionEyebrow({ children, color = "indigo" }: { children: React.ReactNode; color?: EyebrowColor }) {
  const line: Record<EyebrowColor, string> = {
    indigo: "bg-indigo-400/60", rose: "bg-rose-400/60", amber: "bg-amber-400/60",
    cyan: "bg-cyan-400/60", teal: "bg-teal-400/60", violet: "bg-violet-400/60", muted: "bg-white/20",
  };
  const text: Record<EyebrowColor, string> = {
    indigo: "text-indigo-400/80", rose: "text-rose-400/80", amber: "text-amber-400/80",
    cyan: "text-cyan-400/80", teal: "text-teal-400/80", violet: "text-violet-400/80", muted: "text-white/30",
  };
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${line[color]}`} />
      <p className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${text[color]}`}>{children}</p>
    </div>
  );
}

function SectionHeader({
  eyebrow, eyebrowColor = "indigo", title, count, action,
}: {
  eyebrow: string; eyebrowColor?: EyebrowColor; title: string; count?: number; action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <SectionEyebrow color={eyebrowColor}>{eyebrow}</SectionEyebrow>
        <h2 className="text-xl font-black tracking-[-0.03em] text-white/90 leading-tight">{title}</h2>
      </div>
      <div className="flex items-center gap-3 pb-0.5">
        {count !== undefined && (
          <span className="text-[11px] text-white/25 border border-white/10 rounded-full px-2.5 py-0.5">{count}</span>
        )}
        {action}
      </div>
    </div>
  );
}

function SectionDivider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent my-10" />;
}

function UserStatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_COLORS[status] ?? "bg-white/5 text-white/30 border-white/8"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── TimelineLabel ─────────────────────────────────────────────────────────────

type TimelineColor = "now" | "today" | "week" | "soon" | "urgent" | "muted";

function TimelineLabel({ label, color = "muted" }: { label: string; color?: TimelineColor }) {
  const dot: Record<TimelineColor, string> = {
    now:    "bg-rose-400 shadow-[0_0_8px_2px_rgba(251,113,133,0.5)]",
    today:  "bg-amber-400 shadow-[0_0_8px_2px_rgba(251,191,36,0.4)]",
    week:   "bg-indigo-400 shadow-[0_0_6px_1px_rgba(129,140,248,0.4)]",
    soon:   "bg-cyan-400 shadow-[0_0_6px_1px_rgba(34,211,238,0.35)]",
    urgent: "bg-red-500 shadow-[0_0_10px_3px_rgba(239,68,68,0.5)]",
    muted:  "bg-white/30",
  };
  const text: Record<TimelineColor, string> = {
    now: "text-rose-400/80", today: "text-amber-400/80",
    week: "text-indigo-400/70", soon: "text-cyan-400/70",
    urgent: "text-red-400/90", muted: "text-white/25",
  };
  return (
    <div className="flex items-center gap-3 mb-7">
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot[color]}`} />
      <p className={`text-[9px] font-black uppercase tracking-[0.3em] ${text[color]}`}>{label}</p>
      <div className="flex-1 h-px bg-gradient-to-r from-white/[0.08] to-transparent" />
    </div>
  );
}

// ── ScrollRail ────────────────────────────────────────────────────────────────
// Carrossel horizontal com arrows, fade nas bordas e scroll suave

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
      {/* Left fade */}
      <div
        className="absolute left-0 top-0 bottom-3 w-14 pointer-events-none z-10 transition-opacity duration-200"
        style={{ opacity: canLeft ? 1 : 0, background: "linear-gradient(to right, #09090b 25%, transparent)" }}
      />
      {/* Left arrow */}
      {canLeft && (
        <button
          type="button"
          onClick={() => nudge(-1)}
          aria-label="Anterior"
          className="absolute left-2 top-1/2 -translate-y-[calc(50%+6px)] z-20 w-8 h-8 rounded-full border border-white/[0.12] bg-zinc-900/95 flex items-center justify-center text-white/60 hover:text-white hover:bg-zinc-800 transition-all duration-200 opacity-0 group-hover/rail:opacity-100 shadow-lg"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}

      {/* Scroll container */}
      <div
        ref={railRef}
        className="flex gap-3.5 overflow-x-auto px-4 sm:px-6 md:px-8 lg:px-0 pb-3 no-scrollbar [&>*]:shrink-0"
      >
        {children}
      </div>

      {/* Right fade */}
      <div
        className="absolute right-0 top-0 bottom-3 w-14 pointer-events-none z-10 transition-opacity duration-200"
        style={{ opacity: canRight ? 1 : 0, background: "linear-gradient(to left, #09090b 25%, transparent)" }}
      />
      {/* Right arrow */}
      {canRight && (
        <button
          type="button"
          onClick={() => nudge(1)}
          aria-label="Próximo"
          className="absolute right-2 top-1/2 -translate-y-[calc(50%+6px)] z-20 w-8 h-8 rounded-full border border-white/[0.12] bg-zinc-900/95 flex items-center justify-center text-white/60 hover:text-white hover:bg-zinc-800 transition-all duration-200 opacity-0 group-hover/rail:opacity-100 shadow-lg"
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── MovieCard ─────────────────────────────────────────────────────────────────

function MovieCard({
  item, userStatus, onClick,
}: {
  item: AgendaMovie; userStatus?: string | null; onClick: () => void;
}) {
  const days = item.release_date ? daysFromNow(item.release_date) : null;
  const isToday = days !== null && days <= 0;
  const isSoon  = days !== null && days > 0 && days <= 7;

  return (
    <button type="button" onClick={onClick} className="group relative w-[148px] sm:w-[160px] text-left">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/[0.07] mb-2.5 bg-white/[0.04]">
        {IMG(item.poster_path, "w342") && (
          <img src={IMG(item.poster_path, "w342")!} alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
          {isToday ? (
            <span className="text-[8.5px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md bg-rose-500/90 text-white border border-rose-400/30">Hoje</span>
          ) : isSoon ? (
            <span className="text-[8.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-amber-500/80 text-amber-100 border border-amber-400/30">
              {countdownLabel(item.release_date).label}
            </span>
          ) : null}
          {item.vote_average > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-300 ml-auto">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {item.vote_average.toFixed(1)}
            </span>
          )}
        </div>
        {userStatus && (
          <div className="absolute bottom-2 left-2">
            <UserStatusBadge status={userStatus} />
          </div>
        )}
      </div>
      <div className="px-0.5">
        <p className="text-[12.5px] font-bold text-white/85 leading-tight tracking-[-0.02em] line-clamp-1 mb-1">{item.title}</p>
        <p className="text-[10px] text-white/35">
          {item.release_date ? formatPtDate(item.release_date) : "Data a confirmar"}
        </p>
      </div>
    </button>
  );
}

// ── TvCard ────────────────────────────────────────────────────────────────────

function TvCard({
  item, userStatus, isNew = false, onClick,
}: {
  item: AgendaTv; userStatus?: string | null; isNew?: boolean; onClick: () => void;
}) {
  const recentCutoff = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const freshPremiere = isNew || item.first_air_date >= recentCutoff;

  return (
    <button type="button" onClick={onClick} className="group relative w-[148px] sm:w-[160px] text-left">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/[0.07] mb-2.5 bg-white/[0.04]">
        {IMG(item.poster_path, "w342") && (
          <img src={IMG(item.poster_path, "w342")!} alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" loading="lazy" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
          {freshPremiere ? (
            <span className="text-[8.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-emerald-500/80 text-emerald-100 border border-emerald-400/30">
              Nova série
            </span>
          ) : (
            <span className="text-[8.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-indigo-500/80 text-indigo-100 border border-indigo-400/30">
              No ar
            </span>
          )}
          {item.vote_average > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-300">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {item.vote_average.toFixed(1)}
            </span>
          )}
        </div>
        {userStatus && (
          <div className="absolute bottom-2 left-2">
            <UserStatusBadge status={userStatus} />
          </div>
        )}
      </div>
      <div className="px-0.5">
        <p className="text-[12.5px] font-bold text-white/85 leading-tight tracking-[-0.02em] line-clamp-1 mb-1">{item.title}</p>
        <p className="text-[10px] text-white/35">
          {freshPremiere && item.first_air_date ? `Estreou ${formatPtDate(item.first_air_date)}` : "No ar agora"}
        </p>
      </div>
    </button>
  );
}

// ── EventRow ──────────────────────────────────────────────────────────────────

function EventRow({
  item, type, userStatus, episodeTag, onClick,
}: {
  item: AgendaMovie | AgendaTv; type: "movie" | "tv"; userStatus?: string | null;
  episodeTag?: string; onClick: () => void;
}) {
  const poster   = IMG(item.poster_path, "w185");
  const backdrop = IMG(item.backdrop_path, "w780");

  return (
    <button type="button" onClick={onClick}
      className="group relative w-full text-left rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.045] hover:border-white/[0.10] transition-all duration-300 overflow-hidden"
    >
      {backdrop && (
        <div className="absolute inset-0 opacity-[0.07]">
          <img src={backdrop} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
        </div>
      )}
      <div className="relative flex items-center gap-3.5 p-3">
        <div className="relative flex-shrink-0 w-[52px] h-[78px] rounded-lg overflow-hidden bg-white/[0.04]">
          {poster && (
            <img src={poster} alt={item.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" loading="lazy" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            {type === "tv" ? (
              <span className="text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300/80 border border-rose-500/20">
                Novo ep.
              </span>
            ) : (
              <span className="text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300/80 border border-cyan-500/20">
                Cinema
              </span>
            )}
            {episodeTag && (
              <span className="text-[8px] font-black px-2 py-0.5 rounded-full bg-white/[0.07] text-white/55 border border-white/[0.12]">
                {episodeTag}
              </span>
            )}
            {userStatus && <UserStatusBadge status={userStatus} />}
          </div>
          <h4 className="text-[14px] font-black tracking-[-0.02em] text-white/90 leading-tight line-clamp-1 mb-0.5">
            {item.title}
          </h4>
          {"first_air_date" in item && item.first_air_date && (
            <p className="text-[11px] text-white/35">
              {episodeTag ? "Episódio · Hoje" : `Desde ${formatPtDate(item.first_air_date)}`}
            </p>
          )}
          {"release_date" in item && item.release_date && (
            <p className="text-[11px] text-white/35">{formatPtDate(item.release_date)}</p>
          )}
        </div>
        {item.vote_average > 0 && (
          <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400/80">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-[11px] font-bold text-amber-300/80">{item.vote_average.toFixed(1)}</span>
          </div>
        )}
      </div>
    </button>
  );
}

// ── WeekEpisodeCard ───────────────────────────────────────────────────────────
// Card para "Esta Semana" — episódios de series que estou assistindo, próximos 7 dias
// Exibe claramente: T2E5 · Quinta-feira, data, nome do episódio

function WeekEpisodeCard({ item, onClick }: { item: UpcomingEpisodeItem; onClick: () => void }) {
  const poster   = IMG(item.poster_path, "w92");
  const backdrop = IMG(item.backdrop_path, "w780");
  const tag      = `T${item.next_season}E${item.next_episode}`;
  const { headline, sub, colorClass } = weekDayLabel(item.next_episode_air_date, item.days_until);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full text-left rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.13] transition-all duration-300 overflow-hidden"
    >
      {backdrop && (
        <div className="absolute inset-0 opacity-[0.07]">
          <img src={backdrop} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 to-transparent" />
        </div>
      )}
      <div className="relative flex items-center gap-3.5 p-3.5">
        {/* Poster com tag de episódio */}
        {poster && (
          <div className="relative flex-shrink-0 w-[48px] h-[72px] rounded-lg overflow-hidden bg-white/[0.04] border border-white/[0.08]">
            <img src={poster} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
            <div className="absolute inset-x-0 bottom-0 flex justify-center pb-1">
              <span className="rounded-full bg-black/80 px-1.5 py-0.5 text-[8px] font-black text-white/90 backdrop-blur-sm">
                {tag}
              </span>
            </div>
          </div>
        )}

        {/* Conteúdo central */}
        <div className="flex-1 min-w-0">
          {/* Tag + dia da semana */}
          <div className="flex items-center gap-1.5 mb-1.5">
            <span className={`text-[9.5px] font-black tracking-[0.06em] ${colorClass}`}>{tag}</span>
            <span className="text-white/15 text-[10px]">·</span>
            <span className={`text-[9.5px] font-semibold ${colorClass}`}>{headline}</span>
            <span className="ml-auto text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300/70 border border-violet-500/15">
              Assistindo
            </span>
          </div>

          {/* Título */}
          <p className="text-[13.5px] font-black tracking-[-0.02em] text-white/90 leading-tight line-clamp-1 mb-0.5">
            {item.title}
          </p>

          {/* Nome do episódio */}
          {item.next_episode_name && (
            <p className="text-[11px] text-white/35 line-clamp-1">
              &ldquo;{item.next_episode_name}&rdquo;
            </p>
          )}

          {/* Data */}
          <p className="text-[10px] text-white/25 mt-0.5">{formatPtDate(item.next_episode_air_date)}</p>
        </div>

        {/* Countdown lateral */}
        <div className="flex-shrink-0 text-right pl-1 min-w-[36px]">
          <p className={`text-[18px] font-black tabular-nums leading-none ${colorClass}`}>{item.days_until}</p>
          <p className="text-[8px] text-white/20 uppercase tracking-wide">dias</p>
          <p className={`text-[8.5px] mt-1 font-semibold opacity-70 ${colorClass}`}>{sub}</p>
        </div>
      </div>
    </button>
  );
}

// ── UpcomingEpisodeRow ────────────────────────────────────────────────────────

function UpcomingEpisodeRow({ item, onClick }: { item: UpcomingEpisodeItem; onClick: () => void }) {
  const poster   = IMG(item.poster_path, "w92");
  const backdrop = IMG(item.backdrop_path, "w780");
  const tag = `T${item.next_season}E${item.next_episode}`;

  const dayLabel =
    item.days_until === 1 ? "Amanhã" :
    item.days_until < 7   ? `Em ${item.days_until} dias` :
    item.days_until < 30  ? `Em ${Math.floor(item.days_until / 7)} sem.` :
                            `Em ${Math.floor(item.days_until / 30)} mes.`;

  const urgencyColor =
    item.days_until <= 7  ? "text-amber-400/80" :
    item.days_until <= 30 ? "text-indigo-400/70" : "text-cyan-400/70";

  return (
    <button type="button" onClick={onClick}
      className="group relative w-full text-left rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.045] hover:border-white/[0.10] transition-all duration-300 overflow-hidden"
    >
      {backdrop && (
        <div className="absolute inset-0 opacity-[0.06]">
          <img src={backdrop} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
        </div>
      )}
      <div className="relative flex items-center gap-3.5 p-3">
        {poster && (
          <div className="relative flex-shrink-0 w-[44px] h-[66px] rounded-lg overflow-hidden bg-white/[0.04]">
            <img src={poster} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
            <div className="absolute inset-x-0 bottom-0 flex justify-center pb-1">
              <span className="rounded-full bg-black/75 px-1 py-0.5 text-[8px] font-black text-white/90 backdrop-blur-sm">{tag}</span>
            </div>
          </div>
        )}
        <div className="flex-1 min-w-0">
          <p className="text-[13.5px] font-black tracking-[-0.02em] text-white/90 leading-tight line-clamp-1 mb-0.5">
            {item.title}
          </p>
          {item.next_episode_name && (
            <p className="text-[11px] text-white/40 line-clamp-1 mb-1">&ldquo;{item.next_episode_name}&rdquo;</p>
          )}
          <p className="text-[10.5px] text-white/30">{formatPtShort(item.next_episode_air_date)}</p>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className={`text-[16px] font-black tabular-nums leading-none ${urgencyColor}`}>{item.days_until}</p>
          <p className="text-[8px] text-white/25 uppercase tracking-wide mb-0.5">dias</p>
          <p className={`text-[9.5px] font-semibold ${urgencyColor}`}>{dayLabel}</p>
        </div>
      </div>
    </button>
  );
}

// ── RotatingCountdown ─────────────────────────────────────────────────────────

function RotatingCountdown({
  items,
  ctaLabel = "Countdown",
  onNavigate,
}: {
  items: AgendaMovie[];
  ctaLabel?: string;
  onNavigate: (item: AgendaMovie) => void;
}) {
  const [idx, setIdx] = useState(0);
  const [fading, setFading] = useState(false);

  const goTo = useCallback(
    (next: number) => {
      if (next === idx || fading) return;
      setFading(true);
      setTimeout(() => { setIdx(next); setFading(false); }, 280);
    },
    [idx, fading],
  );

  useEffect(() => {
    if (items.length <= 1) return;
    const id = setInterval(() => {
      setFading(true);
      setTimeout(() => { setIdx((i) => (i + 1) % items.length); setFading(false); }, 280);
    }, 7000);
    return () => clearInterval(id);
  }, [items.length]);

  if (!items.length) return null;

  const item = items[idx];
  const { days, label } = countdownLabel(item.release_date);
  const backdrop = IMG(item.backdrop_path, "w1280");
  const poster   = IMG(item.poster_path, "w342");

  return (
    <div>
      <button
        type="button"
        onClick={() => onNavigate(item)}
        style={{ transition: "opacity 0.28s ease" }}
        className={`group relative w-full text-left rounded-[20px] overflow-hidden border border-white/[0.07] min-h-[280px] sm:min-h-[320px] ${fading ? "opacity-0" : "opacity-100"}`}
      >
        {backdrop ? (
          <div className="absolute inset-0">
            <img src={backdrop} alt=""
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.025]" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-black/30" />
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
          </div>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-black to-black" />
        )}

        <div className="relative flex items-center gap-6 p-6 sm:p-8">
          {poster && (
            <div className="relative flex-shrink-0 w-[100px] sm:w-[120px] aspect-[2/3] rounded-xl overflow-hidden border border-white/10 shadow-2xl">
              <img src={poster} alt={item.title} className="h-full w-full object-cover" />
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[9px] font-black uppercase tracking-[0.25em] text-rose-400/90 border border-rose-500/30 bg-rose-950/40 rounded-full px-2.5 py-1">
                {ctaLabel}
              </span>
              <span className="text-[9px] font-bold text-white/25 uppercase tracking-wide">Filme</span>
            </div>
            <h3 className="text-2xl sm:text-3xl font-black tracking-[-0.04em] text-white/95 leading-tight mb-2 line-clamp-2">
              {item.title}
            </h3>
            {item.overview && (
              <p className="text-[12px] text-white/40 line-clamp-2 mb-4 leading-relaxed max-w-lg">{item.overview}</p>
            )}
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5">
              <div className="text-center">
                <p className="text-2xl sm:text-3xl font-black text-white/90 leading-none tracking-tight tabular-nums">{days}</p>
                <p className="text-[9px] text-white/30 uppercase tracking-[0.15em] mt-0.5">dias</p>
              </div>
              <div className="h-8 w-px bg-white/10" />
              <div>
                <p className="text-[13px] font-bold text-white/70">{label}</p>
                <p className="text-[11px] text-white/35">{formatPtDate(item.release_date)}</p>
              </div>
            </div>
          </div>
        </div>

        {items.length > 1 && (
          <div className="absolute bottom-4 right-6 flex items-center gap-1.5">
            <span className="text-[9px] text-white/25 tabular-nums">{idx + 1}/{items.length}</span>
          </div>
        )}
      </button>

      {items.length > 1 && (
        <div className="flex items-center justify-center gap-2 mt-4">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              style={{ transition: "all 0.3s ease" }}
              className={`rounded-full ${
                i === idx ? "w-5 h-1.5 bg-white/60" : "w-1.5 h-1.5 bg-white/20 hover:bg-white/40"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── LeavingCard ───────────────────────────────────────────────────────────────
// Urgência temporal máxima — última chance antes de sair da plataforma

function LeavingCard({ item, onClick }: { item: LeavingItem; onClick: () => void }) {
  const poster    = item.poster_url ?? null;
  const isUrgent  = item.days_left <= 3;
  const isSoon    = item.days_left <= 7;

  const border    = isUrgent ? "border-red-500/50" : isSoon ? "border-orange-500/30" : "border-white/[0.07]";
  const bg        = isUrgent ? "bg-red-950/20"     : isSoon ? "bg-orange-950/10"     : "bg-white/[0.02]";
  const dayColor  = isUrgent ? "text-red-400"      : isSoon ? "text-orange-400"      : "text-white/50";

  const badgeText = item.days_left <= 0  ? "Último dia"
                  : item.days_left <= 3  ? "Última chance"
                  : item.days_left <= 7  ? "Saindo em breve"
                  : formatPtDate(item.leaving_date);

  const badgeCls  = isUrgent
    ? "bg-red-500/90 text-white"
    : isSoon
    ? "bg-orange-500/20 text-orange-300/90 border border-orange-500/30"
    : "bg-white/[0.06] text-white/40 border border-white/10";

  return (
    <button
      type="button"
      onClick={onClick}
      className={`group relative flex items-center gap-3.5 rounded-2xl border ${border} ${bg} hover:brightness-110 transition-all duration-300 p-3.5 text-left w-full overflow-hidden`}
    >
      {/* Glow vermelho nos urgentes */}
      {isUrgent && <div className="absolute inset-0 bg-red-500/[0.06] pointer-events-none" />}

      {/* Poster */}
      {poster && (
        <div className="relative flex-shrink-0 w-[46px] h-[68px] rounded-xl overflow-hidden border border-white/[0.08]">
          <img src={poster} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
        </div>
      )}

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className={`text-[8px] font-black uppercase tracking-[0.12em] px-2 py-0.5 rounded-full ${badgeCls}`}>
            {badgeText}
          </span>
        </div>
        <p className="text-[13px] font-black text-white/90 leading-tight line-clamp-1 tracking-[-0.02em] mb-1.5">
          {item.title}
        </p>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-[9px] font-semibold text-white/40 px-2 py-0.5 rounded-lg bg-white/[0.05] border border-white/[0.07]">
            {item.platform_name}
          </span>
          <span className="text-[9px] text-white/20">·</span>
          <span className="text-[9px] text-white/25">{formatPtDate(item.leaving_date)}</span>
        </div>
      </div>

      {/* Contador de urgência */}
      <div className="flex-shrink-0 text-right pl-1">
        <p className={`text-[24px] font-black tabular-nums leading-none ${dayColor}`}>{item.days_left}</p>
        <p className="text-[8px] text-white/25 uppercase tracking-wide">dias</p>
      </div>
    </button>
  );
}

// ── AgendaHero ────────────────────────────────────────────────────────────────

function AgendaHero({
  mode, onToggle, stats, hasPersonalContent,
}: {
  mode: "geral" | "minha";
  onToggle: (m: "geral" | "minha") => void;
  stats: { movies: number; series: number; upcoming: number };
  hasPersonalContent: boolean;
}) {
  return (
    <div className="relative isolate rounded-[24px] overflow-hidden mb-10 min-h-[260px] sm:min-h-[300px] flex flex-col justify-between p-6 sm:p-8 border border-white/[0.06]">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-950/80 via-black to-black" />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 20% 0%, rgba(99,102,241,0.15) 0%, transparent 60%)" }} />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 90% 100%, rgba(6,182,212,0.08) 0%, transparent 50%)" }} />
      <div className="absolute inset-0 -z-10 opacity-[0.025]"
        style={{ backgroundImage: "linear-gradient(0deg,white 1px,transparent 1px),linear-gradient(90deg,white 1px,transparent 1px)", backgroundSize: "64px 64px" }} />

      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[0.25em] text-indigo-400/70 mb-1.5">Calendário do entretenimento</p>
          <p className="text-[12px] text-white/35 capitalize">{todayLong()}</p>
        </div>
        <div className="flex-shrink-0 flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1">
          <button type="button" onClick={() => onToggle("geral")}
            className={`text-[11px] font-bold px-3.5 py-1.5 rounded-xl transition-all duration-200 ${
              mode === "geral" ? "bg-white/[0.09] text-white/85 shadow-inner" : "text-white/30 hover:text-white/55"
            }`}
          >
            Geral
          </button>
          <button type="button" onClick={() => onToggle("minha")}
            className={`text-[11px] font-bold px-3.5 py-1.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 ${
              mode === "minha"
                ? "bg-indigo-500/20 text-indigo-200 shadow-inner border border-indigo-500/20"
                : "text-white/30 hover:text-white/55"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full transition-colors ${hasPersonalContent ? "bg-indigo-400" : "bg-white/20"}`} />
            Minha Agenda
          </button>
        </div>
      </div>

      <div>
        <h1 className="text-5xl sm:text-6xl font-black tracking-[-0.05em] text-white/90 leading-none mb-2">Agenda</h1>
        <p className="text-[13px] text-white/35 max-w-sm leading-relaxed">
          {mode === "minha"
            ? "Novos episódios, próximos lançamentos e eventos da sua biblioteca."
            : "O que estreia, o que volta e o que chega nos próximos dias."}
        </p>
      </div>

      <div className="flex items-center gap-4 flex-wrap mt-4">
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-white/80">{stats.movies}</span>
          <span className="text-[11px] text-white/30">em cartaz</span>
        </div>
        <div className="h-3 w-px bg-white/10" />
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-white/80">{stats.series}</span>
          <span className="text-[11px] text-white/30">séries no ar</span>
        </div>
        <div className="h-3 w-px bg-white/10" />
        <div className="flex items-center gap-2">
          <span className="text-xl font-black text-cyan-300/80">{stats.upcoming}</span>
          <span className="text-[11px] text-white/30">estreias em breve</span>
        </div>
      </div>
    </div>
  );
}

// ── EmptyPersonal ─────────────────────────────────────────────────────────────

function EmptyPersonal({ onSwitch }: { onSwitch: () => void }) {
  return (
    <div className="rounded-[24px] border border-white/[0.06] bg-white/[0.02] px-8 py-16 text-center">
      <div className="w-12 h-12 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center justify-center mx-auto mb-5">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/25">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      </div>
      <h3 className="text-[17px] font-black tracking-tight text-white/50 mb-2">Nenhum conteúdo na agenda</h3>
      <p className="text-[12px] text-white/25 max-w-xs mx-auto leading-relaxed mb-5">
        Adicione filmes e séries à sua biblioteca para ver novos episódios, countdowns e estreias personalizados.
      </p>
      <button type="button" onClick={onSwitch}
        className="text-[12px] font-bold text-indigo-400/80 border border-indigo-500/20 bg-indigo-950/30 hover:bg-indigo-950/50 rounded-xl px-4 py-2 transition-colors"
      >
        Ver Agenda Geral
      </button>
    </div>
  );
}

// ── LoadingSkeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <PageShell variant="wide">
      <div className="space-y-6">
        <div className="h-[280px] rounded-[24px] bg-white/[0.03] animate-pulse" />
        <div className="h-[36px] w-[180px] rounded-xl bg-white/[0.03] animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-[96px] rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
        <div className="h-px bg-white/[0.06]" />
        <div className="flex gap-3.5 overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-[148px] h-[240px] rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AgendaPage() {
  const router = useRouter();

  const [agendaData, setAgendaData]   = useState<AgendaResponse | null>(null);
  const [newEpisodes, setNewEpisodes] = useState<NewEpisodeItem[]>([]);
  const [upcomingEps, setUpcomingEps] = useState<UpcomingEpisodeItem[]>([]);
  const [leavingSoon, setLeavingSoon] = useState<LeavingItem[]>([]);
  const [isLoading, setIsLoading]     = useState(true);
  const [mode, setMode]               = useState<"geral" | "minha">("minha");

  useEffect(() => {
    fetch("/api/poplog3/agenda/v2")
      .then((r) => r.json() as Promise<AgendaResponse>)
      .then((agenda) => {
        setAgendaData(agenda);
        setNewEpisodes(agenda.newEpisodes ?? []);
        setUpcomingEps(agenda.upcomingEpisodes ?? []);
        setLeavingSoon(agenda.leavingSoonItems ?? []);

        const hasLib = Object.keys(agenda?.userLibraryIds ?? {}).length > 0;
        const hasEps =
          (agenda.newEpisodes ?? []).length > 0 ||
          (agenda.upcomingEpisodes ?? []).length > 0;
        if (!hasLib && !hasEps) setMode("geral");
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  // ── Derived state: tudo em um único useMemo para dedup global por aba ────────
  const {
    // Agenda Geral
    nowPlaying, upcoming, airingToday, onTheAirDeduped, newSeries, soonToReturn,
    countdownItems, leavingSoonFiltered,
    // Minha Agenda
    myNowPlaying, myUpcoming, myAiringTodayOnly,
    todayNewEpisodes, recentNewEpisodes, thisWeekEps, laterEps,
    // Cross-section
    newEpTagMap, stats,
  } = useMemo(() => {
    if (!agendaData) {
      const empty = {
        nowPlaying: [], upcoming: [], airingToday: [], onTheAirDeduped: [], newSeries: [],
        soonToReturn: [],
        countdownItems: [], leavingSoonFiltered: [],
        myNowPlaying: [], myUpcoming: [], myAiringTodayOnly: [],
        todayNewEpisodes: [], recentNewEpisodes: [], thisWeekEps: [], laterEps: [],
        newEpTagMap: new Map<number, string>(),
        stats: { movies: 0, series: 0, upcoming: 0 },
      };
      return empty;
    }

    const lib   = agendaData.userLibraryIds ?? {};
    const today = todayStr();

    // ── Base arrays (sorted by popularity) ──────────────────────────────────
    const nowPlaying    = [...agendaData.nowPlaying].sort((a, b) => b.popularity - a.popularity);
    const upcoming      = [...agendaData.upcoming].sort((a, b) => b.popularity - a.popularity);
    const airingToday   = [...agendaData.airingToday].sort((a, b) => b.popularity - a.popularity);
    const onTheAir      = [...agendaData.onTheAir].sort((a, b) => b.popularity - a.popularity);
    // newSeries: prioriza idiomas en/pt antes do restante
    const newSeriesSorted = sortByLang([...(agendaData.newSeries ?? [])]);
    // soonToReturn: séries com air_date entre +8 dias e 3 meses, também lang-sorted
    const soonToReturnSorted = sortByLang([...(agendaData.soonToReturn ?? [])]);
    // ── Agenda Geral — dedup global por seção (ordem de prioridade) ──────────
    const geralTvSeen    = new Set<number>();
    const geralMovieSeen = new Set<number>();

    // 1. Hoje (airingToday)
    airingToday.forEach((t) => geralTvSeen.add(t.id));

    // 2. Esta semana (onTheAir, deduplica Hoje)
    const onTheAirDeduped = onTheAir.filter((t) => !geralTvSeen.has(t.id));
    onTheAirDeduped.forEach((t) => geralTvSeen.add(t.id));

    // 3. Estreias recentes (newSeries, lang-sorted, deduplica acima)
    const newSeries = newSeriesSorted.filter((t) => !geralTvSeen.has(t.id));
    newSeries.forEach((t) => geralTvSeen.add(t.id));

    // 4. Retornando em breve (+8 dias a 3 meses, deduplica tudo acima)
    const soonToReturn = soonToReturnSorted.filter((t) => !geralTvSeen.has(t.id));
    soonToReturn.forEach((t) => geralTvSeen.add(t.id));

    // 5. Em Cartaz (nowPlaying)
    nowPlaying.forEach((m) => geralMovieSeen.add(m.id));

    // 6. Saindo dos Streamings
    leavingSoon.forEach((item) => {
      if (item.media_type === "movie") geralMovieSeen.add(item.id);
      else geralTvSeen.add(item.id);
    });
    const leavingSoonFiltered = leavingSoon;

    // 7. Mais Aguardados (top 5 filmes futuros)
    const futureMovies   = upcoming.filter((m) => m.release_date && m.release_date > today);
    const countdownItems = futureMovies.slice(0, 5);
    countdownItems.forEach((m) => geralMovieSeen.add(m.id));

    // 8. Próximas Estreias — remove overlap com countdown
    const upcoming_deduped = upcoming.filter((m) => !geralMovieSeen.has(m.id));

    // ── Minha Agenda — dedup personalizado ──────────────────────────────────
    const myNowPlaying = nowPlaying.filter((m) => isActive(lib, `movie-${m.id}`));
    const myUpcoming   = futureMovies.filter((m) => isActive(lib, `movie-${m.id}`));
    const myAiringAll  = airingToday.filter((t) => isActive(lib, `tv-${t.id}`));

    // Episódios disponíveis (continuity)
    const todayNewEpisodes  = newEpisodes.filter((ep) =>
      ep.days_since_new_episode === 0 || ep.days_since_new_episode === null,
    );
    const recentNewEpisodes = newEpisodes.filter((ep) =>
      ep.days_since_new_episode !== null && ep.days_since_new_episode > 0,
    );

    // Episódios futuros: Esta Semana (watching ≤7 dias) e Vem Aí (>7 dias)
    const thisWeekAll = upcomingEps.filter((e) => e.status === "watching" && e.days_until <= 7);
    const laterAll    = upcomingEps.filter((e) => e.days_until > 7);

    // Minha Agenda dedup em cascata
    const minhaTvSeen = new Set<number>(todayNewEpisodes.map((ep) => ep.tmdb_id));

    const myAiringTodayOnly = myAiringAll.filter((t) => !minhaTvSeen.has(t.id));
    myAiringTodayOnly.forEach((t) => minhaTvSeen.add(t.id));

    const recentNewEpsDeduped = recentNewEpisodes.filter((ep) => !minhaTvSeen.has(ep.tmdb_id));
    recentNewEpisodes.forEach((ep) => minhaTvSeen.add(ep.tmdb_id));

    const thisWeekEps = thisWeekAll.filter((e) => !minhaTvSeen.has(e.tmdb_id));
    thisWeekEps.forEach((e) => minhaTvSeen.add(e.tmdb_id));

    const laterEps = laterAll.filter((e) => !minhaTvSeen.has(e.tmdb_id));

    // newEpTagMap para enriquecer EventRows com T2E5
    const newEpTagMap = new Map<number, string>();
    for (const ep of newEpisodes) {
      if (ep.next_season != null && ep.next_episode != null) {
        newEpTagMap.set(ep.tmdb_id, `T${ep.next_season}E${ep.next_episode}`);
      }
    }

    return {
      nowPlaying, upcoming: upcoming_deduped, airingToday, onTheAirDeduped, newSeries, soonToReturn,
      countdownItems, leavingSoonFiltered,
      myNowPlaying, myUpcoming, myAiringTodayOnly,
      todayNewEpisodes, recentNewEpisodes: recentNewEpsDeduped,
      thisWeekEps, laterEps,
      newEpTagMap,
      stats: { movies: nowPlaying.length, series: onTheAir.length, upcoming: futureMovies.length },
    };
  }, [agendaData, newEpisodes, upcomingEps, leavingSoon]);

  const lib = agendaData?.userLibraryIds ?? {};

  function navigateMovie(item: AgendaMovie)    { router.push(`/title/movie/${item.id}`); }
  function navigateTv(item: AgendaTv)          { router.push(`/title/tv/${item.id}`); }
  function navigateEpisode(tmdbId: number)     { router.push(`/title/tv/${tmdbId}`); }
  function navigateLeaving(item: LeavingItem)  { router.push(`/title/${item.media_type}/${item.id}`); }
  function navigateAgendaEvent(item: { mediaType: "movie" | "tv"; tmdbId: number }) {
    router.push(`/title/${item.mediaType}/${item.tmdbId}`);
  }

  if (isLoading) return <LoadingSkeleton />;

  const hasTodayContent    = todayNewEpisodes.length > 0 || myAiringTodayOnly.length > 0;
  const hasRecentEps       = recentNewEpisodes.length > 0;
  const hasThisWeek        = thisWeekEps.length > 0;
  const hasLaterEps        = laterEps.length > 0;
  const hasPersonalContent =
    hasTodayContent || hasRecentEps || hasThisWeek || hasLaterEps ||
    myNowPlaying.length > 0 || myUpcoming.length > 0;

  return (
    <PageShell variant="wide">

      <AgendaHero
        mode={mode}
        onToggle={setMode}
        stats={stats}
        hasPersonalContent={hasPersonalContent}
      />

      {/* ════════════════════════════════════════════════════════════ */}
      {/* MINHA AGENDA — camada temporal pessoal                       */}
      {/* ════════════════════════════════════════════════════════════ */}
      {mode === "minha" && (
        <div className="flex flex-col gap-0">

          {!hasPersonalContent && (
            <EmptyPersonal onSwitch={() => setMode("geral")} />
          )}

          {/* ── HOJE ──────────────────────────────────────────────── */}
          {hasTodayContent && (
            <section className="mb-10">
              <TimelineLabel label="Hoje" color="now" />
              <SectionHeader
                eyebrow="Acontecendo agora · Sua biblioteca"
                eyebrowColor="rose"
                title="Na sua biblioteca hoje"
                count={todayNewEpisodes.length + myAiringTodayOnly.length}
              />
              {todayNewEpisodes.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 mb-3">
                  {todayNewEpisodes.map((item) => (
                    <AgendaNewEpisodeCard key={item.content_id} item={item} onClick={() => navigateEpisode(item.tmdb_id)} />
                  ))}
                </div>
              )}
              {myAiringTodayOnly.length > 0 && (
                <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                  {myAiringTodayOnly.map((t) => (
                    <EventRow key={t.id} item={t} type="tv"
                      userStatus={lib[`tv-${t.id}`]}
                      episodeTag={newEpTagMap.get(t.id)}
                      onClick={() => navigateTv(t)}
                    />
                  ))}
                </div>
              )}
            </section>
          )}

          {/* ── NOVIDADES (episódios recentes, não-hoje) ───────────── */}
          {hasRecentEps && (
            <>
              {hasTodayContent && <SectionDivider />}
              <section className="mb-10">
                <TimelineLabel label="Novidades" color="today" />
                <SectionHeader
                  eyebrow="Séries · Disponíveis agora"
                  eyebrowColor="rose"
                  title="Episódios disponíveis"
                  count={recentNewEpisodes.length}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {recentNewEpisodes.map((item) => (
                    <AgendaNewEpisodeCard key={item.content_id} item={item} onClick={() => navigateEpisode(item.tmdb_id)} />
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ── ESTA SEMANA — episódios futuros próximos 7 dias ──────── */}
          {hasThisWeek && (
            <>
              {(hasTodayContent || hasRecentEps) && <SectionDivider />}
              <section className="mb-10">
                <TimelineLabel label="Esta semana" color="week" />
                <SectionHeader
                  eyebrow="Séries · Episódios confirmados"
                  eyebrowColor="indigo"
                  title="Esta semana"
                  count={thisWeekEps.length}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {thisWeekEps.map((item) => (
                    <WeekEpisodeCard key={item.content_id} item={item} onClick={() => navigateEpisode(item.tmdb_id)} />
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ── VEM AÍ — episódios futuros além de 7 dias ─────────── */}
          {hasLaterEps && (
            <>
              {(hasTodayContent || hasRecentEps || hasThisWeek) && <SectionDivider />}
              <section className="mb-10">
                <TimelineLabel label="Vem aí" color="soon" />
                <SectionHeader
                  eyebrow="Séries · Próximos episódios"
                  eyebrowColor="cyan"
                  title="Datas confirmadas"
                  count={laterEps.length}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {laterEps.map((item) => (
                    <UpcomingEpisodeRow key={item.content_id} item={item} onClick={() => navigateEpisode(item.tmdb_id)} />
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ── FILMES AGUARDADOS — countdown rotativo ─────────────── */}
          {myUpcoming.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10">
                <TimelineLabel label="Aguardados" color="soon" />
                <SectionHeader eyebrow="Sua lista · Contagem regressiva" eyebrowColor="rose" title="Filmes aguardados" />
                <RotatingCountdown items={myUpcoming} ctaLabel="Sua Lista" onNavigate={navigateMovie} />
              </section>
            </>
          )}

          {/* ── EM CARTAZ PARA VOCÊ ────────────────────────────────── */}
          {myNowPlaying.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10">
                <TimelineLabel label="Agora" color="today" />
                <SectionHeader eyebrow="Cinema · Sua biblioteca" eyebrowColor="rose" title="Em cartaz para você" count={myNowPlaying.length} />
                <ScrollRail>
                  {myNowPlaying.map((m) => (
                    <MovieCard key={m.id} item={m} userStatus={lib[`movie-${m.id}`]} onClick={() => navigateMovie(m)} />
                  ))}
                </ScrollRail>
              </section>
            </>
          )}

        </div>
      )}

      {/* ════════════════════════════════════════════════════════════ */}
      {/* AGENDA GERAL — calendário informativo                         */}
      {/* ════════════════════════════════════════════════════════════ */}
      {mode === "geral" && (
        <div className="flex flex-col gap-0">

          {agendaData?.calendar.byProvider.Netflix?.length ? (
            <section className="mb-10">
              <AgendaProviderSection
                providerName="Netflix"
                events={agendaData.calendar.byProvider.Netflix.slice(0, 12)}
                onSelect={navigateAgendaEvent}
              />
            </section>
          ) : null}

          {/* ── HOJE: episódios com contexto de temporada/ep ─────── */}
          {airingToday.length > 0 && (
            <section className="mb-10">
              <TimelineLabel label="Hoje" color="now" />
              <SectionHeader eyebrow="Séries · Hoje" eyebrowColor="rose" title="Episódios de hoje" count={airingToday.length} />
              <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                {airingToday.slice(0, 9).map((t) => (
                  <EventRow key={t.id} item={t} type="tv"
                    userStatus={isActive(lib, `tv-${t.id}`) ? lib[`tv-${t.id}`] : undefined}
                    episodeTag={newEpTagMap.get(t.id)}
                    onClick={() => navigateTv(t)}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── ESTA SEMANA: séries no ar (deduped) ───────────────── */}
          {onTheAirDeduped.length > 0 && (
            <>
              {airingToday.length > 0 && <SectionDivider />}
              <section className="mb-10">
                <TimelineLabel label="Esta semana" color="week" />
                <SectionHeader eyebrow="Séries · Esta semana" eyebrowColor="indigo" title="No ar nos próximos dias" count={onTheAirDeduped.length} />
                <ScrollRail>
                  {onTheAirDeduped.map((t) => (
                    <TvCard key={t.id} item={t}
                      userStatus={isActive(lib, `tv-${t.id}`) ? lib[`tv-${t.id}`] : undefined}
                      onClick={() => navigateTv(t)}
                    />
                  ))}
                </ScrollRail>
              </section>
            </>
          )}

          {/* ── ESTREIAS: séries EN/PT priorizadas, últimos 45 dias ─ */}
          {newSeries.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10">
                <TimelineLabel label="Estreias" color="week" />
                <SectionHeader
                  eyebrow="Novas séries · Últimos 45 dias"
                  eyebrowColor="teal"
                  title={newSeries.length >= 5 ? "Estreias recentes" : "Em destaque"}
                  count={newSeries.length}
                />
                {newSeries.length >= 4 ? (
                  <ScrollRail>
                    {newSeries.map((t) => (
                      <TvCard key={t.id} item={t} isNew
                        userStatus={isActive(lib, `tv-${t.id}`) ? lib[`tv-${t.id}`] : undefined}
                        onClick={() => navigateTv(t)}
                      />
                    ))}
                  </ScrollRail>
                ) : (
                    // Poucos itens: banner maior
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {newSeries.map((t) => (
                      <button key={t.id} type="button" onClick={() => navigateTv(t)}
                        className="group relative rounded-2xl overflow-hidden border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.045] hover:border-white/[0.11] transition-all duration-300 text-left"
                      >
                        {IMG(t.backdrop_path, "w780") && (
                          <div className="aspect-video relative overflow-hidden">
                            <img src={IMG(t.backdrop_path, "w780")!} alt="" className="h-full w-full object-cover opacity-60 group-hover:opacity-75 transition-opacity duration-300" />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent" />
                            <div className="absolute bottom-3 left-3 right-3">
                              <span className="text-[8px] font-black uppercase tracking-[0.2em] text-emerald-400/90 border border-emerald-500/30 bg-emerald-950/40 rounded-full px-2 py-0.5 mb-2 inline-block">
                                Nova série
                              </span>
                              <p className="text-[14px] font-black text-white/95 leading-tight tracking-[-0.02em] line-clamp-2">{t.title}</p>
                              <p className="text-[10px] text-white/40 mt-1">Estreou {formatPtDate(t.first_air_date)}</p>
                            </div>
                          </div>
                        )}
                        {!IMG(t.backdrop_path, "w780") && (
                          <div className="p-4">
                            <span className="text-[8px] font-black uppercase tracking-[0.2em] text-emerald-400/90 border border-emerald-500/30 bg-emerald-950/40 rounded-full px-2 py-0.5 mb-2 inline-block">Nova série</span>
                            <p className="text-[14px] font-black text-white/90 leading-tight">{t.title}</p>
                            <p className="text-[10px] text-white/35 mt-1">Estreou {formatPtDate(t.first_air_date)}</p>
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}

          {/* ── VOLTANDO EM BREVE: séries com ep. nos próximos 3 meses ─────── */}
          {soonToReturn.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10">
                <TimelineLabel label="Voltando em breve" color="week" />
                <SectionHeader
                  eyebrow="Séries · Próximos 3 meses"
                  eyebrowColor="violet"
                  title="Voltando em breve"
                  count={soonToReturn.length}
                />
                <ScrollRail>
                  {soonToReturn.map((t) => (
                    <TvCard key={t.id} item={t}
                      userStatus={isActive(lib, `tv-${t.id}`) ? lib[`tv-${t.id}`] : undefined}
                      onClick={() => navigateTv(t)}
                    />
                  ))}
                </ScrollRail>
              </section>
            </>
          )}

          {/* ── EM CARTAZ NOS CINEMAS ─────────────────────────────── */}
          {nowPlaying.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10">
                <TimelineLabel label="Agora" color="today" />
                <SectionHeader eyebrow="Cinema · Em cartaz" eyebrowColor="rose" title="Filmes nos cinemas" count={nowPlaying.length} />
                <ScrollRail>
                  {nowPlaying.map((m) => (
                    <MovieCard key={m.id} item={m}
                      userStatus={isActive(lib, `movie-${m.id}`) ? lib[`movie-${m.id}`] : undefined}
                      onClick={() => navigateMovie(m)}
                    />
                  ))}
                </ScrollRail>
              </section>
            </>
          )}

          {/* ── SAINDO DOS STREAMINGS — urgência temporal ─────────── */}
          {leavingSoonFiltered.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10">
                <TimelineLabel label="Última chance" color="urgent" />
                <SectionHeader
                  eyebrow="Streaming · Expirando em breve"
                  eyebrowColor="rose"
                  title="Saindo dos streamings"
                  count={leavingSoonFiltered.length}
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {leavingSoonFiltered.map((item) => (
                    <LeavingCard key={`${item.media_type}-${item.id}`} item={item} onClick={() => navigateLeaving(item)} />
                  ))}
                </div>
              </section>
            </>
          )}

          {/* ── MAIS AGUARDADOS — countdown rotativo ─────────────── */}
          {countdownItems.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10">
                <TimelineLabel label="Em breve" color="soon" />
                <SectionHeader eyebrow="Cinema · Contagem regressiva" eyebrowColor="rose" title="Mais aguardados" />
                <RotatingCountdown items={countdownItems} onNavigate={navigateMovie} />
              </section>
            </>
          )}

          {/* ── PRÓXIMAS ESTREIAS ─────────────────────────────────── */}
          {upcoming.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10">
                <SectionHeader eyebrow="Próximas estreias · Cinema" eyebrowColor="cyan" title="Em breve nas telonas" count={upcoming.length} />
                <ScrollRail>
                  {upcoming.map((m) => (
                    <MovieCard key={m.id} item={m}
                      userStatus={isActive(lib, `movie-${m.id}`) ? lib[`movie-${m.id}`] : undefined}
                      onClick={() => navigateMovie(m)}
                    />
                  ))}
                </ScrollRail>
              </section>
            </>
          )}

        </div>
      )}

    </PageShell>
  );
}
