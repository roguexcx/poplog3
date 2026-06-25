"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import type { AgendaEvent } from "@/server/agenda/types";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";
import TmdbImage from "@/components/images/TmdbImage";
type Props = {
    providerName: string;
    events: AgendaEvent[];
    onSelect?: (event: AgendaEvent) => void;
};
function ProviderEventCard({ event, onSelect, }: {
    event: AgendaEvent;
    onSelect?: (event: AgendaEvent) => void;
}) {
    const { mainTitle } = useRandomizedTitleDisplay(event.title, event.originalTitle);
    return (<button type="button" onClick={() => onSelect?.(event)} className="w-40 shrink-0 text-left">
      <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-white/[0.04] ring-1 ring-white/[0.08]">
        <TmdbImage path={event.posterPath} kind="poster" size="card" alt="" fill className="object-cover"/>
      </div>
      <h3 className="mt-2 line-clamp-2 text-sm font-medium text-white">{mainTitle}</h3>
    </button>);
}
export default function AgendaProviderSection({ providerName, events, onSelect, }: Props) {
    if (events.length === 0)
        return null;
    return (<section className="space-y-3">
      <header className="flex items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-white">{providerName}{uiMessage("ui.e2136a1c422b")}</h2>
        <span className="text-sm text-white/45">{events.length}</span>
      </header>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {events.map((event) => (<ProviderEventCard key={event.id} event={event} onSelect={onSelect}/>))}
      </div>
    </section>);
}

