"use client";

import type { NewEpisodeItem } from "@/features/acompanhando/NewEpisodeCard";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";

export type { NewEpisodeItem };

type Props = {
  item: NewEpisodeItem;
  onClick: () => void;
};

function epTag(s: number | null, e: number | null) {
  if (s == null || e == null) return null;
  return `T${s}E${e}`;
}

function temporalBadge(
  daysSince: number | null,
  airDate: string | null,
): { text: string; variant: "now" | "recent" | "old" } | null {
  if (daysSince === 0) return { text: "Hoje", variant: "now" };
  if (daysSince === 1) return { text: "Ontem", variant: "recent" };
  if (daysSince != null && daysSince <= 7) return { text: `${daysSince}d atrás`, variant: "recent" };
  if (daysSince != null) return { text: `${daysSince} dias`, variant: "old" };
  if (airDate) {
    const d = new Date(airDate + "T12:00:00");
    return { text: d.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" }), variant: "old" };
  }
  return null;
}

export default function AgendaNewEpisodeCard({ item, onClick }: Props) {
  const { mainTitle } = useRandomizedTitleDisplay(item.title, item.original_title);
  const backdropUrl = item.next_episode_still_path
    ? `https://image.tmdb.org/t/p/w780${item.next_episode_still_path}`
    : item.backdrop_path
      ? `https://image.tmdb.org/t/p/w780${item.backdrop_path}`
      : null;

  const posterUrl = item.poster_path
    ? `https://image.tmdb.org/t/p/w92${item.poster_path}`
    : null;

  const tag = epTag(item.next_season, item.next_episode);
  const badge = temporalBadge(item.days_since_new_episode, item.next_episode_air_date);
  const pct = Math.min(100, Math.max(0, item.progress_pct));

  const badgeClass =
    badge?.variant === "now"
      ? "bg-rose-500 text-white"
      : badge?.variant === "recent"
        ? "bg-rose-500/20 text-rose-300 ring-1 ring-rose-500/30"
        : "bg-white/[0.06] text-white/40 ring-1 ring-white/10";

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative w-full overflow-hidden rounded-2xl border border-white/[0.08] bg-zinc-900/80 text-left transition-all duration-300 hover:border-white/[0.15] hover:bg-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
    >
      {/* Backdrop */}
      {backdropUrl && (
        <div className="absolute inset-0">
          <img
            src={backdropUrl}
            alt=""
            className="h-full w-full object-cover opacity-30 brightness-75 transition-opacity duration-300 group-hover:opacity-40"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/90 via-zinc-950/55 to-zinc-950/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/80 via-transparent to-transparent" />
        </div>
      )}

      <div className="relative flex min-h-[96px] items-stretch">
        {/* Poster faixa lateral */}
        {posterUrl && (
          <div
            className="relative shrink-0 self-stretch overflow-hidden rounded-l-2xl"
            style={{ width: 64 }}
          >
            <img src={posterUrl} alt="" className="h-full w-full object-cover" />
            {tag && (
              <div className="absolute inset-x-0 bottom-0 flex justify-center pb-1.5">
                <span className="rounded-full bg-black/75 px-1.5 py-0.5 text-[9px] font-black text-white/90 backdrop-blur-sm">
                  {tag}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Conteúdo */}
        <div className="flex min-w-0 flex-1 flex-col justify-between px-3.5 py-3.5">
          {/* Badges superiores */}
          <div className="flex flex-wrap items-center gap-1.5">
            {badge && (
              <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.14em] ${badgeClass}`}>
                {badge.text}
              </span>
            )}
            {!posterUrl && tag && (
              <span className="rounded-full border border-white/[0.15] bg-white/[0.07] px-2 py-0.5 text-[10px] font-bold text-white/70">
                {tag}
              </span>
            )}
          </div>

          {/* Título e episódio */}
          <div className="mt-1 min-w-0">
            <p className="truncate text-[14px] font-black leading-tight tracking-[-0.02em] text-white">
              {mainTitle}
            </p>
            {item.next_episode_name && (
              <p className="mt-0.5 truncate text-[11.5px] leading-tight text-white/45">
                &ldquo;{item.next_episode_name}&rdquo;
              </p>
            )}
          </div>

          {/* Rodapé: episódios pendentes + play */}
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <p className="text-[10.5px] text-white/30">
              {item.episodes_behind === 1
                ? "1 ep. por assistir"
                : `${item.episodes_behind} eps. por assistir`}
            </p>
            <span
              aria-hidden
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/[0.07] text-white/55 transition-all duration-200 group-hover:bg-rose-500/80 group-hover:text-white"
            >
              <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 translate-x-[1px]">
                <path d="M5 3.5l8 4.5-8 4.5V3.5z" />
              </svg>
            </span>
          </div>
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="h-[3px] w-full overflow-hidden bg-white/[0.05]">
        {pct > 0 && (
          <div
            className="h-full bg-gradient-to-r from-rose-400 via-pink-400 to-fuchsia-400"
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
    </button>
  );
}
