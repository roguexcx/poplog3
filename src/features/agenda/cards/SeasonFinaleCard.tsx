"use client";

import type { AgendaEvent } from "@/server/agenda/types";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";
import TmdbImage from "@/components/images/TmdbImage";

type Props = {
  event: AgendaEvent;
  onSelect?: (event: AgendaEvent) => void;
};

export default function SeasonFinaleCard({ event, onSelect }: Props) {
  const { mainTitle } = useRandomizedTitleDisplay(event.title, event.originalTitle);
  const image = event.episodeStillPath ?? event.backdropPath;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(event)}
      className="group relative min-h-44 overflow-hidden rounded-lg border border-rose-400/25 bg-rose-950/30 p-5 text-left transition hover:border-rose-300/50"
    >
      <TmdbImage
        path={image}
        kind="backdrop"
        size="medium"
        alt=""
        fill
        className="object-cover opacity-35 transition group-hover:opacity-45"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950 via-zinc-950/75 to-zinc-950/20" />
      <div className="relative">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-200">
          Season finale
        </p>
        <h3 className="mt-2 text-xl font-semibold text-white">{mainTitle}</h3>
        <p className="mt-1 text-sm text-white/65">
          T{event.seasonNumber}E{event.episodeNumber}
          {event.episodeName ? ` · ${event.episodeName}` : ""}
        </p>
      </div>
    </button>
  );
}
