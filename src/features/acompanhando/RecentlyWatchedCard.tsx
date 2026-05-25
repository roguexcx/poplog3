"use client";

import type { RecentlyWatchedItem } from "@/app/api/poplog3/continuity/recently-watched/route";

export type { RecentlyWatchedItem };

type Props = {
  item: RecentlyWatchedItem;
  onClick: () => void;
};

function formatRelativeDate(iso: string): string {
  const now = Date.now();
  const diff = now - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return "agora";
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h atrás`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "ontem";
  if (days < 7) return `${days}d atrás`;
  if (days < 30) return `${Math.floor(days / 7)}sem atrás`;
  return `${Math.floor(days / 30)}m atrás`;
}

export default function RecentlyWatchedCard({ item, onClick }: Props) {
  // Prioridade: still do episódio → backdrop da série → vazio
  const stillUrl = item.last_episode_still_path
    ? `https://image.tmdb.org/t/p/w300${item.last_episode_still_path}`
    : item.backdrop_path
      ? `https://image.tmdb.org/t/p/w300${item.backdrop_path}`
      : null;

  const relDate = formatRelativeDate(item.watched_at);

  return (
    <button
      type="button"
      onClick={onClick}
      className="group relative flex items-stretch overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-900/70 text-left transition-all hover:border-white/[0.15] hover:bg-zinc-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30"
    >
      {/* Still — proporção 16:9, largura fixa */}
      <div className="relative shrink-0 overflow-hidden bg-white/[0.04]" style={{ width: 96, aspectRatio: "16/9" }}>
        {stillUrl ? (
          <img
            src={stillUrl}
            alt=""
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <span className="text-[9px] font-bold text-white/15">SEM STILL</span>
          </div>
        )}
        {/* Gradiente direito para fundir com o conteúdo */}
        <div className="absolute inset-y-0 right-0 w-4 bg-gradient-to-r from-transparent to-zinc-900/80 transition-colors group-hover:to-zinc-900" />
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2.5">
        <p className="truncate text-[12px] font-black leading-tight tracking-[-0.01em] text-white">
          {item.title}
        </p>
        {item.last_season != null && item.last_episode != null && (
          <p className="mt-0.5 text-[10px] font-bold text-white/40">
            T{item.last_season}E{item.last_episode}
            {item.last_episode_name ? (
              <span className="font-normal text-white/28"> · &ldquo;{item.last_episode_name}&rdquo;</span>
            ) : null}
          </p>
        )}
        <p className="mt-1 text-[9px] font-semibold tabular-nums text-white/22">{relDate}</p>
      </div>
    </button>
  );
}
