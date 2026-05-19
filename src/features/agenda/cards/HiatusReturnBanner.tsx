"use client";

import type { AgendaEvent } from "@/server/agenda/types";

type Props = {
  event: AgendaEvent;
  onSelect?: (event: AgendaEvent) => void;
};

export default function HiatusReturnBanner({ event, onSelect }: Props) {
  return (
    <button
      type="button"
      onClick={() => onSelect?.(event)}
      className="rounded-lg border border-cyan-300/20 bg-cyan-950/25 p-4 text-left transition hover:border-cyan-200/45"
    >
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-200">
        Retorno de hiato
      </p>
      <h3 className="mt-2 text-lg font-semibold text-white">{event.title}</h3>
      <p className="mt-1 text-sm text-white/60">
        {event.airDate ?? "Data a confirmar"}
        {event.episodeName ? ` · ${event.episodeName}` : ""}
      </p>
    </button>
  );
}
