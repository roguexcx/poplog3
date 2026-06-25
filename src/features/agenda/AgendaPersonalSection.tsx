"use client";
import type { AgendaEvent } from "@/server/agenda/types";
import HiatusReturnBanner from "@/features/agenda/cards/HiatusReturnBanner";
import SeasonFinaleCard from "@/features/agenda/cards/SeasonFinaleCard";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";

function PersonalEventCard({
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
      className="rounded-lg border border-white/[0.08] bg-white/[0.04] p-4 text-left transition hover:border-white/20 hover:bg-white/[0.07]"
    >
      <p className="text-sm text-white/45">{event.airDate ?? "Sem data"}</p>
      <h3 className="mt-1 font-semibold text-white">{mainTitle}</h3>
      {event.episodeName && (
        <p className="mt-1 line-clamp-1 text-sm text-white/60">
          {event.episodeName}
        </p>
      )}
    </button>
  );
}

type Props = {
  title?: string;
  events: AgendaEvent[];
  onSelect?: (event: AgendaEvent) => void;
};

export default function AgendaPersonalSection({
  title = "Minha agenda",
  events,
  onSelect,
}: Props) {
  if (events.length === 0) return null;

  return (
    <section className="space-y-4">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-rose-300">
            Continuidade
          </p>
          <h2 className="text-2xl font-semibold text-white">{title}</h2>
        </div>
        <span className="text-sm text-white/45">{events.length}</span>
      </header>

      <div className="grid gap-3 md:grid-cols-2">
        {events.map((event) =>
          event.type === "hiatus_return" ? (
            <HiatusReturnBanner key={event.id} event={event} onSelect={onSelect} />
          ) : event.type === "season_finale" ? (
            <SeasonFinaleCard key={event.id} event={event} onSelect={onSelect} />
          ) : (
            <PersonalEventCard key={event.id} event={event} onSelect={onSelect} />
          ),
        )}
      </div>
    </section>
  );
}
