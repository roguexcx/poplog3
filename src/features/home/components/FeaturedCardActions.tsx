"use client";

import { useWatchlistToggle } from "@/hooks/useWatchlistToggle";
import { useWatchedToggle } from "@/hooks/useWatchedToggle";
import { CardActionButton } from "@/components/ui/CardActionButton";
import { IconBookmark, IconCheck } from "@/components/ui/icons";

type Props = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  releaseYear: number | null;
};

export default function FeaturedCardActions({
  tmdbId,
  mediaType,
  title,
  releaseYear,
}: Props) {
  const shared = { tmdbId, mediaType, title, releaseYear };
  const watchlist = useWatchlistToggle(shared);
  const watched = useWatchedToggle(shared);

  return (
    <div className="flex items-center gap-2">
      <CardActionButton
        onClick={watchlist.toggle}
        disabled={watchlist.loading || !watchlist.isLoggedIn}
        title={watchlist.inWatchlist ? "Remover da watchlist" : "Adicionar à watchlist"}
        active={watchlist.inWatchlist}
        saving={watchlist.saving}
        activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]"
      >
        <IconBookmark filled={watchlist.inWatchlist} />
      </CardActionButton>

      <CardActionButton
        onClick={watched.toggle}
        disabled={watched.loading || !watched.isLoggedIn}
        title={watched.isWatched ? "Desmarcar como assistido" : "Já vi"}
        active={watched.isWatched}
        saving={watched.saving}
        activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]"
      >
        <IconCheck />
      </CardActionButton>
    </div>
  );
}
