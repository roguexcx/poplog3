"use client";

import { uiMessage } from "@/lib/i18n/ui-message";
import type { RadarBucketId, RadarEvent, RadarFilter, RadarMode, RadarPayload, RadarSection } from "@/server/radar-trakt/types";
import {
  Bell,
  CalendarDays,
  ChevronRight,
  Clock3,
  Compass,
  Film,
  Filter,
  Library,
  Loader2,
  PlayCircle,
  Radar,
  Search,
  Sparkles,
  Star,
  Tv,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";

type RadarV2ClientProps = {
  initialPayload: RadarPayload | null;
  initialMode: RadarMode;
  region: string;
  language: string;
};

type SmartBlockId = "for_me" | "following" | "today" | "week" | "soon" | "discover";

const SECTION_ORDER: RadarBucketId[] = ["now", "highlights", "week", "next", "anticipated", "recent"];
const BLOCK_ORDER: SmartBlockId[] = ["for_me", "following", "today", "week", "soon", "discover"];

const CONTENT_ICON: Partial<Record<RadarEvent["mediaType"], typeof Tv>> = {
  show: Tv,
  episode: PlayCircle,
  movie: Film,
};

const BLOCK_META: Record<SmartBlockId, { title: string; desc: string; icon: typeof Radar }> = {
  for_me: {
    title: uiMessage("radar.v2.block.for_me"),
    desc: uiMessage("radar.v2.block.for_me.desc"),
    icon: Sparkles,
  },
  following: {
    title: uiMessage("radar.v2.block.following"),
    desc: uiMessage("radar.v2.block.following.desc"),
    icon: Library,
  },
  today: {
    title: uiMessage("radar.v2.block.today"),
    desc: uiMessage("radar.v2.block.today.desc"),
    icon: CalendarDays,
  },
  week: {
    title: uiMessage("radar.v2.block.week"),
    desc: uiMessage("radar.v2.block.week.desc"),
    icon: Clock3,
  },
  soon: {
    title: uiMessage("radar.v2.block.soon"),
    desc: uiMessage("radar.v2.block.soon.desc"),
    icon: Bell,
  },
  discover: {
    title: uiMessage("radar.v2.block.discover"),
    desc: uiMessage("radar.v2.block.discover.desc"),
    icon: Compass,
  },
};

function eventDate(event: RadarEvent): number {
  const time = new Date(event.date).getTime();
  return Number.isFinite(time) ? time : 0;
}

function shortDate(date: string, language: string) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat(language, { day: "2-digit", month: "short" }).format(parsed);
}

function eventHref(event: RadarEvent): string {
  const slug = event.ids.slug?.trim();
  if (slug) return `/${slug.replace(/^\/+/, "")}`;
  const id = event.ids.imdb ?? event.ids.poplog ?? event.ids.tmdb ?? event.titleId;
  const mediaType = event.mediaType === "movie" ? "movie" : "tv";
  return `/title/${mediaType}/${id}`;
}

function uniqueEvents(events: RadarEvent[]): RadarEvent[] {
  const seen = new Set<string>();
  const result: RadarEvent[] = [];
  for (const event of events) {
    const key = event.ids.imdb ?? event.ids.slug ?? event.id;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(event);
  }
  return result;
}

function sectionItems(payload: RadarPayload | null, ids: RadarBucketId[]): RadarEvent[] {
  if (!payload) return [];
  return uniqueEvents(
    ids.flatMap((id) => payload.sections[id]?.items ?? [])
      .sort((a, b) => b.score - a.score || eventDate(a) - eventDate(b)),
  );
}

function smartBlocks(payload: RadarPayload | null): Record<SmartBlockId, RadarEvent[]> {
  if (!payload) {
    return { for_me: [], following: [], today: [], week: [], soon: [], discover: [] };
  }

  const following = uniqueEvents(
    sectionItems(payload, SECTION_ORDER)
      .filter((event) => event.ids.imdb || event.ids.trakt || event.ids.tmdb)
      .slice(0, 18),
  );

  return {
    for_me: payload.mode === "personal"
      ? sectionItems(payload, ["now", "highlights", "week"]).slice(0, 18)
      : sectionItems(payload, ["highlights", "now"]).slice(0, 12),
    following: payload.mode === "personal" ? following : [],
    today: sectionItems(payload, ["now"]).slice(0, 18),
    week: sectionItems(payload, ["week"]).slice(0, 24),
    soon: sectionItems(payload, ["next", "anticipated"]).slice(0, 24),
    discover: sectionItems(payload, ["highlights", "recent"]).slice(0, 24),
  };
}

function normalizedFilters(filters: RadarFilter[]) {
  return filters
    .filter((filter) => filter.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 18);
}

function matchesFilter(event: RadarEvent, filterId: string | null) {
  if (!filterId) return true;
  return event.filters.includes(filterId) ||
    event.contentType === filterId ||
    event.eventType === filterId ||
    event.releaseType === filterId ||
    event.bucket === filterId;
}

function MiniStat({ label, value, icon: Icon }: { label: string; value: string | number; icon: typeof Radar }) {
  return (
    <div className="min-w-0 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] font-semibold text-zinc-500">
        <Icon size={13} className="shrink-0 text-indigo-300" />
        <span className="truncate">{label}</span>
      </div>
      <p className="mt-1 truncate text-base font-black text-white">{value}</p>
    </div>
  );
}

function EventCard({ event, language, priority = false }: { event: RadarEvent; language: string; priority?: boolean }) {
  const Icon = CONTENT_ICON[event.mediaType] ?? Radar;
  const image = event.poster || event.backdrop;
  const episodeLabel = event.seasonNumber && event.episodeNumber
    ? `T${event.seasonNumber} E${event.episodeNumber}`
    : event.episodeRange || event.label;

  return (
    <Link
      href={eventHref(event)}
      className="group grid min-h-[168px] grid-cols-[96px_1fr] overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.035] transition hover:border-indigo-300/30 hover:bg-white/[0.06] sm:grid-cols-[118px_1fr]"
    >
      <div className="relative bg-zinc-900">
        {image ? (
          <Image
            src={image}
            alt={event.title}
            fill
            sizes="140px"
            className="object-cover transition duration-300 group-hover:scale-105"
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-700">
            <Icon size={28} />
          </div>
        )}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-2 pt-8">
          <span className="rounded-md bg-black/70 px-2 py-1 text-[10px] font-black uppercase text-white">
            {shortDate(event.date, language)}
          </span>
        </div>
      </div>

      <div className="flex min-w-0 flex-col p-3">
        <div className="flex items-center gap-2 text-[10px] font-black uppercase text-indigo-200/80">
          <Icon size={13} />
          <span className="truncate">{episodeLabel}</span>
        </div>
        <h3 className="mt-2 line-clamp-2 text-sm font-black text-white sm:text-base">{event.title}</h3>
        {event.overview && <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-400">{event.overview}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-3">
          <span className="min-w-0 truncate text-[11px] font-semibold text-zinc-500">{event.relativeDateLabel}</span>
          <ChevronRight size={15} className="shrink-0 text-zinc-500 transition group-hover:translate-x-0.5 group-hover:text-indigo-200" />
        </div>
      </div>
    </Link>
  );
}

function EventStrip({ items, language }: { items: RadarEvent[]; language: string }) {
  if (items.length === 0) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {items.slice(0, 6).map((event, index) => (
        <EventCard key={event.id} event={event} language={language} priority={index < 2} />
      ))}
    </div>
  );
}

function SmartBlock({
  id,
  items,
  language,
}: {
  id: SmartBlockId;
  items: RadarEvent[];
  language: string;
}) {
  const meta = BLOCK_META[id];
  const Icon = meta.icon;
  if (items.length === 0 && id !== "following") return null;

  return (
    <section className="py-6">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-black uppercase text-indigo-200/80">
            <Icon size={15} />
            <span>{meta.title}</span>
          </div>
          <p className="mt-1 max-w-2xl text-sm text-zinc-500">{meta.desc}</p>
        </div>
        <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] font-bold text-zinc-400">
          {items.length}
        </span>
      </div>

      {items.length > 0 ? (
        <EventStrip items={items} language={language} />
      ) : (
        <div className="rounded-lg border border-dashed border-white/[0.12] bg-white/[0.025] px-4 py-8 text-sm font-semibold text-zinc-500">
          {uiMessage("radar.v2.empty.following")}
        </div>
      )}
    </section>
  );
}

function SectionTable({ section, language }: { section: RadarSection; language: string }) {
  if (section.items.length === 0) return null;

  return (
    <section className="py-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-white">{section.title}</h2>
          <p className="mt-1 text-sm text-zinc-500">{section.description}</p>
        </div>
        <span className="rounded-md border border-white/[0.08] px-2 py-1 text-[11px] font-bold text-zinc-400">
          {section.count}
        </span>
      </div>
      <div className="divide-y divide-white/[0.06] overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.025]">
        {section.items.slice(0, 10).map((event) => (
          <Link key={event.id} href={eventHref(event)} className="grid grid-cols-[72px_1fr_auto] items-center gap-3 px-3 py-3 transition hover:bg-white/[0.04]">
            <span className="text-xs font-black uppercase text-indigo-200">{shortDate(event.date, language)}</span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-bold text-white">{event.title}</span>
              <span className="block truncate text-xs text-zinc-500">{event.label}</span>
            </span>
            <ChevronRight size={15} className="text-zinc-600" />
          </Link>
        ))}
      </div>
    </section>
  );
}

export default function RadarV2Client({ initialPayload, initialMode, region, language }: RadarV2ClientProps) {
  const [payload, setPayload] = useState<RadarPayload | null>(initialPayload);
  const [mode, setMode] = useState<RadarMode>(initialMode);
  const [filterId, setFilterId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const filters = useMemo(() => normalizedFilters(payload?.filters ?? []), [payload]);
  const blocks = useMemo(() => {
    const base = smartBlocks(payload);
    const q = query.trim().toLowerCase();
    return Object.fromEntries(
      BLOCK_ORDER.map((id) => [
        id,
        base[id].filter((event) =>
          matchesFilter(event, filterId) &&
          (!q || `${event.title} ${event.originalTitle ?? ""} ${event.label}`.toLowerCase().includes(q)),
        ),
      ]),
    ) as Record<SmartBlockId, RadarEvent[]>;
  }, [filterId, payload, query]);

  const sections = useMemo(() => {
    if (!payload) return [];
    return SECTION_ORDER
      .map((id) => payload.sections[id])
      .filter((section): section is RadarSection => Boolean(section));
  }, [payload]);

  async function loadMode(nextMode: RadarMode) {
    if (nextMode === mode && payload) return;
    setError(null);
    setMode(nextMode);
    startTransition(async () => {
      try {
        const response = await fetch(`/api/radar?mode=${nextMode}&language=${encodeURIComponent(language)}&region=${encodeURIComponent(region)}`, {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        setPayload(await response.json() as RadarPayload);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <main className="min-h-screen bg-[#07070b] px-4 pb-28 pt-8 text-white sm:px-6 md:px-8 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="border-b border-white/[0.08] pb-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 text-xs font-black uppercase text-indigo-200/80">
                <Radar size={16} />
                <span>{uiMessage("radar.v2.eyebrow")}</span>
              </div>
              <h1 className="mt-3 text-3xl font-black tracking-normal text-white sm:text-5xl">
                {uiMessage("radar.v2.title")}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-zinc-400 sm:text-base">
                {uiMessage("radar.v2.subtitle")}
              </p>
            </div>

            <div className="grid gap-2 sm:grid-cols-3 lg:min-w-[420px]">
              <MiniStat label={uiMessage("radar.v2.stat.events")} value={payload?.stats.normalizedEvents ?? "-"} icon={CalendarDays} />
              <MiniStat label={uiMessage("radar.v2.stat.library")} value={payload?.librarySize ?? "-"} icon={Library} />
              <MiniStat label={uiMessage("radar.v2.stat.cache")} value={payload?.fromCache ? uiMessage("radar.v2.cache.hit") : uiMessage("radar.v2.cache.live")} icon={Star} />
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="inline-grid grid-cols-2 rounded-lg border border-white/[0.08] bg-white/[0.035] p-1 sm:w-fit">
              <button
                type="button"
                onClick={() => void loadMode("general")}
                className={`rounded-md px-4 py-2 text-sm font-black transition ${mode === "general" ? "bg-indigo-500 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                {uiMessage("radar.v2.mode.general")}
              </button>
              <button
                type="button"
                onClick={() => void loadMode("personal")}
                className={`rounded-md px-4 py-2 text-sm font-black transition ${mode === "personal" ? "bg-indigo-500 text-white" : "text-zinc-400 hover:text-white"}`}
              >
                {uiMessage("radar.v2.mode.personal")}
              </button>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-sm text-zinc-400">
                <Search size={15} className="shrink-0" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={uiMessage("radar.v2.search")}
                  className="min-w-0 bg-transparent text-white outline-none placeholder:text-zinc-600"
                />
              </label>
              <div className="flex h-10 items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.035] px-3 text-sm text-zinc-400">
                <Filter size={15} />
                <select
                  value={filterId ?? ""}
                  onChange={(event) => setFilterId(event.target.value || null)}
                  className="max-w-[220px] bg-transparent text-white outline-none"
                >
                  <option value="">{uiMessage("radar.v2.filter.all")}</option>
                  {filters.map((filter) => (
                    <option key={filter.id} value={filter.id}>
                      {filter.label} ({filter.count})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {(isPending || error) && (
            <div className="mt-4 rounded-lg border border-white/[0.08] bg-white/[0.035] px-4 py-3 text-sm font-semibold text-zinc-300">
              {isPending && <span className="inline-flex items-center gap-2"><Loader2 size={15} className="animate-spin" />{uiMessage("radar.v2.loading")}</span>}
              {error && <span className="text-rose-200">{uiMessage("radar.v2.error", { v1: error })}</span>}
            </div>
          )}
        </header>

        {payload ? (
          <>
            <div className="divide-y divide-white/[0.06]">
              {BLOCK_ORDER.map((id) => (
                <SmartBlock key={id} id={id} items={blocks[id]} language={payload.language || language} />
              ))}
            </div>

            <div className="mt-4 border-t border-white/[0.08] pt-4">
              {sections.map((section) => (
                <SectionTable key={section.id} section={section} language={payload.language || language} />
              ))}
            </div>
          </>
        ) : (
          <div className="mt-8 rounded-lg border border-white/[0.08] bg-white/[0.035] px-5 py-12 text-center text-sm font-semibold text-zinc-400">
            {uiMessage("radar.v2.empty")}
          </div>
        )}
      </div>
    </main>
  );
}
