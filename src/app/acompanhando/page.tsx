"use client";

import { useMemo, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useCuradoriaEngine } from "@/hooks/useCuradoriaEngine";
import HeroSpotlight from "@/components/HeroSpotlight";
import PageShell from "@/components/layout/PageShell";
import type { ScoredItem } from "@/components/HeroSpotlight/types";

// ─── helpers (lógica original preservada) ────────────────────────────────────

function getMediaType(item: ScoredItem) {
  return item.content_type === "filme" ? "movie" : "tv";
}

function getTmdbId(item: ScoredItem) {
  return item.content_id.replace("tmdb-tv-", "").replace("tmdb-movie-", "");
}

function getProgress(item: ScoredItem) {
  if (item.content_type === "filme") {
    if (!item.runtime) return 0;
    return Math.min(
      Math.round(((item.watch_progress_minutes ?? 0) / item.runtime) * 100),
      100
    );
  }
  if (!item.total_episodes_season) return 0;
  return Math.min(
    Math.round(((item.episodes_watched ?? 0) / item.total_episodes_season) * 100),
    100
  );
}

function getRemainingLabel(item: ScoredItem) {
  if (item.content_type === "filme") {
    if (!item.runtime) return "Filme";
    const watched = item.watch_progress_minutes ?? 0;
    const remaining = Math.max(item.runtime - watched, 0);
    if (remaining <= 0) return "Pronto para concluir";
    if (watched > 0) return `${remaining} min restantes`;
    return `${item.runtime} min`;
  }
  const watched = item.episodes_watched ?? 0;
  const total = item.total_episodes_season ?? 0;
  if (!total) return "Série";
  const remaining = Math.max(total - watched, 0);
  if (remaining === 1) return "1 episódio restante";
  if (remaining > 1) return `${remaining} episódios restantes`;
  return "Temporada concluída";
}

function getContextLine(item: ScoredItem): { text: string; accent: "purple" | "pink" | "amber" | "teal" | "muted" } {
  if (item.new_episode_available) {
    return { text: "Novo episódio disponível", accent: "pink" };
  }
  if (item.content_type === "serie") {
    const watched = item.episodes_watched ?? 0;
    const total = item.total_episodes_season ?? 0;
    const remaining = Math.max(total - watched, 0);
    if (remaining === 1) return { text: "Último episódio da temporada", accent: "amber" };
    if (remaining <= 3) return { text: `Reta final · ${remaining} eps restantes`, accent: "amber" };
    if (item.status === "paused") {
      const label = getRemainingLabel(item);
      return { text: `Você parou aqui · ${label}`, accent: "muted" };
    }
    if (remaining > 0) {
      const label = getRemainingLabel(item);
      return { text: label, accent: "purple" };
    }
  }
  if (item.content_type === "filme") {
    const p = getProgress(item);
    if (p > 0) return { text: `${p}% assistido · ${getRemainingLabel(item)}`, accent: "purple" };
    return { text: getRemainingLabel(item), accent: "teal" };
  }
  return { text: getRemainingLabel(item), accent: "muted" };
}

function getEpisodeLabel(item: ScoredItem) {
  if (item.content_type !== "serie") return null;
  const season = item.current_season;
  const episode = (item.current_episode ?? 0) + 1;
  if (!season) return null;
  return `T${season}E${episode}`;
}

function getStatusBadge(item: ScoredItem): { label: string; variant: "watching" | "new" | "finale" | "paused" | "watchlist" } {
  if (item.new_episode_available) return { label: "Novo ep!", variant: "new" };
  if (item.status === "paused") return { label: "Em pausa", variant: "paused" };
  if (item.status === "watchlist") return { label: "Watchlist", variant: "watchlist" };
  if (item.content_type === "serie") {
    const remaining = Math.max((item.total_episodes_season ?? 0) - (item.episodes_watched ?? 0), 0);
    if (remaining <= 3 && remaining > 0) return { label: "Reta final", variant: "finale" };
  }
  return { label: "Assistindo", variant: "watching" };
}

// ─── design tokens ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  watching: "bg-violet-500/80 text-violet-100 border-violet-400/30",
  new:      "bg-rose-500/85 text-rose-100 border-rose-400/30",
  finale:   "bg-amber-500/80 text-amber-100 border-amber-400/30",
  paused:   "bg-white/10 text-white/55 border-white/10",
  watchlist:"bg-teal-600/60 text-teal-100 border-teal-400/20",
};

const ACCENT_PROGRESS: Record<string, string> = {
  purple: "from-violet-500 to-violet-300",
  pink:   "from-rose-500 to-rose-300",
  amber:  "from-amber-500 to-amber-300",
  teal:   "from-teal-500 to-teal-300",
  muted:  "from-white/35 to-white/20",
};

const ACCENT_TEXT: Record<string, string> = {
  purple: "text-violet-300",
  pink:   "text-rose-300",
  amber:  "text-amber-300",
  teal:   "text-teal-300",
  muted:  "text-white/40",
};

// ─── primitives ───────────────────────────────────────────────────────────────

function SectionEyebrow({ children, color = "purple" }: { children: React.ReactNode; color?: "purple" | "amber" | "teal" | "pink" | "muted" }) {
  const cls = {
    purple: "text-violet-400/80",
    amber:  "text-amber-400/80",
    teal:   "text-teal-400/80",
    pink:   "text-rose-400/80",
    muted:  "text-white/30",
  }[color];
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${color === "purple" ? "bg-violet-400/60" : color === "amber" ? "bg-amber-400/60" : color === "teal" ? "bg-teal-400/60" : color === "pink" ? "bg-rose-400/60" : "bg-white/20"}`} />
      <p className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${cls}`}>{children}</p>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  eyebrowColor = "purple",
  title,
  count,
  action,
}: {
  eyebrow: string;
  eyebrowColor?: "purple" | "amber" | "teal" | "pink" | "muted";
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-end justify-between mb-5">
      <div>
        <SectionEyebrow color={eyebrowColor}>{eyebrow}</SectionEyebrow>
        <h2 className="text-xl font-black tracking-[-0.03em] text-white/90 leading-tight">
          {title}
        </h2>
      </div>
      <div className="flex items-center gap-3 pb-0.5">
        {count !== undefined && (
          <span className="text-[11px] text-white/25 border border-white/10 rounded-full px-2.5 py-0.5">
            {count} {count === 1 ? "título" : "títulos"}
          </span>
        )}
        {action}
      </div>
    </div>
  );
}

function SeeAllBtn({ onClick }: { onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[11px] text-white/30 hover:text-white/60 transition-colors flex items-center gap-1"
    >
      Ver todos
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18l6-6-6-6" />
      </svg>
    </button>
  );
}

// ─── SmartStatBar ─────────────────────────────────────────────────────────────

function SmartStatBar({ items }: { items: ScoredItem[] }) {
  const watching    = items.filter(i => i.status === "watching").length;
  const paused      = items.filter(i => i.status === "paused").length;
  const newEp       = items.filter(i => i.new_episode_available).length;
  const finalStretch = items.filter(i => {
    if (i.content_type !== "serie") return false;
    const rem = (i.total_episodes_season ?? 0) - (i.episodes_watched ?? 0);
    return rem > 0 && rem <= 4 && i.status === "watching";
  }).length;
  const watchlistReady = items.filter(i => i.status === "watchlist").length;

  const stats = [
    { value: watching,      label: "Em andamento",   sub: newEp > 0 ? `${newEp} com ep novo` : null, accent: true },
    { value: paused,        label: "Em pausa",        sub: "Pode retomar",             accent: false },
    { value: finalStretch,  label: "Reta final",      sub: "Poucos eps restantes",     accent: false },
    { value: watchlistReady,label: "Watchlist",       sub: "Prontos pra começar",      accent: false },
  ];

  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4 mb-10">
      {stats.map((s) => (
        <div
          key={s.label}
          className={`rounded-2xl border px-4 py-3.5 ${
            s.accent
              ? "bg-violet-950/40 border-violet-500/20"
              : "bg-white/[0.025] border-white/[0.06]"
          }`}
        >
          <p className={`text-2xl font-black tracking-tight leading-none mb-1 ${s.accent ? "text-violet-200" : "text-white/80"}`}>
            {s.value}
          </p>
          <p className="text-[11px] text-white/40 leading-snug">{s.label}</p>
          {s.sub && (
            <p className={`text-[10px] mt-1 ${s.accent ? "text-violet-400/70" : "text-white/25"}`}>
              {s.sub}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── PosterCard ───────────────────────────────────────────────────────────────

function PosterCard({ item, onClick }: { item: ScoredItem; onClick: () => void }) {
  const progress = getProgress(item);
  const ctx = getContextLine(item);
  const badge = getStatusBadge(item);
  const epLabel = getEpisodeLabel(item);
  const dominantColor = item.dominant_color ?? "#1a1040";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex-shrink-0 w-[148px] sm:w-[160px] text-left"
    >
      <div
        className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/[0.07] mb-2.5"
        style={{ background: dominantColor }}
      >
        {item.poster_path && (
          <img
            src={`https://image.tmdb.org/t/p/w342${item.poster_path}`}
            alt={item.title}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />

        <div className="absolute top-2 left-2 right-2 flex items-start justify-between gap-1">
          <span className={`text-[8.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md border ${STATUS_BADGE[badge.variant]}`}>
            {badge.label}
          </span>
          {item.tmdb_rating && (
            <span className="flex items-center gap-0.5 text-[9px] font-bold text-amber-300">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
              {item.tmdb_rating.toFixed(1)}
            </span>
          )}
        </div>

        {epLabel && (
          <span className="absolute top-8 left-2 text-[8.5px] font-mono font-bold text-white/60 border border-white/10 bg-black/40 backdrop-blur-sm rounded px-1.5 py-0.5">
            {epLabel}
          </span>
        )}

        <div className="absolute bottom-0 left-0 right-0 px-2 pb-2">
          {progress > 0 && (
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-white/45 truncate">{getRemainingLabel(item)}</span>
              <span className="text-[9px] text-white/45 ml-1">{progress}%</span>
            </div>
          )}
          <div className="h-[2px] w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className={`h-full rounded-full bg-gradient-to-r ${ACCENT_PROGRESS[ctx.accent]}`}
              style={{ width: `${Math.max(progress, 3)}%` }}
            />
          </div>
        </div>
      </div>

      <div className="px-0.5">
        <p className="text-[12.5px] font-bold text-white/85 leading-tight tracking-[-0.02em] line-clamp-1 mb-1">
          {item.title}
        </p>
        <div className={`text-[10px] leading-snug line-clamp-2 rounded-md px-2 py-1.5 border ${
          ctx.accent === "pink"   ? "bg-rose-950/40 border-rose-500/15 text-rose-300/80" :
          ctx.accent === "amber"  ? "bg-amber-950/40 border-amber-500/15 text-amber-300/80" :
          ctx.accent === "teal"   ? "bg-teal-950/40 border-teal-500/15 text-teal-300/70" :
          ctx.accent === "purple" ? "bg-violet-950/40 border-violet-500/15 text-violet-300/80" :
          "bg-white/[0.03] border-white/[0.06] text-white/35"
        }`}>
          {ctx.text}
        </div>
      </div>
    </button>
  );
}

// ─── ContinueCard ─────────────────────────────────────────────────────────────

function ContinueCard({ item, onClick }: { item: ScoredItem; onClick: () => void }) {
  const progress = getProgress(item);
  const ctx = getContextLine(item);
  const epLabel = getEpisodeLabel(item);
  const dominantColor = item.dominant_color ?? "#1a1040";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full text-left rounded-2xl border border-white/[0.07] bg-white/[0.025] hover:bg-white/[0.045] hover:border-white/[0.13] transition-all duration-300 p-3 overflow-hidden"
    >
      <div
        className="absolute inset-0 opacity-10 blur-3xl pointer-events-none"
        style={{ background: `radial-gradient(ellipse at 80% 50%, ${dominantColor}, transparent 70%)` }}
      />

      <div className="relative flex gap-3.5">
        <div
          className="relative h-[116px] w-[82px] flex-shrink-0 rounded-xl overflow-hidden"
          style={{ background: dominantColor }}
        >
          {item.poster_path && (
            <img
              src={`https://image.tmdb.org/t/p/w300${item.poster_path}`}
              alt={item.title}
              className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.05]"
              loading="lazy"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
          {epLabel && (
            <span className="absolute bottom-1.5 left-1.5 text-[8px] font-mono font-bold text-white/70 border border-white/15 bg-black/50 rounded px-1 py-0.5">
              {epLabel}
            </span>
          )}
        </div>

        <div className="flex flex-col justify-between min-w-0 flex-1 py-0.5">
          <div>
            <div className="flex items-center gap-1.5 mb-2 flex-wrap">
              {item.new_episode_available && (
                <span className="text-[8.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-rose-500/80 text-rose-100 border border-rose-400/30">
                  Novo ep
                </span>
              )}
              {item.content_type === "serie" && epLabel && (
                <span className="text-[8.5px] font-mono font-bold text-white/40 border border-white/10 bg-white/[0.04] rounded-full px-2 py-0.5">
                  {epLabel}
                </span>
              )}
              <span className={`text-[8.5px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
                item.status === "paused" ? "bg-white/[0.06] text-white/35 border border-white/[0.08]" :
                "bg-violet-500/15 text-violet-300/80 border border-violet-500/20"
              }`}>
                {item.status === "paused" ? "Retomar" : "Continuar"}
              </span>
            </div>

            <h3 className="text-[15px] font-black tracking-[-0.03em] text-white/90 leading-tight line-clamp-2 mb-1">
              {item.title}
            </h3>

            {item.next_episode_name && (
              <p className="text-[11px] text-white/35 line-clamp-1 italic">
                "{item.next_episode_name}"
              </p>
            )}
          </div>

          <div className="mt-2">
            <div className="flex items-center justify-between mb-1.5">
              <span className={`text-[10px] font-medium ${ACCENT_TEXT[ctx.accent]}`}>
                {ctx.text}
              </span>
              {progress > 0 && (
                <span className="text-[10px] text-white/30">{progress}%</span>
              )}
            </div>
            <div className="h-[2px] w-full rounded-full bg-white/10 overflow-hidden">
              <div
                className={`h-full rounded-full bg-gradient-to-r ${ACCENT_PROGRESS[ctx.accent]}`}
                style={{ width: `${Math.max(progress, 4)}%` }}
              />
            </div>
            {item.streaming_platform && (
              <p className="text-[10px] text-white/20 mt-1.5">{item.streaming_platform}</p>
            )}
          </div>
        </div>
      </div>
    </button>
  );
}

// ─── NewEpisodeCard ───────────────────────────────────────────────────────────

function NewEpisodeCard({ item, onClick }: { item: ScoredItem; onClick: () => void }) {
  const epLabel = getEpisodeLabel(item);
  const dominantColor = item.dominant_color ?? "#1a1040";
  const progress = getProgress(item);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full text-left rounded-2xl overflow-hidden border border-rose-500/15 bg-rose-950/10 hover:bg-rose-950/20 hover:border-rose-500/25 transition-all duration-300"
    >
      {item.backdrop_path && (
        <div className="absolute inset-0 opacity-15">
          <img
            src={`https://image.tmdb.org/t/p/w780${item.backdrop_path}`}
            alt=""
            className="h-full w-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-black/90 via-black/60 to-transparent" />
        </div>
      )}
      {!item.backdrop_path && (
        <div
          className="absolute inset-0 opacity-20"
          style={{ background: `radial-gradient(ellipse at 90% 50%, ${dominantColor}, transparent 60%)` }}
        />
      )}

      <div className="relative flex gap-3.5 p-3.5">
        <div
          className="relative h-20 w-[118px] flex-shrink-0 rounded-lg overflow-hidden"
          style={{ background: dominantColor }}
        >
          {(item.next_episode_still_path || item.poster_path) && (
            <img
              src={`https://image.tmdb.org/t/p/w300${item.next_episode_still_path ?? item.poster_path}`}
              alt={item.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col justify-center">
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[8px] font-black uppercase tracking-widest px-2 py-0.5 rounded-full bg-rose-500 text-white">
              Novo
            </span>
            {epLabel && (
              <span className="text-[9px] font-mono font-bold text-white/40 border border-white/10 rounded px-1.5 py-0.5">
                {epLabel}
              </span>
            )}
          </div>

          <h3 className="text-[14px] font-black tracking-tight text-white/90 line-clamp-1 mb-0.5">
            {item.title}
          </h3>

          {item.next_episode_name && (
            <p className="text-[11px] text-white/40 line-clamp-1 italic mb-2">
              "{item.next_episode_name}"
            </p>
          )}

          <div className="h-[2px] w-full rounded-full bg-white/10 overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-rose-500 to-rose-300"
              style={{ width: `${Math.max(progress, 4)}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col items-end justify-center gap-1 flex-shrink-0">
          {item.streaming_platform && (
            <span className="text-[10px] text-white/35">{item.streaming_platform}</span>
          )}
          {item.next_episode_duration && (
            <span className="text-[10px] text-white/30">{item.next_episode_duration}min</span>
          )}
          <svg className="text-rose-400/60 mt-1" width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </div>
    </button>
  );
}

// ─── AbandonAlert ─────────────────────────────────────────────────────────────

function AbandonAlert({ item, onClick }: { item: ScoredItem; onClick: () => void }) {
  const remaining = Math.max(
    (item.total_episodes_season ?? 0) - (item.episodes_watched ?? 0),
    0
  );

  if (remaining === 0) return null;

  return (
    <div className="rounded-2xl border border-amber-500/15 bg-amber-950/15 p-4 flex items-center gap-4">
      <div className="w-9 h-9 rounded-xl bg-amber-500/15 border border-amber-500/20 flex items-center justify-center flex-shrink-0 text-base">
        ⏸
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-black text-amber-200/80 mb-0.5 leading-tight">
          Você parou no meio — {item.title}
        </p>
        <p className="text-[11px] text-white/35 leading-snug">
          Faltam apenas <span className="text-amber-300/70 font-semibold">{remaining} {remaining === 1 ? "episódio" : "episódios"}</span> para terminar a temporada.
          {item.status === "paused" ? " Vale retomar hoje?" : ""}
        </p>
      </div>
      <button
        type="button"
        onClick={onClick}
        className="flex-shrink-0 text-[11px] font-bold text-amber-300/80 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-xl px-3 py-2 transition-colors whitespace-nowrap"
      >
        Retomar
      </button>
    </div>
  );
}

// ─── FranchiseCard ────────────────────────────────────────────────────────────

function FranchiseCard({
  franchise,
  onClick,
}: {
  franchise: { id: number; name: string; poster_path: string | null; items: ScoredItem[] };
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex-shrink-0 w-[148px] sm:w-[160px] text-left"
    >
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden border border-white/[0.07] mb-2.5 bg-white/[0.04]">
        {franchise.poster_path && (
          <img
            src={`https://image.tmdb.org/t/p/w342${franchise.poster_path}`}
            alt={franchise.name}
            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]"
            loading="lazy"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute bottom-2 left-2">
          <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-md bg-indigo-500/70 text-indigo-100 border border-indigo-400/30">
            {franchise.items.length} {franchise.items.length === 1 ? "filme" : "filmes"}
          </span>
        </div>
      </div>
      <p className="text-[12.5px] font-bold text-white/85 leading-tight tracking-[-0.02em] line-clamp-2 px-0.5">
        {franchise.name}
      </p>
    </button>
  );
}

// ─── HorizontalRail ───────────────────────────────────────────────────────────

function HorizontalRail({
  items,
  onNavigate,
}: {
  items: ScoredItem[];
  onNavigate: (item: ScoredItem) => void;
}) {
  return (
    <div className="-mx-4 sm:-mx-6 md:-mx-8 lg:mx-0">
      <div className="flex gap-3.5 overflow-x-auto px-4 sm:px-6 md:px-8 lg:px-0 pb-3 no-scrollbar">
        {items.map((item) => (
          <PosterCard key={item.content_id} item={item} onClick={() => onNavigate(item)} />
        ))}
      </div>
    </div>
  );
}

// ─── SectionDivider ───────────────────────────────────────────────────────────

function SectionDivider() {
  return (
    <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent" />
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <section className="flex min-h-[40vh] flex-col items-center justify-center rounded-[28px] border border-white/[0.08] bg-white/[0.02] px-8 py-16 text-center">
      <div className="mb-6 w-14 h-14 rounded-2xl border border-white/10 bg-white/[0.04] flex items-center justify-center">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-white/25">
          <path d="M15 10l4.553-2.069A1 1 0 0121 8.87V15.13a1 1 0 01-1.447.9L15 14M3 8a2 2 0 012-2h10a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h3 className="text-[18px] font-black tracking-tight text-white/50 mb-2">
        Sua vitrine está vazia
      </h3>
      <p className="text-[13px] text-white/25 max-w-sm leading-relaxed">
        Adicione filmes e séries à sua biblioteca para ativar a central de continuidade da POPLOG.
      </p>
    </section>
  );
}

// ─── LoadingSkeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <PageShell variant="wide">
      <div className="space-y-8">
        <div className="h-[480px] rounded-[28px] bg-white/[0.03] animate-pulse" />

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-px w-5 rounded-full bg-white/[0.06]" />
            <div className="h-2.5 w-20 rounded-full bg-white/[0.04] animate-pulse" />
          </div>
          <div className="h-5 w-16 rounded-full bg-white/[0.03] animate-pulse" />
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-[116px] rounded-2xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>

        <div className="flex gap-3.5 overflow-hidden">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="w-[148px] shrink-0 aspect-[2/3] rounded-xl bg-white/[0.03] animate-pulse" />
          ))}
        </div>
      </div>
    </PageShell>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function AcompanhandoPage() {
  const router = useRouter();

  // 1. CARREGAMENTO DOS ITENS GERAIS DA BIBLIOTECA
  const { items, isLoading, snoozeItem, logSignal } =
  useCuradoriaEngine();

  // 2. CONEXÃO ISOLADA COM O NOVO ENDPOINT SERVER-DRIVEN DO HERO CONTINUIDADE
  const [heroItems, setHeroItems] = useState<ScoredItem[]>([]);
  const [isHeroLoading, setIsHeroLoading] = useState(true);

  useEffect(() => {
    fetch("/api/poplog3/continuity/hero")
      .then((res) => res.json())
      .then((data) => {
        if (data && data.candidates) {
          setHeroItems(data.candidates);
        }
      })
      .catch((err) => console.error("[AcompanhandoPage] Falha ao hidratar o Hero Spotlight:", err))
      .finally(() => setIsHeroLoading(false));
  }, []);

  const heroIds = useMemo(() => {
    return new Set(heroItems.map((item) => String(item.content_id ?? item.id)));
  }, [heroItems]);

  const sectionItems = useMemo(() => {
    return items.filter((item) => {
      const itemId = String(item.content_id ?? item.id);
      return !heroIds.has(itemId);
    });
  }, [items, heroIds]);

  const {
    newEpisodeItems,
    resumeOrFinishItems,
    continuingItems,
    watchlistSuggestions,
    rediscoveryItems,
    quickTonightItems,
    franchiseGroups,
    abandonAlert,
  } = useMemo(() => {
    const watching  = sectionItems.filter(i => i.status === "watching");
    const paused    = sectionItems.filter(i => i.status === "paused");
    const watchlist = sectionItems.filter(i => i.status === "watchlist");
    const abandoned = sectionItems.filter(i => i.status === "abandoned");

    // 1. Novos Episódios: Filtra séries usando a flag estrita calibrada de novidade real
    const newEps = sectionItems.filter(i => i.new_episode_available && i.content_type === "serie");

    // 2. Continuar de onde parou: Títulos em andamento ativo, removendo duplicidades que têm episódios novos
    const continuing = watching.filter((i) => !i.new_episode_available);

    // 3. Sessões rápidas de hoje à noite
    const quick = sectionItems.filter(i => {
      if (i.content_type === "filme") {
        if (!i.available_on_vod && !i.streaming_platform) return false;
        const rem = (i.runtime ?? 0) - (i.watch_progress_minutes ?? 0);
        return rem > 0 && rem <= 75;
      }
      return (i.next_episode_duration ?? 0) > 0 && (i.next_episode_duration ?? 0) <= 35;
    });

    // 4. Retomar / Quase lá: Curadoria de andamento perto da reta final
    const finales = watching.filter(i => {
      if (i.content_type !== "serie") return false;
      const rem = (i.total_episodes_season ?? 0) - (i.episodes_watched ?? 0);
      return rem > 0 && rem <= 4;
    });
    const pausedNearEnd = paused.filter(i => {
      const rem = (i.total_episodes_season ?? 0) - (i.episodes_watched ?? 0);
      return rem > 0 && rem <= 5;
    });
    const otherPaused = paused.filter(i => {
      const rem = (i.total_episodes_season ?? 0) - (i.episodes_watched ?? 0);
      return rem === 0 || rem > 5;
    });

    // 5. Agrupamento estruturado de Franquias e Universos colecionáveis
    const franchiseMap = new Map<number, { id: number; name: string; poster_path: string | null; items: ScoredItem[] }>();
    for (const item of sectionItems) {
      if (item.content_type !== "filme" || !item.belongs_to_collection) continue;
      const col = item.belongs_to_collection;
      const existing = franchiseMap.get(col.id);
      if (existing) {
        existing.items.push(item);
      } else {
        franchiseMap.set(col.id, { id: col.id, name: col.name, poster_path: col.poster_path, items: [item] });
      }
    }

    // 6. Alerta de abandono (Prioriza séries paradas perto do fim da temporada)
    const alertCandidate = [...paused, ...abandoned].find(i => {
      if (i.content_type !== "serie") return false;
      const rem = (i.total_episodes_season ?? 0) - (i.episodes_watched ?? 0);
      return rem > 0 && rem <= 5;
    }) ?? null;

    return {
      newEpisodeItems:      newEps.slice(0, 6),
      resumeOrFinishItems:  [...finales, ...pausedNearEnd, ...otherPaused].slice(0, 12),
      continuingItems:      continuing.slice(0, 12),
      watchlistSuggestions: watchlist.slice(0, 12),
      rediscoveryItems:     [...paused.slice(0, 4), ...abandoned.slice(0, 6)].slice(0, 10),
      quickTonightItems:    quick.slice(0, 10),
      franchiseGroups:      Array.from(franchiseMap.values()),
      abandonAlert:         alertCandidate,
    };
  }, [sectionItems]);

  function handleNavigate(item: ScoredItem) {
    router.push(`/title/${getMediaType(item)}/${getTmdbId(item)}`);
  }

  // Exibe o esqueleto se qualquer uma das duas fontes de dados estiver carregando
  if (isLoading || isHeroLoading) return <LoadingSkeleton />;

  return (
    <PageShell variant="wide">
      <div className="flex flex-col gap-0">

        {/* ── Hero Spotlight Inteligente Conectado ──────────────────── */}
        <div className="mb-10">
          <HeroSpotlight
            items={heroItems}
            onSnooze={snoozeItem}
            onLogSignal={logSignal}
            onNavigate={handleNavigate}
          />
        </div>

        {/* ── Empty state ────────────────────────────────────────────── */}
        {items.length === 0 && <EmptyState />}

        {items.length > 0 && (
          <>
            {/* ── Biblioteca identity strip ────────────────────────── */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <span className="h-px w-5 rounded-full bg-violet-400/60" />
                <p className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-violet-400/80">
                  Biblioteca
                </p>
              </div>
              <span className="text-[11px] text-white/20 border border-white/[0.06] rounded-full px-2.5 py-0.5">
                {items.length} {items.length === 1 ? "título" : "títulos"}
              </span>
            </div>

            {/* ── Smart stats ──────────────────────────────────────── */}
            <SmartStatBar items={items} />

            {/* ── Novo episódio ────────────────────────────────────── */}
            {newEpisodeItems.length > 0 && (
              <section className="mb-10">
                <SectionHeader
                  eyebrow="Disponível agora"
                  eyebrowColor="pink"
                  title="Novos episódios esperando"
                  count={newEpisodeItems.length}
                />
                <div className="grid gap-2.5 md:grid-cols-2">
                  {newEpisodeItems.map(item => (
                    <NewEpisodeCard
                      key={item.content_id}
                      item={item}
                      onClick={() => handleNavigate(item)}
                    />
                  ))}
                </div>
              </section>
            )}

            {newEpisodeItems.length > 0 && continuingItems.length > 0 && <SectionDivider />}

            {/* ── Em andamento ────────────────────────────────────── */}
            {continuingItems.length > 0 && (
              <section className="mb-10 mt-10">
                <SectionHeader
                  eyebrow="Em andamento"
                  eyebrowColor="purple"
                  title="Continue de onde parou"
                  count={continuingItems.length}
                  action={<SeeAllBtn />}
                />
                <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                  {continuingItems.slice(0, 6).map(item => (
                    <ContinueCard
                      key={item.content_id}
                      item={item}
                      onClick={() => handleNavigate(item)}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* ── Anti-abandon alert ──────────────────────────────── */}
            {abandonAlert && (
              <div className="mb-10">
                <AbandonAlert item={abandonAlert} onClick={() => handleNavigate(abandonAlert)} />
              </div>
            )}

            {/* ── Retomar · Quase lá (reta final + pausa mescladas) ─ */}
            {resumeOrFinishItems.length > 0 && (
              <>
                <SectionDivider />
                <section className="mb-10 mt-10">
                  <SectionHeader
                    eyebrow="Retomar · Quase lá"
                    eyebrowColor="amber"
                    title="Não deixe para depois"
                    count={resumeOrFinishItems.length}
                  />
                  <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                    {resumeOrFinishItems.slice(0, 6).map(item => (
                      <ContinueCard
                        key={item.content_id}
                        item={item}
                        onClick={() => handleNavigate(item)}
                      />
                    ))}
                  </div>
                </section>
              </>
            )}

            {/* ── Sessões rápidas ─────────────────────────────────── */}
            {quickTonightItems.length > 0 && (
              <>
                <SectionDivider />
                <section className="mb-10 mt-10">
                  <SectionHeader
                    eyebrow="Para hoje à noite"
                    eyebrowColor="teal"
                    title="Sessões rápidas"
                    count={quickTonightItems.length}
                  />
                  <HorizontalRail items={quickTonightItems} onNavigate={handleNavigate} />
                </section>
              </>
            )}

            {/* ── Franquias ───────────────────────────────────────── */}
            {franchiseGroups.length > 0 && (
              <>
                <SectionDivider />
                <section className="mb-10 mt-10">
                  <SectionHeader
                    eyebrow="Coleções · Universos"
                    eyebrowColor="purple"
                    title="Franquias na sua biblioteca"
                    count={franchiseGroups.length}
                  />
                  <div className="-mx-4 sm:-mx-6 md:-mx-8 lg:mx-0">
                    <div className="flex gap-3.5 overflow-x-auto px-4 sm:px-6 md:px-8 lg:px-0 pb-3 no-scrollbar">
                      {franchiseGroups.map(franchise => (
                        <FranchiseCard
                          key={franchise.id}
                          franchise={franchise}
                          onClick={() => router.push(`/franquia/${franchise.id}`)}
                        />
                      ))}
                    </div>
                  </div>
                </section>
              </>
            )}

            {/* ── Watchlist ───────────────────────────────────────── */}
            {watchlistSuggestions.length > 0 && (
              <>
                <SectionDivider />
                <section className="mb-10 mt-10">
                  <SectionHeader
                    eyebrow="Watchlist · Sugestões contextuais"
                    eyebrowColor="teal"
                    title="Bom momento para começar"
                    count={watchlistSuggestions.length}
                    action={<SeeAllBtn />}
                  />
                  <HorizontalRail items={watchlistSuggestions} onNavigate={handleNavigate} />
                </section>
              </>
            )}

            {/* ── Redescoberta ────────────────────────────────────── */}
            {rediscoveryItems.length > 0 && (
              <>
                <SectionDivider />
                <section className="mb-4 mt-10">
                  <SectionHeader
                    eyebrow="Redescoberta"
                    eyebrowColor="muted"
                    title="Talvez valha revisitar"
                    count={rediscoveryItems.length}
                  />
                  <HorizontalRail items={rediscoveryItems} onNavigate={handleNavigate} />
                </section>
              </>
            )}

          </>
        )}
      </div>
    </PageShell>
  );
}