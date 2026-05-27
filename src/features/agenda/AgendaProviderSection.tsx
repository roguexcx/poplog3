"use client";

import type { AgendaEvent } from "@/server/agenda/types";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";

type Props = {
  providerName: string;
  events: AgendaEvent[];
  onSelect?: (event: AgendaEvent) => void;
};

function ProviderEventCard({
  event,
  onSelect,
}: {
  event: AgendaEvent;
  onSelect?: (event: AgendaEvent) => void;
}) {
  const { mainTitle } = useRandomizedTitleDisplay(event.title, event.originalTitle);
  return (
    <button
      type="button"
      onClick={() => onSelect?.(event)}
      className="w-40 shrink-0 text-left"
    >
      <div className="aspect-[2/3] overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08]">
        {event.posterPath && (
          <img
            src={`https://image.tmdb.org/t/p/w342${event.posterPath}`}
            alt=""
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium text-white">{mainTitle}</h3>
    </button>
  );
}

export default function AgendaProviderSection({
  providerName,
  events,
  onSelect,
}: Props) {
  if (events.length === 0) return null;

  return (
    <section className="space-y-3">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">{providerName} esta semana</h2>
        <span className="text-sm text-white/45">{events.length}</span>
      </header>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {events.map((event) => (
          <ProviderEventCard key={event.id} event={event} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}
