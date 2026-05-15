"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import type { AgendaMovie, AgendaResponse, AgendaTv } from "@/app/api/poplog3/agenda/route";

type AgendaItem = AgendaMovie | AgendaTv;

// ── constants ─────────────────────────────────────────────────────────────────

const HERO_INTERVAL = 8000;

const GENRES: Record<number, string> = {
  28: "Ação",  12: "Aventura", 16: "Animação",  35: "Comédia",
  80: "Crime", 99: "Documentário", 18: "Drama",  10751: "Família",
  14: "Fantasia", 27: "Terror",  9648: "Mistério", 10749: "Romance",
  878: "Ficção Científica", 53: "Suspense", 10752: "Guerra",
  10759: "Ação & Aventura", 10765: "Ficção & Fantasia",
};

// ── helpers ───────────────────────────────────────────────────────────────────

const IMG = (path: string | null | undefined, size: string) =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

function genreLabels(ids: number[] = [], max = 3): string[] {
  return ids.slice(0, max).map(id => GENRES[id]).filter(Boolean);
}

function releaseYear(item: AgendaItem): string | null {
  const d = "release_date" in item ? item.release_date : item.first_air_date;
  return d?.slice(0, 4) ?? null;
}

function daysFromNow(dateStr: string): number {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86_400_000);
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── design tokens (shared with other pages) ───────────────────────────────────

function SectionEyebrow({
  children,
  color = "indigo",
}: {
  children: React.ReactNode;
  color?: "indigo" | "rose" | "amber" | "cyan" | "teal" | "violet" | "muted";
}) {
  const line: Record<string, string> = {
    indigo: "bg-indigo-400/60", rose: "bg-rose-400/60",
    amber: "bg-amber-400/60",   cyan: "bg-cyan-400/60",
    teal: "bg-teal-400/60",     violet: "bg-violet-400/60",
    muted: "bg-white/20",
  };
  const text: Record<string, string> = {
    indigo: "text-indigo-400/80", rose: "text-rose-400/80",
    amber: "text-amber-400/80",   cyan: "text-cyan-400/80",
    teal: "text-teal-400/80",     violet: "text-violet-400/80",
    muted: "text-white/30",
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
  eyebrow: string;
  eyebrowColor?: "indigo" | "rose" | "amber" | "cyan" | "teal" | "violet" | "muted";
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
          <span className="text-[11px] text-white/25 border border-white/10 rounded-full px-2.5 py-0.5">{count}</span>
        )}
        {action}
      </div>
    </div>
  );
}

function SectionDivider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />;
}

function SeeAllBtn({ onClick }: { onClick?: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className="text-[11px] text-white/30 hover:text-white/60 transition-colors flex items-center gap-1">
      Ver todos
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

function HorizontalRail({ children }: { children: React.ReactNode }) {
  return (
    <div className="-mx-4 sm:-mx-6 md:-mx-8 lg:mx-0">
      <div className="flex gap-3.5 overflow-x-auto px-4 sm:px-6 md:px-8 lg:px-0 pb-3 no-scrollbar">
        {children}
      </div>
    </div>
  );
}

// ── PosterCard ────────────────────────────────────────────────────────────────

function PosterCard({
  item, badge, onClick,
}: {
  item: AgendaItem;
  badge?: React.ReactNode;
  onClick: () => void;
}) {
  const poster = IMG(item.poster_path, "w342");
  const isMovie = item.media_type === "movie";

  return (
    <button type="button" onClick={onClick}
      className="group relative flex-shrink-0 w-[148px] sm:w-[160px] text-left">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/[0.07] mb-2.5 bg-white/[0.03]">
        {poster && (
          <img src={poster} alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />

        {/* top row */}
        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
          <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${
            isMovie
              ? "bg-cyan-950/80 border-cyan-500/25 text-cyan-300/75"
              : "bg-indigo-950/80 border-indigo-500/25 text-indigo-300/75"
          }`}>
            {isMovie ? "Filme" : "Série"}
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

        {/* bottom badge slot */}
        {badge && (
          <div className="absolute bottom-2 left-2 right-2">{badge}</div>
        )}
      </div>

      <div className="px-0.5">
        <p className="text-[12.5px] font-bold text-white/85 leading-tight tracking-[-0.02em] line-clamp-1 mb-0.5">
          {item.title}
        </p>
        <p className="text-[10px] text-white/30">{releaseYear(item)}</p>
      </div>
    </button>
  );
}

// ── BackdropCard (wide card for TV series grid) ───────────────────────────────

function BackdropCard({ item, onClick }: { item: AgendaItem; onClick: () => void }) {
  const backdrop = IMG(item.backdrop_path, "w780");
  const poster   = IMG(item.poster_path, "w185");
  const genres   = genreLabels(item.genre_ids, 2);
  const isMovie  = item.media_type === "movie";

  return (
    <button type="button" onClick={onClick}
      className="group relative w-full text-left rounded-2xl overflow-hidden border border-white/[0.07] bg-white/[0.03] hover:border-white/[0.12] transition-all duration-300 aspect-video">

      {/* backdrop */}
      {backdrop ? (
        <img src={backdrop} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.03]" loading="lazy" />
      ) : (
        poster && <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-40" loading="lazy" />
      )}

      {/* overlays */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
      {/* hover glow */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300"
        style={{ background: "radial-gradient(ellipse at 0% 100%, rgba(99,102,241,0.12), transparent 60%)" }} />

      {/* content */}
      <div className="absolute inset-0 flex flex-col justify-end p-4 sm:p-5">
        {/* top badges */}
        <div className="absolute top-3 left-3 flex items-center gap-1.5">
          <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
            isMovie
              ? "bg-cyan-950/80 border-cyan-500/25 text-cyan-300/75"
              : "bg-indigo-500/80 border-indigo-400/30 text-indigo-100"
          }`}>
            {isMovie ? "Filme" : "No ar"}
          </span>
          {item.vote_average > 0 && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-300 bg-black/60 rounded-full px-2 py-0.5">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
              </svg>
              {item.vote_average.toFixed(1)}
            </span>
          )}
        </div>

        {/* genre chips */}
        <div className="flex gap-1.5 mb-2 flex-wrap">
          {genres.map(g => (
            <span key={g} className="text-[9px] text-white/40 border border-white/[0.08] rounded-full px-2 py-0.5 bg-black/30">
              {g}
            </span>
          ))}
        </div>

        <h3 className="text-[15px] sm:text-[17px] font-black tracking-[-0.03em] text-white/95 leading-tight line-clamp-2">
          {item.title}
        </h3>
        {item.overview && (
          <p className="text-[11px] text-white/40 line-clamp-2 mt-1.5 leading-relaxed">
            {item.overview}
          </p>
        )}
      </div>
    </button>
  );
}

// ── EventRow (compact — today's TV) ──────────────────────────────────────────

function EventRow({ item, onClick }: { item: AgendaTv; onClick: () => void }) {
  const poster = IMG(item.poster_path, "w185");

  return (
    <button type="button" onClick={onClick}
      className="group w-full text-left flex items-center gap-3.5 rounded-2xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.10] transition-all duration-200 p-3">

      <div className="relative flex-shrink-0 w-[50px] h-[74px] rounded-lg overflow-hidden bg-white/[0.04]">
        {poster && (
          <img src={poster} alt={item.title} className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]" loading="lazy" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-rose-500/80 text-white border border-rose-400/30">
            Hoje
          </span>
          <span className="text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border border-indigo-500/20 text-indigo-300/70 bg-indigo-950/30">
            Série
          </span>
        </div>
        <h4 className="text-[13.5px] font-black tracking-tight text-white/88 leading-tight line-clamp-1">{item.title}</h4>
        {item.first_air_date && (
          <p className="text-[10px] text-white/30 mt-0.5">No ar desde {item.first_air_date.slice(0, 4)}</p>
        )}
      </div>

      {item.vote_average > 0 && (
        <div className="flex-shrink-0 flex flex-col items-center gap-0.5">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400/80">
            <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
          </svg>
          <span className="text-[11px] font-bold text-amber-300/80">{item.vote_average.toFixed(1)}</span>
        </div>
      )}
    </button>
  );
}

// ── StatsStrip ────────────────────────────────────────────────────────────────

function StatsStrip({
  nowPlaying, onTheAir, upcoming, airingToday,
}: {
  nowPlaying: number;
  onTheAir: number;
  upcoming: number;
  airingToday: number;
}) {
  const stats = [
    { value: nowPlaying,  label: "filmes em cartaz",        accent: false },
    { value: onTheAir,    label: "séries no ar",            accent: false },
    { value: upcoming,    label: "estreias em breve",        accent: true  },
    { value: airingToday, label: "episódios hoje",          accent: false },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 mb-10">
      {stats.map(s => (
        <div key={s.label} className={`rounded-2xl border px-4 py-3.5 ${
          s.accent
            ? "bg-cyan-950/30 border-cyan-500/20"
            : "bg-white/[0.025] border-white/[0.06]"
        }`}>
          <p className={`text-2xl font-black tracking-tight leading-none mb-1 ${s.accent ? "text-cyan-200" : "text-white/80"}`}>
            {s.value}
          </p>
          <p className="text-[11px] text-white/35 leading-snug">{s.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── HeroSection ───────────────────────────────────────────────────────────────

function HeroSection({
  items,
  heroIdx,
  heroProgress,
  onDotClick,
  onNavigate,
}: {
  items: AgendaItem[];
  heroIdx: number;
  heroProgress: number;
  onDotClick: (i: number) => void;
  onNavigate: (item: AgendaItem) => void;
}) {
  // Double-buffer crossfade
  const [bdA, setBdA]         = useState<string | null>(null);
  const [bdB, setBdB]         = useState<string | null>(null);
  const [activeBd, setActiveBd] = useState<"A" | "B">("A");

  useEffect(() => {
    const item = items[heroIdx];
    if (!item) return;
    const newSrc = IMG(item.backdrop_path, "w1280");
    const inactive = activeBd === "A" ? "B" : "A";

    if (inactive === "B") setBdB(newSrc);
    else setBdA(newSrc);

    const t = setTimeout(() => setActiveBd(inactive), 60);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroIdx]);

  // seed layer A on first load
  useEffect(() => {
    if (items[0]) setBdA(IMG(items[0].backdrop_path, "w1280"));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length > 0]);

  const current = items[heroIdx];
  if (!current) return null;

  const poster   = IMG(current.poster_path, "w342");
  const genres   = genreLabels(current.genre_ids, 3);
  const year     = releaseYear(current);
  const isMovie  = current.media_type === "movie";

  return (
    <section className="relative isolate min-h-[88vh] overflow-hidden">

      {/* ── Backdrop double-buffer ────────────────────────────── */}
      <div className="absolute inset-0 -z-20">
        {bdA && (
          <div className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${activeBd === "A" ? "opacity-100" : "opacity-0"}`}>
            <img src={bdA} alt="" className="h-full w-full object-cover brightness-[0.72] contrast-[1.06] saturate-[1.12]" />
          </div>
        )}
        {bdB && (
          <div className={`absolute inset-0 transition-opacity duration-700 ease-in-out ${activeBd === "B" ? "opacity-100" : "opacity-0"}`}>
            <img src={bdB} alt="" className="h-full w-full object-cover brightness-[0.72] contrast-[1.06] saturate-[1.12]" />
          </div>
        )}
      </div>

      {/* ── Atmospheric overlays ─────────────────────────────── */}
      <div className="absolute inset-0 -z-10 bg-gradient-to-b from-zinc-950/50 via-zinc-950/40 to-zinc-950/95" aria-hidden />
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-zinc-950/90 via-zinc-950/50 to-transparent" aria-hidden />
      <div className="absolute inset-y-0 right-0 -z-10 w-[40%] bg-gradient-to-l from-zinc-950/60 to-transparent hidden lg:block" aria-hidden />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 15% 40%, rgba(139,92,246,0.10), transparent 50%), radial-gradient(ellipse at 80% 20%, rgba(6,182,212,0.07), transparent 40%)" }} aria-hidden />

      {/* ── Content ──────────────────────────────────────────── */}
      <div className="relative flex flex-col justify-end min-h-[88vh] max-w-[1600px] mx-auto px-5 pb-16 pt-28 sm:px-8 sm:pb-20 md:px-12 lg:px-16">
        <div className="grid items-end gap-8 md:grid-cols-[260px_minmax(0,1fr)] md:gap-10 xl:grid-cols-[300px_minmax(0,1fr)]">

          {/* ── Poster (desktop) ──────────────────────────────── */}
          <div className="relative hidden md:block">
            <div className="absolute -inset-3 -z-10 rounded-[2rem] blur-2xl"
              style={{ background: "radial-gradient(ellipse, rgba(139,92,246,0.25) 0%, rgba(6,182,212,0.15) 50%, transparent 75%)" }} />
            <div className="overflow-hidden rounded-[1.5rem] border border-white/[0.10] shadow-[0_28px_80px_rgba(0,0,0,0.55)]">
              {poster ? (
                <img src={poster} alt={current.title} className="aspect-[2/3] w-full object-cover" />
              ) : (
                <div className="aspect-[2/3] w-full bg-white/[0.03]" />
              )}
            </div>
          </div>

          {/* ── Info ──────────────────────────────────────────── */}
          <div className="min-w-0">
            {/* eyebrow */}
            <div className="flex items-center gap-2 mb-3">
              <span className="block h-px w-5 rounded-full bg-violet-400/70" />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.25em] text-violet-400/75">
                Em destaque
              </span>
              <span className="text-[9px] text-white/20 ml-1">{String(heroIdx + 1).padStart(2, "0")}/{String(items.length).padStart(2, "0")}</span>
            </div>

            {/* type + year badges */}
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <span className={`text-[9px] font-bold uppercase tracking-wide px-2.5 py-0.5 rounded-full border ${
                isMovie
                  ? "bg-cyan-950/80 border-cyan-500/25 text-cyan-300/80"
                  : "bg-indigo-500/80 border-indigo-400/30 text-indigo-100"
              }`}>
                {isMovie ? "Filme" : "Série"}
              </span>
              {year && <span className="text-[9px] text-white/30 border border-white/[0.08] rounded-full px-2.5 py-0.5">{year}</span>}
              {genres.map(g => (
                <span key={g} className="text-[9px] text-white/25 border border-white/[0.07] rounded-full px-2.5 py-0.5">{g}</span>
              ))}
            </div>

            {/* title */}
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-[-0.04em] text-white/95 leading-tight mb-3 line-clamp-2 max-w-2xl">
              {current.title}
            </h1>

            {/* overview */}
            {current.overview && (
              <p className="text-[13px] sm:text-[14px] text-white/45 leading-relaxed line-clamp-3 mb-5 max-w-xl">
                {current.overview}
              </p>
            )}

            {/* rating row */}
            {current.vote_average > 0 && (
              <div className="flex items-center gap-2 mb-6 flex-wrap">
                <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-950/25 px-3 py-1.5">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span className="text-[13px] font-black text-amber-300 leading-none">{current.vote_average.toFixed(1)}</span>
                  <span className="text-[9px] text-amber-400/45">TMDB</span>
                </div>
                {current.vote_count > 500 && (
                  <span className="text-[10px] text-white/20">{(current.vote_count / 1000).toFixed(0)}k avaliações</span>
                )}
              </div>
            )}

            {/* CTA buttons */}
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={() => onNavigate(current)}
                className="flex items-center gap-2 text-[13px] font-black text-white/90 hover:text-white bg-white/[0.09] hover:bg-white/[0.14] border border-white/[0.12] hover:border-white/[0.20] rounded-2xl px-5 py-2.5 transition-all duration-200"
              >
                Ver título
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
              <button
                type="button"
                className="flex items-center gap-2 text-[13px] font-bold text-teal-300/75 hover:text-teal-200 bg-teal-950/20 hover:bg-teal-950/40 border border-teal-500/20 hover:border-teal-500/35 rounded-2xl px-5 py-2.5 transition-all duration-200"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z" />
                </svg>
                Watchlist
              </button>
            </div>
          </div>
        </div>

        {/* ── Dot navigation ───────────────────────────────────── */}
        <div className="flex items-center justify-center gap-2 mt-10">
          {items.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onDotClick(i)}
              className={`rounded-full transition-all duration-300 ${
                i === heroIdx
                  ? "w-6 h-1.5 bg-white/80"
                  : "w-1.5 h-1.5 bg-white/25 hover:bg-white/45"
              }`}
              aria-label={`Ir para item ${i + 1}`}
            />
          ))}
        </div>
      </div>

      {/* ── Progress bar ─────────────────────────────────────── */}
      <div className="absolute bottom-0 left-0 right-0 h-[2px] bg-white/[0.05]">
        <div
          className="h-full bg-gradient-to-r from-violet-500 via-indigo-400 to-cyan-500"
          style={{ width: `${heroProgress}%`, transition: "none" }}
        />
      </div>
    </section>
  );
}

// ── LoadingSkeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <>
      <div className="relative min-h-[88vh] bg-white/[0.02] animate-pulse" />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 md:px-8 lg:px-10 pb-24 pt-10">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-10">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
        <div className="flex gap-3.5 mb-10">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex-shrink-0 w-[148px] h-[260px] rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-10">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-video rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    </>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const router = useRouter();

  const [data, setData]           = useState<AgendaResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [heroIdx, setHeroIdx]     = useState(0);
  const [heroProgress, setHeroProgress] = useState(0);

  const heroStartRef = useRef(Date.now());

  // ── fetch ─────────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/poplog3/agenda")
      .then(r => r.json())
      .then((d: AgendaResponse) => setData(d))
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  // ── hero items (top 5 by popularity, must have backdrop) ─────────────────

  const heroItems: AgendaItem[] = (() => {
    if (!data) return [];
    const pool: AgendaItem[] = [
      ...(data.nowPlaying ?? []),
      ...(data.onTheAir ?? []),
    ].filter(i => i.backdrop_path);
    return [...pool].sort((a, b) => b.popularity - a.popularity).slice(0, 5);
  })();

  // ── auto-advance hero ─────────────────────────────────────────────────────

  const advanceHero = useCallback((newIdx: number) => {
    setHeroIdx(newIdx);
    heroStartRef.current = Date.now();
    setHeroProgress(0);
  }, []);

  useEffect(() => {
    if (heroItems.length <= 1) return;
    const timer = setInterval(() => {
      setHeroIdx(prev => {
        const next = (prev + 1) % heroItems.length;
        heroStartRef.current = Date.now();
        setHeroProgress(0);
        return next;
      });
    }, HERO_INTERVAL);
    return () => clearInterval(timer);
  }, [heroItems.length]);

  // ── progress bar animation ────────────────────────────────────────────────

  useEffect(() => {
    heroStartRef.current = Date.now();
    const ticker = setInterval(() => {
      const elapsed = Date.now() - heroStartRef.current;
      setHeroProgress(Math.min(100, (elapsed / HERO_INTERVAL) * 100));
    }, 50);
    return () => clearInterval(ticker);
  }, [heroIdx]);

  // ── navigation ────────────────────────────────────────────────────────────

  function navigate(item: AgendaItem) {
    router.push(`/title/${item.media_type}/${item.id}`);
  }

  // ── section data ──────────────────────────────────────────────────────────

  const nowPlaying  = (data?.nowPlaying  ?? []).sort((a, b) => b.popularity - a.popularity);
  const onTheAir    = (data?.onTheAir    ?? []).sort((a, b) => b.popularity - a.popularity);
  const upcoming    = (data?.upcoming    ?? []).sort((a, b) => b.popularity - a.popularity);
  const airingToday = (data?.airingToday ?? []).sort((a, b) => b.popularity - a.popularity) as AgendaTv[];

  const today = new Date().toISOString().slice(0, 10);

  // ── render ────────────────────────────────────────────────────────────────

  if (isLoading) return <LoadingSkeleton />;

  return (
    <div className="min-h-screen">

      {/* ── Hero (full-bleed breakout) ──────────────────────────── */}
      <div className="-mx-4 sm:-mx-6 md:-mx-8 lg:-mx-10">
        {heroItems.length > 0 && (
          <HeroSection
            items={heroItems}
            heroIdx={heroIdx}
            heroProgress={heroProgress}
            onDotClick={i => advanceHero(i)}
            onNavigate={navigate}
          />
        )}
      </div>

      {/* ── Sections ───────────────────────────────────────────── */}
      <div className="max-w-[1600px] mx-auto pb-24 pt-10">

        {/* Stats strip */}
        <StatsStrip
          nowPlaying={nowPlaying.length}
          onTheAir={onTheAir.length}
          upcoming={upcoming.filter(m => m.release_date > today).length}
          airingToday={airingToday.length}
        />

        {/* ── Em Cartaz ───────────────────────────────────────── */}
        {nowPlaying.length > 0 && (
          <section className="mb-10">
            <SectionHeader
              eyebrow="Cinema · Em cartaz"
              eyebrowColor="rose"
              title="Nos cinemas agora"
              count={nowPlaying.length}
              action={<SeeAllBtn onClick={() => router.push("/agenda")} />}
            />
            <HorizontalRail>
              {nowPlaying.map(m => (
                <PosterCard key={m.id} item={m} onClick={() => navigate(m)} />
              ))}
            </HorizontalRail>
          </section>
        )}

        {nowPlaying.length > 0 && onTheAir.length > 0 && <SectionDivider />}

        {/* ── Séries em Alta ──────────────────────────────────── */}
        {onTheAir.length > 0 && (
          <section className="mb-10 mt-10">
            <SectionHeader
              eyebrow="Séries · Esta semana"
              eyebrowColor="indigo"
              title="No ar agora"
              count={onTheAir.length}
              action={<SeeAllBtn onClick={() => router.push("/agenda")} />}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {onTheAir.slice(0, 6).map(t => (
                <BackdropCard key={t.id} item={t} onClick={() => navigate(t)} />
              ))}
            </div>
          </section>
        )}

        {onTheAir.length > 0 && upcoming.length > 0 && <SectionDivider />}

        {/* ── Estreias em Breve ───────────────────────────────── */}
        {upcoming.length > 0 && (
          <section className="mb-10 mt-10">
            <SectionHeader
              eyebrow="Próximas estreias · Cinema"
              eyebrowColor="cyan"
              title="Em breve nas telonas"
              count={upcoming.filter(m => m.release_date > today).length}
              action={<SeeAllBtn onClick={() => router.push("/agenda")} />}
            />
            <HorizontalRail>
              {upcoming.map(m => {
                const days = m.release_date ? daysFromNow(m.release_date) : null;
                const badge = days !== null && days > 0 ? (
                  <span className="text-[8px] font-bold text-white/60 bg-black/50 border border-white/[0.08] rounded px-1.5 py-0.5">
                    {days === 1 ? "Amanhã" : days <= 7 ? `${days} dias` : `${Math.floor(days / 7)} sem.`}
                  </span>
                ) : days !== null && days <= 0 ? (
                  <span className="text-[8px] font-black bg-rose-500 text-white rounded px-1.5 py-0.5">Estreou!</span>
                ) : undefined;

                return (
                  <PosterCard key={m.id} item={m} badge={badge} onClick={() => navigate(m)} />
                );
              })}
            </HorizontalRail>
          </section>
        )}

        {/* ── Hoje na TV ──────────────────────────────────────── */}
        {airingToday.length > 0 && (
          <>
            <SectionDivider />
            <section className="mt-10 mb-4">
              <SectionHeader
                eyebrow="Séries · Hoje"
                eyebrowColor="amber"
                title="Episódios desta noite"
                count={airingToday.length}
                action={<SeeAllBtn onClick={() => router.push("/agenda")} />}
              />
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {airingToday.slice(0, 9).map(t => (
                  <EventRow key={t.id} item={t} onClick={() => navigate(t)} />
                ))}
              </div>
            </section>
          </>
        )}

      </div>
    </div>
  );
}
