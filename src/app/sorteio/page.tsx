"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import PageShell from "@/components/layout/PageShell";
import type { AgendaMovie, AgendaResponse, AgendaTv } from "@/app/api/poplog3/agenda/route";

type AgendaItem = AgendaMovie | AgendaTv;
type TypeFilter = "all" | "movie" | "tv";
type VibeFilter = "all" | "intense" | "light" | "surprise";

// ── TMDB genre map (pt-BR) ────────────────────────────────────────────────────

const GENRES: Record<number, string> = {
  28: "Ação", 12: "Aventura", 16: "Animação", 35: "Comédia",
  80: "Crime", 99: "Documentário", 18: "Drama", 10751: "Família",
  14: "Fantasia", 27: "Terror", 9648: "Mistério", 10749: "Romance",
  878: "Ficção Científica", 53: "Suspense", 10752: "Guerra",
  10759: "Ação & Aventura", 10765: "Ficção & Fantasia", 36: "História",
};

const INTENSE_GENRES = [18, 80, 53, 27, 9648, 10752];
const LIGHT_GENRES   = [35, 10751, 10749, 16];

// ── helpers ───────────────────────────────────────────────────────────────────

function genreLabels(ids: number[] = []): string[] {
  return ids.slice(0, 3).map(id => GENRES[id]).filter(Boolean);
}

function contextMessage(item: AgendaItem): string {
  const g = item.genre_ids ?? [];
  const v = item.vote_average ?? 0;
  if (g.includes(27)) return "Perfeito pra uma noite de susto";
  if (g.includes(35)) return "Vai te arrancar uma boa risada";
  if (g.includes(878) || g.includes(10765)) return "Uma viagem para outro universo";
  if (g.includes(80) || g.includes(53)) return "Tensão do começo ao fim";
  if (g.includes(10751)) return "Ideal pra assistir em família";
  if (g.includes(18)) return "Uma história que fica com você";
  if (v >= 8.5) return "Nota impressionante · Quase perfeito";
  if (v >= 8.0) return "Muito bem avaliado · Difícil de parar";
  if (item.media_type === "tv") return "Série em alta agora";
  return "Bom pra assistir hoje à noite";
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function IMG(path: string | null | undefined, size: string): string | null {
  return path ? `https://image.tmdb.org/t/p/${size}${path}` : null;
}

function releaseYear(item: AgendaItem): string | null {
  const d = "release_date" in item ? item.release_date : item.first_air_date;
  return d?.slice(0, 4) ?? null;
}

// ── FilterPill ────────────────────────────────────────────────────────────────

function FilterPill({
  label, active, accent = false, onClick,
}: {
  label: string;
  active: boolean;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[11px] font-bold px-3 py-1.5 rounded-full border transition-all duration-200 whitespace-nowrap ${
        active && accent
          ? "bg-violet-500/15 border-violet-500/30 text-violet-200"
          : active
          ? "bg-white/[0.09] border-white/[0.16] text-white/85"
          : "bg-transparent border-white/[0.07] text-white/30 hover:text-white/55 hover:border-white/[0.12]"
      }`}
    >
      {label}
    </button>
  );
}

// ── QuickModeCard ─────────────────────────────────────────────────────────────

function QuickModeCard({
  icon, label, sub, active, onClick,
}: {
  icon: string;
  label: string;
  sub: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 flex flex-col items-start gap-1 rounded-2xl border px-4 py-3.5 transition-all duration-200 min-w-[140px] text-left ${
        active
          ? "bg-white/[0.07] border-white/[0.18] text-white/90"
          : "bg-white/[0.02] border-white/[0.06] text-white/40 hover:bg-white/[0.04] hover:border-white/[0.1] hover:text-white/65"
      }`}
    >
      <span className="text-[20px] leading-none">{icon}</span>
      <span className="text-[12.5px] font-black tracking-tight leading-tight mt-1">{label}</span>
      <span className="text-[9.5px] text-white/25 leading-snug">{sub}</span>
    </button>
  );
}

// ── GhostCard (back of deck) ──────────────────────────────────────────────────

function GhostCard({ depth }: { depth: 1 | 2 }) {
  const offset = depth === 1 ? 14 : 28;
  const scaleX = depth === 1 ? 0.96 : 0.92;
  const opacity = depth === 1 ? 0.45 : 0.22;

  return (
    <div
      className="absolute inset-x-0 inset-y-0 rounded-[24px] border border-white/[0.06] bg-gradient-to-b from-white/[0.025] to-white/[0.01]"
      style={{
        transform: `translateY(${offset}px) scaleX(${scaleX})`,
        transformOrigin: "bottom center",
        opacity,
        zIndex: depth === 1 ? 1 : 0,
        pointerEvents: "none",
      }}
    />
  );
}

// ── MainCard ──────────────────────────────────────────────────────────────────

function MainCard({
  item,
  cardNumber,
  animOut,
  isSaved,
  onNavigate,
  onSkip,
  onSave,
}: {
  item: AgendaItem;
  cardNumber: number;
  animOut: boolean;
  isSaved: boolean;
  onNavigate: () => void;
  onSkip: () => void;
  onSave: () => void;
}) {
  const poster   = IMG(item.poster_path, "w342");
  const backdrop = IMG(item.backdrop_path, "w780");
  const year     = releaseYear(item);
  const genres   = genreLabels(item.genre_ids);
  const msg      = contextMessage(item);
  const isMovie  = item.media_type === "movie";

  return (
    <div
      className="relative z-10 rounded-[24px] overflow-hidden border border-white/[0.09] bg-[#0b0b13] transition-[transform,opacity] duration-300 ease-in-out"
      style={{
        opacity: animOut ? 0 : 1,
        transform: animOut
          ? "translateX(-44px) scale(0.97)"
          : "translateX(0) scale(1)",
      }}
    >
      {/* Backdrop bleed */}
      {backdrop && (
        <div className="absolute inset-0 pointer-events-none">
          <img src={backdrop} alt="" className="h-full w-full object-cover opacity-[0.18]" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#0b0b13]/98 via-[#0b0b13]/85 to-[#0b0b13]/55" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#0b0b13]/95 via-transparent to-transparent" />
        </div>
      )}

      <div className="relative flex flex-col sm:flex-row min-h-[400px] sm:min-h-[440px]">

        {/* ── Poster column ───────────────────────────── */}
        <div className="relative flex-shrink-0 sm:w-[190px] h-[200px] sm:h-auto overflow-hidden">
          {poster ? (
            <img
              src={poster}
              alt={item.title}
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <div className="h-full w-full bg-white/[0.04]" />
          )}

          {/* gradient fade to card body */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[#0b0b13] sm:bg-none" />
          <div className="absolute inset-0 hidden sm:block bg-gradient-to-r from-transparent to-[#0b0b13]/60" />

          {/* card number */}
          <div className="absolute top-3 left-3">
            <span className="text-[8px] font-black uppercase tracking-[0.2em] px-2 py-1 rounded-full bg-black/60 backdrop-blur-sm text-white/40 border border-white/[0.09]">
              {String(cardNumber).padStart(2, "0")}
            </span>
          </div>

          {/* type badge */}
          <div className="absolute top-3 right-3">
            <span className={`text-[8px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
              isMovie
                ? "bg-cyan-950/80 border-cyan-500/25 text-cyan-300/75"
                : "bg-indigo-950/80 border-indigo-500/25 text-indigo-300/75"
            }`}>
              {isMovie ? "Filme" : "Série"}
            </span>
          </div>
        </div>

        {/* ── Details column ──────────────────────────── */}
        <div className="relative flex-1 flex flex-col justify-between p-5 sm:p-7 sm:pl-6">

          {/* top: metadata + title */}
          <div>
            {/* genre + year chips */}
            <div className="flex items-center gap-2 mb-3.5 flex-wrap">
              {genres.map(g => (
                <span
                  key={g}
                  className="text-[9px] text-white/30 border border-white/[0.08] rounded-full px-2.5 py-0.5"
                >
                  {g}
                </span>
              ))}
              {year && (
                <span className="text-[9px] text-white/20">{year}</span>
              )}
            </div>

            {/* title */}
            <h2 className="text-[22px] sm:text-[27px] font-black tracking-[-0.04em] text-white/95 leading-tight mb-3 line-clamp-3">
              {item.title}
            </h2>

            {/* overview */}
            {item.overview && (
              <p className="text-[12px] text-white/38 leading-relaxed line-clamp-3 mb-5 max-w-[420px]">
                {item.overview}
              </p>
            )}

            {/* rating */}
            {item.vote_average > 0 && (
              <div className="flex items-center gap-2.5 mb-5 flex-wrap">
                <div className="flex items-center gap-1.5 rounded-xl border border-amber-500/20 bg-amber-950/25 px-3 py-1.5">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
                    <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                  </svg>
                  <span className="text-[13px] font-black text-amber-300 leading-none">
                    {item.vote_average.toFixed(1)}
                  </span>
                  <span className="text-[9px] text-amber-400/45">TMDB</span>
                </div>

                {item.vote_count > 1000 && (
                  <span className="text-[10px] text-white/20">
                    {(item.vote_count / 1000).toFixed(0)}k votos
                  </span>
                )}
              </div>
            )}
          </div>

          {/* bottom: context + actions */}
          <div>
            {/* context message */}
            <div className="inline-flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.025] px-3.5 py-2 mb-5">
              <span className="w-1.5 h-1.5 rounded-full bg-violet-400/70 flex-shrink-0" />
              <span className="text-[10.5px] text-white/45 italic">"{msg}"</span>
            </div>

            {/* action buttons */}
            <div className="flex items-center gap-2.5 flex-wrap">
              <button
                type="button"
                onClick={onSkip}
                className="text-[12px] font-bold text-white/30 hover:text-white/55 border border-white/[0.07] hover:border-white/[0.12] rounded-xl px-4 py-2 transition-all duration-200"
              >
                Pular
              </button>

              <button
                type="button"
                onClick={onSave}
                className={`text-[12px] font-bold rounded-xl px-4 py-2 transition-all duration-200 border ${
                  isSaved
                    ? "text-teal-200 border-teal-500/35 bg-teal-950/40"
                    : "text-teal-300/65 hover:text-teal-200 border-teal-500/20 hover:border-teal-500/35 bg-teal-950/15 hover:bg-teal-950/30"
                }`}
              >
                {isSaved ? "Guardado ✓" : "Guardar"}
              </button>

              <button
                type="button"
                onClick={onNavigate}
                className="flex items-center gap-2 text-[12px] font-bold text-white/75 hover:text-white bg-white/[0.06] hover:bg-white/[0.10] border border-white/[0.09] hover:border-white/[0.15] rounded-xl px-4 py-2 transition-all duration-200"
              >
                Ver título
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── SortearButton ─────────────────────────────────────────────────────────────

function SortearButton({
  onClick,
  isAnimating,
}: {
  onClick: () => void;
  isAnimating: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={isAnimating}
      className="group relative flex items-center justify-center gap-3 rounded-2xl border border-white/[0.10] bg-white/[0.04] hover:bg-white/[0.075] hover:border-white/[0.17] transition-all duration-250 px-10 py-4 disabled:opacity-40 disabled:pointer-events-none overflow-hidden min-w-[220px]"
    >
      {/* shimmer sweep on hover */}
      <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/[0.05] to-transparent pointer-events-none" />

      {/* radial glow center */}
      <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
        style={{ background: "radial-gradient(ellipse at 50% 50%, rgba(139,92,246,0.08), transparent 70%)" }}
      />

      {isAnimating ? (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-white/50 animate-spin flex-shrink-0">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
      ) : (
        /* dice icon */
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="text-white/55 flex-shrink-0">
          <rect x="2" y="2" width="20" height="20" rx="5" />
          <circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="16" cy="8" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="8" cy="16" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
        </svg>
      )}

      <span className="text-[15px] font-black tracking-[-0.02em] text-white/78">
        {isAnimating ? "Sorteando..." : "Sortear algo"}
      </span>

      {!isAnimating && (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-white/28 flex-shrink-0">
          <path d="M9 18l6-6-6-6" />
        </svg>
      )}
    </button>
  );
}

// ── LoadingSkeleton ───────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="flex flex-col items-center gap-8 pt-6 pb-16">
      <div className="w-full h-[440px] rounded-[24px] bg-white/[0.03] animate-pulse" />
      <div className="w-52 h-[52px] rounded-2xl bg-white/[0.03] animate-pulse" />
      <div className="flex gap-3 w-full">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex-1 h-[92px] rounded-2xl bg-white/[0.03] animate-pulse" />
        ))}
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function SorteioPage() {
  const router = useRouter();

  const [rawPool, setRawPool]           = useState<AgendaItem[]>([]);
  const [currentIdx, setCurrentIdx]     = useState(0);
  const [isLoading, setIsLoading]       = useState(true);
  const [isAnimating, setIsAnimating]   = useState(false);
  const [animOut, setAnimOut]           = useState(false);
  const [typeFilter, setTypeFilter]     = useState<TypeFilter>("all");
  const [vibeFilter, setVibeFilter]     = useState<VibeFilter>("all");
  const [activeMode, setActiveMode]     = useState<string | null>(null);
  const [savedKeys, setSavedKeys]       = useState<Set<string>>(new Set());

  // ── fetch pool ─────────────────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/poplog3/agenda")
      .then(r => r.json())
      .then((d: AgendaResponse) => {
        const all: AgendaItem[] = [
          ...(d.nowPlaying ?? []),
          ...(d.upcoming ?? []),
          ...(d.airingToday ?? []),
          ...(d.onTheAir ?? []),
        ];
        // deduplicate
        const seen = new Set<string>();
        const deduped = all.filter(item => {
          const key = `${item.media_type}-${item.id}`;
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
        setRawPool(shuffle(deduped));
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  // ── filtered pool ──────────────────────────────────────────────────────────

  const pool = useMemo(() => {
    let filtered = typeFilter === "all"
      ? rawPool
      : rawPool.filter(i => i.media_type === typeFilter);

    if (vibeFilter === "intense") {
      const sub = filtered.filter(i => INTENSE_GENRES.some(g => i.genre_ids?.includes(g)));
      if (sub.length > 0) filtered = sub;
    } else if (vibeFilter === "light") {
      const sub = filtered.filter(i => LIGHT_GENRES.some(g => i.genre_ids?.includes(g)));
      if (sub.length > 0) filtered = sub;
    }

    return filtered.length > 0 ? filtered : rawPool;
  }, [rawPool, typeFilter, vibeFilter]);

  // clamp currentIdx when pool shrinks
  const safeIdx  = pool.length > 0 ? currentIdx % pool.length : 0;
  const current  = pool[safeIdx];
  const ghost1   = pool[(safeIdx + 1) % pool.length];
  const ghost2   = pool[(safeIdx + 2) % pool.length];

  // ── backdrop for page BG ───────────────────────────────────────────────────

  const currentBackdrop = current ? IMG(current.backdrop_path, "w1280") : null;

  // ── actions ────────────────────────────────────────────────────────────────

  const advance = useCallback(() => {
    setCurrentIdx(i => (i + 1) % Math.max(pool.length, 1));
  }, [pool.length]);

  const handleSortear = useCallback(() => {
    if (isAnimating || pool.length === 0) return;
    setIsAnimating(true);
    setAnimOut(true);
    setTimeout(() => {
      advance();
      setAnimOut(false);
      setTimeout(() => setIsAnimating(false), 300);
    }, 300);
  }, [isAnimating, pool.length, advance]);

  function handleSave() {
    if (!current) return;
    const key = `${current.media_type}-${current.id}`;
    setSavedKeys(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  function handleNavigate() {
    if (!current) return;
    router.push(`/title/${current.media_type}/${current.id}`);
  }

  function handleQuickMode(key: string) {
    const isDeselect = activeMode === key;
    setActiveMode(isDeselect ? null : key);

    if (isDeselect) {
      setVibeFilter("all");
      return;
    }

    if (key === "surprise") {
      setTypeFilter("all");
      setVibeFilter("surprise");
    } else if (key === "intense") {
      setVibeFilter("intense");
    } else if (key === "light") {
      setVibeFilter("light");
    }
    // "quick" — no duration data in pool yet, treat as surprise
    if (key === "quick") {
      setTypeFilter("all");
      setVibeFilter("all");
    }

    // trigger a new draw
    setTimeout(handleSortear, 50);
  }

  function handleTypeFilter(t: TypeFilter) {
    setTypeFilter(t);
    setActiveMode(null);
    setCurrentIdx(0);
  }

  function handleVibeFilter(v: VibeFilter) {
    setVibeFilter(v);
    setActiveMode(null);
    setCurrentIdx(0);
  }

  // ── render ─────────────────────────────────────────────────────────────────

  const currentKey = current ? `${current.media_type}-${current.id}` : "";

  return (
    /* full-bleed wrapper — breaks out of PageShell padding for background */
    <div className="relative -mx-4 sm:-mx-6 md:-mx-8 lg:-mx-10 overflow-visible">

      {/* ── Cinematic background ────────────────────────────────────── */}
      <div className="absolute inset-0 -z-10 overflow-hidden">
        {/* animated backdrop blur */}
        {currentBackdrop && (
          <img
            key={currentBackdrop}
            src={currentBackdrop}
            alt=""
            className="absolute inset-0 h-full w-full object-cover blur-[120px] scale-125 opacity-[0.13] transition-opacity duration-1000"
          />
        )}
        {/* gradient veil */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/65 via-black/85 to-black/98" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-black/50" />
        {/* subtle grid texture */}
        <div
          className="absolute inset-0 opacity-[0.018]"
          style={{
            backgroundImage:
              "linear-gradient(0deg,white 1px,transparent 1px),linear-gradient(90deg,white 1px,transparent 1px)",
            backgroundSize: "52px 52px",
          }}
        />
      </div>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <div className="max-w-[920px] mx-auto px-4 sm:px-6 md:px-8 lg:px-10 pb-24">

        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="pt-8 pb-7">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <span className="block h-px w-5 rounded-full bg-violet-400/60" />
                <p className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-violet-400/75">
                  Ritual de descoberta
                </p>
              </div>
              <h1 className="text-[44px] sm:text-[52px] font-black tracking-[-0.05em] text-white/92 leading-none">
                Sorteio
              </h1>
              <p className="text-[12px] text-white/30 mt-1.5 leading-snug max-w-xs">
                {pool.length > 0
                  ? `${pool.length} títulos no pool atual`
                  : "Carregando títulos…"}
              </p>
            </div>

            {/* source mode toggle */}
            <div className="flex-shrink-0 flex items-center gap-1 rounded-2xl border border-white/[0.08] bg-white/[0.025] p-1 mt-1.5">
              <button
                type="button"
                className="text-[11px] font-bold px-3.5 py-1.5 rounded-xl bg-white/[0.09] text-white/80 border border-white/[0.07] transition-all"
              >
                Descoberta
              </button>
              <button
                type="button"
                className="text-[11px] font-bold px-3.5 py-1.5 rounded-xl text-white/28 hover:text-white/50 transition-colors"
              >
                Biblioteca
              </button>
            </div>
          </div>

          {/* filter pills row */}
          <div className="flex items-center gap-2 mt-5 flex-wrap">
            <FilterPill label="Qualquer" active={typeFilter === "all"} onClick={() => handleTypeFilter("all")} />
            <FilterPill label="Filmes" active={typeFilter === "movie"} onClick={() => handleTypeFilter("movie")} />
            <FilterPill label="Séries" active={typeFilter === "tv"} onClick={() => handleTypeFilter("tv")} />

            <div className="h-4 w-px bg-white/[0.07] mx-1" />

            <FilterPill label="Qualquer vibe" active={vibeFilter === "all"} onClick={() => handleVibeFilter("all")} />
            <FilterPill label="Algo intenso" active={vibeFilter === "intense"} accent onClick={() => handleVibeFilter("intense")} />
            <FilterPill label="Algo leve" active={vibeFilter === "light"} accent onClick={() => handleVibeFilter("light")} />
          </div>
        </div>

        {/* ── Deck ──────────────────────────────────────────────────── */}
        {isLoading ? (
          <LoadingSkeleton />
        ) : pool.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <p className="text-[16px] text-white/35">Nenhum título disponível no momento.</p>
          </div>
        ) : (
          <>
            {/* Card stack */}
            <div className="relative mb-10" style={{ paddingBottom: "32px" }}>
              {/* ghost cards (z=0,1) — purely visual depth */}
              {ghost2 && <GhostCard depth={2} />}
              {ghost1 && <GhostCard depth={1} />}

              {/* main card (z=10) */}
              {current && (
                <MainCard
                  item={current}
                  cardNumber={(safeIdx % 99) + 1}
                  animOut={animOut}
                  isSaved={savedKeys.has(currentKey)}
                  onNavigate={handleNavigate}
                  onSkip={handleSortear}
                  onSave={handleSave}
                />
              )}
            </div>

            {/* Sortear button */}
            <div className="flex justify-center mb-12">
              <SortearButton onClick={handleSortear} isAnimating={isAnimating} />
            </div>

            {/* ── Quick modes ────────────────────────────────── */}
            <div>
              <div className="flex items-center gap-2 mb-4">
                <span className="block h-px w-5 rounded-full bg-white/15" />
                <p className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-white/22">
                  Modos rápidos
                </p>
              </div>

              <div className="-mx-4 sm:mx-0">
                <div className="flex gap-2.5 overflow-x-auto px-4 sm:px-0 pb-2 no-scrollbar">
                  <QuickModeCard
                    icon="⚡"
                    label="Pouco tempo"
                    sub="Rápido de terminar"
                    active={activeMode === "quick"}
                    onClick={() => handleQuickMode("quick")}
                  />
                  <QuickModeCard
                    icon="🎲"
                    label="Surpreenda-me"
                    sub="Sem filtros, puro acaso"
                    active={activeMode === "surprise"}
                    onClick={() => handleQuickMode("surprise")}
                  />
                  <QuickModeCard
                    icon="🔥"
                    label="Algo intenso"
                    sub="Drama · Suspense · Crime"
                    active={activeMode === "intense"}
                    onClick={() => handleQuickMode("intense")}
                  />
                  <QuickModeCard
                    icon="🌙"
                    label="Algo leve"
                    sub="Comédia · Família · Romance"
                    active={activeMode === "light"}
                    onClick={() => handleQuickMode("light")}
                  />
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
