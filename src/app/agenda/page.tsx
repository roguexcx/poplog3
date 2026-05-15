"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/layout/PageShell";
import type { AgendaMovie, AgendaResponse, AgendaTv } from "@/app/api/poplog3/agenda/route";

// ── TMDB ─────────────────────────────────────────────────────────────────────

const IMG = (path: string | null, size: string) =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

// ── date helpers ──────────────────────────────────────────────────────────────

function today() {
  return new Date().toISOString().slice(0, 10);
}

function daysFromNow(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function formatPtDate(dateStr: string): string {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

function formatCountdown(dateStr: string): { days: number; label: string } {
  const days = daysFromNow(dateStr);
  if (days <= 0) return { days: 0, label: "Hoje" };
  if (days === 1) return { days: 1, label: "Amanhã" };
  if (days < 7) return { days, label: `Em ${days} dias` };
  if (days < 30) return { days, label: `Em ${Math.floor(days / 7)} sem.` };
  return { days, label: `Em ${Math.floor(days / 30)} meses` };
}

function todayLong(): string {
  return new Date().toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ── design tokens ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  watching:  "bg-violet-500/80 text-violet-100 border-violet-400/30",
  watchlist: "bg-teal-600/60 text-teal-100 border-teal-400/20",
  watched:   "bg-white/10 text-white/50 border-white/10",
  abandoned: "bg-white/5 text-white/30 border-white/8",
  fridge:    "bg-white/5 text-white/30 border-white/8",
};

const STATUS_LABELS: Record<string, string> = {
  watching:  "Assistindo",
  watchlist: "Watchlist",
  watched:   "Assistido",
  abandoned: "Abandonou",
  fridge:    "Pausou",
};

// ── primitives ────────────────────────────────────────────────────────────────

function SectionEyebrow({
  children,
  color = "indigo",
}: {
  children: React.ReactNode;
  color?: "indigo" | "rose" | "amber" | "cyan" | "teal" | "muted";
}) {
  const line = {
    indigo: "bg-indigo-400/60",
    rose:   "bg-rose-400/60",
    amber:  "bg-amber-400/60",
    cyan:   "bg-cyan-400/60",
    teal:   "bg-teal-400/60",
    muted:  "bg-white/20",
  }[color];
  const text = {
    indigo: "text-indigo-400/80",
    rose:   "text-rose-400/80",
    amber:  "text-amber-400/80",
    cyan:   "text-cyan-400/80",
    teal:   "text-teal-400/80",
    muted:  "text-white/30",
  }[color];
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${line}`} />
      <p className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${text}`}>{children}</p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  eyebrowColor = "indigo",
  title,
  count,
  action,
}: {
  eyebrow: string;
  eyebrowColor?: "indigo" | "rose" | "amber" | "cyan" | "teal" | "muted";
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <SectionEyebrow color={eyebrowColor}>{eyebrow}</SectionEyebrow>
        <h2 className="text-xl font-black tracking-[-0.03em] text-white/90 leading-tight">{title}</h2>
      </div>
      <div className="flex items-center gap-3 pb-0.5">
        {count !== undefined && (
          <span className="text-[11px] text-white/25 border border-white/10 rounded-full px-2.5 py-0.5">
            {count}
          </span>
        )}
        {action}
      </div>
    </div>
  );
}

function SectionDivider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />;
}

function UserStatusBadge({ status }: { status: string }) {
  return (
    <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_COLORS[status] ?? "bg-white/5 text-white/30 border-white/8"}`}>
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ── MovieCard ─────────────────────────────────────────────────────────────────

function MovieCard({
  item,
  userStatus,
  onClick,
}: {
  item: AgendaMovie;
  userStatus?: string | null;
  onClick: () => void;
}) {
  const days = item.release_date ? daysFromNow(item.release_date) : null;
  const isToday = days !== null && days <= 0;
  const isSoon  = days !== null && days > 0 && days <= 7;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex-shrink-0 w-[148px] sm:w-[160px] text-left"
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/[0.07] mb-2.5 bg-white/[0.04]">
        {IMG(item.poster_path, "w342") && (
          <img
            src={IMG(item.poster_path, "w342")!}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

        {/* top-left badge */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
          {isToday ? (
            <span className="text-[8.5px] font-black uppercase tracking-wide px-2 py-0.5 rounded-md bg-rose-500/90 text-white border border-rose-400/30">
              Hoje
            </span>
          ) : isSoon ? (
            <span className="text-[8.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-amber-500/80 text-amber-100 border border-amber-400/30">
              {formatCountdown(item.release_date).label}
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

        {/* user badge */}
        {userStatus && (
          <div className="absolute bottom-2 left-2">
            <UserStatusBadge status={userStatus} />
          </div>
        )}
      </div>

      <div className="px-0.5">
        <p className="text-[12.5px] font-bold text-white/85 leading-tight tracking-[-0.02em] line-clamp-1 mb-1">
          {item.title}
        </p>
        <p className="text-[10px] text-white/35">
          {item.release_date ? formatPtDate(item.release_date) : "Data a confirmar"}
        </p>
      </div>
    </button>
  );
}

// ── TvCard ────────────────────────────────────────────────────────────────────

function TvCard({
  item,
  userStatus,
  onClick,
}: {
  item: AgendaTv;
  userStatus?: string | null;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex-shrink-0 w-[148px] sm:w-[160px] text-left"
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/[0.07] mb-2.5 bg-white/[0.04]">
        {IMG(item.poster_path, "w342") && (
          <img
            src={IMG(item.poster_path, "w342")!}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
          <span className="text-[8.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-indigo-500/80 text-indigo-100 border border-indigo-400/30">
            No ar
          </span>
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
        <p className="text-[12.5px] font-bold text-white/85 leading-tight tracking-[-0.02em] line-clamp-1 mb-1">
          {item.title}
        </p>
        <p className="text-[10px] text-white/35">Exibindo agora</p>
      </div>
    </button>
  );
}

// ── HorizontalRail ────────────────────────────────────────────────────────────

function HorizontalRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 sm:-mx-6 md:-mx-8 lg:mx-0">
      <div className="flex gap-3.5 overflow-x-auto px-4 sm:px-6 md:px-8 lg:px-0 pb-3 no-scrollbar">
        {children}
      </div>
    </div>
  );
}

// ── CountdownHero ─────────────────────────────────────────────────────────────

function CountdownHero({
  item,
  onClick,
}: {
  item: AgendaMovie;
  onClick: () => void;
}) {
  const { days, label } = formatCountdown(item.release_date);
  const backdrop = IMG(item.backdrop_path, "w1280");
  const poster   = IMG(item.poster_path, "w342");

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full text-left rounded-[20px] overflow-hidden border border-white/[0.07] min-h-[280px] sm:min-h-[320px]"
    >
      {/* backdrop */}
      {backdrop && (
        <div className="absolute inset-0">
          <img src={backdrop} alt="" className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/75 to-black/30" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        </div>
      )}
      {!backdrop && (
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-950 via-black to-black" />
      )}

      <div className="relative flex items-center gap-6 p-6 sm:p-8">
        {/* poster */}
        {poster && (
          <div className="relative flex-shrink-0 w-[100px] sm:w-[120px] aspect-[2/3] rounded-xl overflow-hidden border border-white/10 shadow-2xl">
            <img src={poster} alt={item.title} className="h-full w-full object-cover" />
          </div>
        )}

        {/* info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-[9px] font-black uppercase tracking-[0.25em] text-rose-400/90 border border-rose-500/30 bg-rose-950/40 rounded-full px-2.5 py-1">
              Aguardado
            </span>
            <span className="text-[9px] font-bold text-white/25 uppercase tracking-wide">Filme</span>
          </div>

          <h3 className="text-2xl sm:text-3xl font-black tracking-[-0.04em] text-white/95 leading-tight mb-2 line-clamp-2">
            {item.title}
          </h3>

          {item.overview && (
            <p className="text-[12px] text-white/40 line-clamp-2 mb-4 leading-relaxed max-w-lg">
              {item.overview}
            </p>
          )}

          {/* countdown pill */}
          <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-2.5">
            <div className="text-center">
              <p className="text-2xl sm:text-3xl font-black text-white/90 leading-none tracking-tight">{days}</p>
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
    </button>
  );
}

// ── EventRow ─── (compact card for "Hoje" section) ───────────────────────────

function EventRow({
  item,
  type,
  userStatus,
  onClick,
}: {
  item: AgendaMovie | AgendaTv;
  type: "movie" | "tv";
  userStatus?: string | null;
  onClick: () => void;
}) {
  const poster = IMG(item.poster_path, "w185");
  const backdrop = IMG(item.backdrop_path, "w780");
  const title = item.title;

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full text-left rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.045] hover:border-white/[0.1] transition-all duration-300 overflow-hidden"
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
            <img src={poster} alt={title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" loading="lazy" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
            {type === "movie" ? (
              <span className="text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300/80 border border-cyan-500/20">
                Cinema
              </span>
            ) : (
              <span className="text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300/80 border border-indigo-500/20">
                Série
              </span>
            )}
            {userStatus && <UserStatusBadge status={userStatus} />}
          </div>

          <h4 className="text-[14px] font-black tracking-[-0.02em] text-white/90 leading-tight line-clamp-1 mb-0.5">
            {title}
          </h4>

          {"release_date" in item && item.release_date && (
            <p className="text-[11px] text-white/35">{formatPtDate(item.release_date)}</p>
          )}
          {"first_air_date" in item && item.first_air_date && (
            <p className="text-[11px] text-white/35">Desde {formatPtDate(item.first_air_date)}</p>
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

// ── AgendaHero ────────────────────────────────────────────────────────────────

function AgendaHero({
  mode,
  onToggle,
  stats,
  isPersonal,
}: {
  mode: "geral" | "minha";
  onToggle: (m: "geral" | "minha") => void;
  stats: { movies: number; series: number; upcoming: number };
  isPersonal: boolean;
}) {
  return (
    <div className="relative isolate rounded-[24px] overflow-hidden mb-10 min-h-[260px] sm:min-h-[300px] flex flex-col justify-between p-6 sm:p-8 border border-white/[0.06]">
      {/* bg */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-indigo-950/80 via-black to-black" />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 20% 0%, rgba(99,102,241,0.15) 0%, transparent 60%)" }} />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 90% 100%, rgba(6,182,212,0.08) 0%, transparent 50%)" }} />

      {/* grid lines */}
      <div className="absolute inset-0 -z-10 opacity-[0.03]"
        style={{ backgroundImage: "linear-gradient(0deg, white 1px, transparent 1px), linear-gradient(90deg, white 1px, transparent 1px)", backgroundSize: "64px 64px" }}
      />

      {/* top row: date + toggle */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[9.5px] font-bold uppercase tracking-[0.25em] text-indigo-400/70 mb-1.5">
            Calendário do entretenimento
          </p>
          <p className="text-[12px] text-white/35 capitalize">{todayLong()}</p>
        </div>

        {/* mode toggle */}
        <div className="flex-shrink-0 flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1">
          <button
            type="button"
            onClick={() => onToggle("geral")}
            className={`text-[11px] font-bold px-3.5 py-1.5 rounded-xl transition-all duration-200 ${
              mode === "geral"
                ? "bg-white/[0.09] text-white/85 shadow-inner"
                : "text-white/30 hover:text-white/55"
            }`}
          >
            Geral
          </button>
          <button
            type="button"
            onClick={() => onToggle("minha")}
            className={`text-[11px] font-bold px-3.5 py-1.5 rounded-xl transition-all duration-200 flex items-center gap-1.5 ${
              mode === "minha"
                ? "bg-indigo-500/20 text-indigo-200 shadow-inner border border-indigo-500/20"
                : "text-white/30 hover:text-white/55"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isPersonal ? "bg-indigo-400" : "bg-white/20"}`} />
            Minha Agenda
          </button>
        </div>
      </div>

      {/* main title */}
      <div>
        <h1 className="text-5xl sm:text-6xl font-black tracking-[-0.05em] text-white/90 leading-none mb-2">
          Agenda
        </h1>
        <p className="text-[13px] text-white/35 max-w-sm leading-relaxed">
          {mode === "minha"
            ? "Filmes e séries da sua biblioteca que estão acontecendo agora."
            : "O que estreia, o que volta e o que chega nos próximos dias."}
        </p>
      </div>

      {/* stats strip */}
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
      <h3 className="text-[17px] font-black tracking-tight text-white/50 mb-2">
        Nenhum título da biblioteca na agenda
      </h3>
      <p className="text-[12px] text-white/25 max-w-xs mx-auto leading-relaxed mb-5">
        Adicione filmes e séries à sua biblioteca para ver uma agenda personalizada.
      </p>
      <button
        type="button"
        onClick={onSwitch}
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
        <div className="h-[100px] rounded-2xl bg-white/[0.03] animate-pulse" />
        <div className="flex gap-3.5 overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-[148px] h-[240px] rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
        <div className="h-px bg-white/[0.06]" />
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-[80px] rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function AgendaPage() {
  const router = useRouter();
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [mode, setMode] = useState<"geral" | "minha">("geral");

  useEffect(() => {
    fetch("/api/poplog3/agenda")
      .then((r) => r.json())
      .then((d: AgendaResponse) => setData(d))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const isPersonal = !!data && Object.keys(data.userLibraryIds ?? {}).length > 0;

  // ── derived lists ──────────────────────────────────────────────────────────

  const {
    nowPlaying,
    upcoming,
    airingToday,
    onTheAir,
    countdownItem,
    myNowPlaying,
    myUpcoming,
    myOnTheAir,
    stats,
  } = useMemo(() => {
    if (!data) {
      return {
        nowPlaying: [], upcoming: [], airingToday: [], onTheAir: [],
        countdownItem: null, myNowPlaying: [], myUpcoming: [], myOnTheAir: [],
        stats: { movies: 0, series: 0, upcoming: 0 },
      };
    }

    const lib = data.userLibraryIds ?? {};

    function movieStatus(m: AgendaMovie) {
      return lib[`movie-${m.id}`] ?? null;
    }
    function tvStatus(t: AgendaTv) {
      return lib[`tv-${t.id}`] ?? null;
    }

    // sort by popularity for display
    const nowPlaying = [...data.nowPlaying].sort((a, b) => b.popularity - a.popularity);
    const upcoming   = [...data.upcoming].sort((a, b) => b.popularity - a.popularity);
    const airingToday = [...data.airingToday].sort((a, b) => b.popularity - a.popularity);
    const onTheAir    = [...data.onTheAir].sort((a, b) => b.popularity - a.popularity);

    // countdown: first upcoming film with a future date and popularity
    const todayStr = today();
    const futureMovies = upcoming
      .filter(m => m.release_date && m.release_date > todayStr)
      .sort((a, b) => b.popularity - a.popularity);
    const countdownItem = futureMovies[0] ?? null;

    // personal mode: only items in user library
    const myNowPlaying = nowPlaying.filter(m => movieStatus(m));
    const myUpcoming   = upcoming.filter(m => movieStatus(m));
    const myOnTheAir   = onTheAir.filter(t => tvStatus(t));

    return {
      nowPlaying, upcoming, airingToday, onTheAir,
      countdownItem,
      myNowPlaying, myUpcoming, myOnTheAir,
      stats: {
        movies:   nowPlaying.length,
        series:   onTheAir.length,
        upcoming: upcoming.filter(m => m.release_date && m.release_date > todayStr).length,
      },
    };
  }, [data]);

  function navigateMovie(item: AgendaMovie) {
    router.push(`/title/movie/${item.id}`);
  }

  function navigateTv(item: AgendaTv) {
    router.push(`/title/tv/${item.id}`);
  }

  if (isLoading) return <LoadingSkeleton />;

  // ── "Minha Agenda" has nothing in library ─────────────────────────────────
  const personalIsEmpty =
    mode === "minha" && !isPersonal;
  const personalHasContent =
    mode === "minha" && isPersonal &&
    (myNowPlaying.length > 0 || myUpcoming.length > 0 || myOnTheAir.length > 0);

  return (
    <PageShell variant="wide">
      {/* ── Hero ──────────────────────────────────────────────────── */}
      <AgendaHero
        mode={mode}
        onToggle={setMode}
        stats={stats}
        isPersonal={isPersonal}
      />

      {/* ── Personal mode: no library content ───────────────────── */}
      {personalIsEmpty && (
        <EmptyPersonal onSwitch={() => setMode("geral")} />
      )}

      {/* ── Minha Agenda ──────────────────────────────────────────── */}
      {mode === "minha" && isPersonal && (
        <div className="flex flex-col gap-0">

          {/* Filmes da sua biblioteca em cartaz */}
          {myNowPlaying.length > 0 && (
            <section className="mb-10">
              <SectionHeader
                eyebrow="Em cartaz agora"
                eyebrowColor="rose"
                title="Filmes da sua biblioteca"
                count={myNowPlaying.length}
              />
              <HorizontalRail>
                {myNowPlaying.map((m) => (
                  <MovieCard
                    key={m.id}
                    item={m}
                    userStatus={data?.userLibraryIds[`movie-${m.id}`]}
                    onClick={() => navigateMovie(m)}
                  />
                ))}
              </HorizontalRail>
            </section>
          )}

          {myNowPlaying.length > 0 && myOnTheAir.length > 0 && <SectionDivider />}

          {/* Séries da sua biblioteca no ar */}
          {myOnTheAir.length > 0 && (
            <section className={`mb-10 ${myNowPlaying.length > 0 ? "mt-10" : ""}`}>
              <SectionHeader
                eyebrow="Séries na sua biblioteca"
                eyebrowColor="indigo"
                title="No ar agora"
                count={myOnTheAir.length}
              />
              <HorizontalRail>
                {myOnTheAir.map((t) => (
                  <TvCard
                    key={t.id}
                    item={t}
                    userStatus={data?.userLibraryIds[`tv-${t.id}`]}
                    onClick={() => navigateTv(t)}
                  />
                ))}
              </HorizontalRail>
            </section>
          )}

          {myOnTheAir.length > 0 && myUpcoming.length > 0 && <SectionDivider />}

          {/* Estreias aguardadas da biblioteca */}
          {myUpcoming.length > 0 && (
            <section className={`mb-10 ${myOnTheAir.length > 0 ? "mt-10" : ""}`}>
              <SectionHeader
                eyebrow="Estreias da sua lista"
                eyebrowColor="cyan"
                title="Filmes aguardados"
                count={myUpcoming.length}
              />
              <HorizontalRail>
                {myUpcoming.map((m) => (
                  <MovieCard
                    key={m.id}
                    item={m}
                    userStatus={data?.userLibraryIds[`movie-${m.id}`]}
                    onClick={() => navigateMovie(m)}
                  />
                ))}
              </HorizontalRail>
            </section>
          )}

          {!personalHasContent && (
            <EmptyPersonal onSwitch={() => setMode("geral")} />
          )}
        </div>
      )}

      {/* ── Agenda Geral ──────────────────────────────────────────── */}
      {mode === "geral" && (
        <div className="flex flex-col gap-0">

          {/* Hoje — airing today */}
          {airingToday.length > 0 && (
            <section className="mb-10">
              <SectionHeader
                eyebrow="Séries · Hoje"
                eyebrowColor="rose"
                title="Episódios de hoje"
                count={airingToday.length}
              />
              <div className="grid gap-2.5 sm:grid-cols-2 md:grid-cols-3">
                {airingToday.slice(0, 9).map((t) => (
                  <EventRow
                    key={t.id}
                    item={t}
                    type="tv"
                    userStatus={data?.userLibraryIds[`tv-${t.id}`]}
                    onClick={() => navigateTv(t)}
                  />
                ))}
              </div>
            </section>
          )}

          {airingToday.length > 0 && <SectionDivider />}

          {/* Em cartaz agora — now playing */}
          {nowPlaying.length > 0 && (
            <section className="mb-10 mt-10">
              <SectionHeader
                eyebrow="Cinema · Em cartaz"
                eyebrowColor="rose"
                title="Filmes nos cinemas agora"
                count={nowPlaying.length}
              />
              <HorizontalRail>
                {nowPlaying.map((m) => (
                  <MovieCard
                    key={m.id}
                    item={m}
                    userStatus={data?.userLibraryIds[`movie-${m.id}`]}
                    onClick={() => navigateMovie(m)}
                  />
                ))}
              </HorizontalRail>
            </section>
          )}

          {nowPlaying.length > 0 && onTheAir.length > 0 && <SectionDivider />}

          {/* Séries no ar esta semana */}
          {onTheAir.length > 0 && (
            <section className="mb-10 mt-10">
              <SectionHeader
                eyebrow="Esta semana · Séries"
                eyebrowColor="indigo"
                title="No ar nos próximos 7 dias"
                count={onTheAir.length}
              />
              <HorizontalRail>
                {onTheAir.map((t) => (
                  <TvCard
                    key={t.id}
                    item={t}
                    userStatus={data?.userLibraryIds[`tv-${t.id}`]}
                    onClick={() => navigateTv(t)}
                  />
                ))}
              </HorizontalRail>
            </section>
          )}

          {/* Countdown hero */}
          {countdownItem && (
            <>
              <SectionDivider />
              <section className="mb-10 mt-10">
                <SectionHeader
                  eyebrow="Modo Countdown"
                  eyebrowColor="rose"
                  title="Mais aguardado"
                />
                <CountdownHero item={countdownItem} onClick={() => navigateMovie(countdownItem)} />
              </section>
            </>
          )}

          {/* Próximas estreias */}
          {upcoming.length > 0 && (
            <>
              <SectionDivider />
              <section className="mb-10 mt-10">
                <SectionHeader
                  eyebrow="Próximas Estreias · Cinema"
                  eyebrowColor="cyan"
                  title="Em breve nas telonas"
                  count={upcoming.length}
                />
                <HorizontalRail>
                  {upcoming.map((m) => (
                    <MovieCard
                      key={m.id}
                      item={m}
                      userStatus={data?.userLibraryIds[`movie-${m.id}`]}
                      onClick={() => navigateMovie(m)}
                    />
                  ))}
                </HorizontalRail>
              </section>
            </>
          )}

        </div>
      )}
    </PageShell>
  );
}
