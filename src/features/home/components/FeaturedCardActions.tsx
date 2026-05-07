"use client";

import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";

type Props = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  releaseYear: number | null;
};

function IconBookmark({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2.2}
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function FeaturedCardActions({
  tmdbId,
  mediaType,
  title,
  releaseYear,
}: Props) {
  const shared = {
    tmdbId,
    mediaType,
    title,
    releaseYear,
  };

  const watchlist = useWatchlistToggle(shared);
  const watched = useWatchedToggle(shared);

  const btnBase =
    "grid h-9 w-9 place-items-center rounded-full border backdrop-blur-[10px] transition-[transform,background,border-color,box-shadow] duration-200 hover:scale-110 disabled:opacity-50";

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          watchlist.toggle();
        }}
        disabled={watchlist.loading || watchlist.saving || !watchlist.isLoggedIn}
        title={
          watchlist.inWatchlist
            ? "Remover da watchlist"
            : "Adicionar à watchlist"
        }
        aria-label={
          watchlist.inWatchlist
            ? "Remover da watchlist"
            : "Adicionar à watchlist"
        }
        className={[
          btnBase,
          watchlist.inWatchlist
            ? "border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
            : "border-white/[0.18] bg-white/5 text-white/85 hover:border-violet-500/60 hover:bg-white/10 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]",
        ].join(" ")}
      >
        {watchlist.saving ? (
          <span className="text-[10px]">…</span>
        ) : (
          <IconBookmark filled={watchlist.inWatchlist} />
        )}
      </button>

      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          watched.toggle();
        }}
        disabled={watched.loading || watched.saving || !watched.isLoggedIn}
        title={watched.isWatched ? "Desmarcar como assistido" : "Já vi"}
        aria-label={watched.isWatched ? "Desmarcar como assistido" : "Já vi"}
        className={[
          btnBase,
          watched.isWatched
            ? "border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
            : "border-white/[0.18] bg-white/5 text-white/85 hover:border-emerald-500/60 hover:bg-white/10 hover:text-emerald-300 hover:shadow-[0_0_12px_rgba(52,211,153,0.3)]",
        ].join(" ")}
      >
        {watched.saving ? <span className="text-[10px]">…</span> : <IconCheck />}
      </button>
    </div>
  );
}