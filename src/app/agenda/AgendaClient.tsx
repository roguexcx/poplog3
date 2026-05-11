"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Play,
  Radar,
} from "lucide-react";
import TmdbImage from "@/components/images/TmdbImage";

type MediaType = "movie" | "tv";
type AgendaPriority = "high" | "medium" | "silent";
type AgendaEventType = "episode" | "season" | "movie_release" | "cinema_release" | "related";

type AgendaTitle = {
  id: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  originalTitle: string | null;
  status: string | null;
  favorite: boolean;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  runtime: number | null;
  popularity: number;
  voteAverage: number;
  progressPercent: number | null;
  remainingEpisodes: number | null;
  remainingMinutes: number | null;
};

type AgendaEvent = {
  id: string;
  type: AgendaEventType;
  priority: AgendaPriority;
  date: string;
  timeLabel: string | null;
  title: string;
  subtitle: string;
  status: string;
  countdown: string;
  badge: string;
  description: string;
  titleRef: AgendaTitle;
  season?: number;
  episode?: number;
  progressLabel?: string | null;
};

type AgendaResponse = {
  generatedAt: string;
  partial?: boolean;
  refreshRecommended?: boolean;
  cacheStatus?: { hits: number; misses: number; unavailable: boolean };
  requestBudget?: { limit: number; used: number; detailsSeries: string; detailsMovies: string; seasons: string; related: string };
  hero: AgendaEvent[];
  events: AgendaEvent[];
  episodeCalendar?: {
    byDate: Record<string, AgendaEvent[]>;
    upcomingEpisodes: AgendaEvent[];
    thisWeek: AgendaEvent[];
    thisMonth: AgendaEvent[];
    trackedSeriesWithoutDates: Array<{ tmdbId: number; mediaType: MediaType; reason: string }>;
  };
  upcomingMovies?: {
    savedFutureMovies: AgendaEvent[];
    watchlistFutureMovies: AgendaEvent[];
    cinemaSoon: AgendaEvent[];
    relatedFutureMovies: AgendaEvent[];
    byMonth: Record<string, AgendaEvent[]>;
  };
  timeline: AgendaEvent[];
  alerts: AgendaEvent[];
  ecosystem: {
    continueWatching: AgendaEvent[];
    nextEpisodes: AgendaEvent[];
    movieReleases: AgendaEvent[];
    related: AgendaEvent[];
  };
  summary: {
    upcomingEpisodesThisWeek?: number;
    upcomingEpisodesThisMonth?: number;
    futureMoviesSaved?: number;
    futureMoviesWatchlist?: number;
    cinemaReleasesSoon?: number;
    lastUpdatedAt?: string;
    partial?: boolean;
    episodesThisWeek: number;
    seriesUpToDate: number;
    waitingSeasons: number;
    pendingMinutes: number;
    importantPremieres: number;
    intensity: "leve" | "movimentada" | "intensa";
  };
};

type TrackingMode = "all" | "watching" | "big";
type AgendaPrefs = {
  hidden: Record<string, boolean>;
  muted: Record<string, boolean>;
  priority: Record<string, boolean>;
  remindLater: Record<string, boolean>;
};

const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "SÃ¡b", "Dom"];
const EVENT_ACCENT: Record<AgendaEventType, string> = {
  episode: "border-sky-300/25 bg-sky-300/[0.10] text-sky-100",
  season: "border-cyan-300/25 bg-cyan-300/[0.10] text-cyan-100",
  movie_release: "border-amber-300/25 bg-amber-300/[0.10] text-amber-100",
  cinema_release: "border-orange-300/25 bg-orange-300/[0.10] text-orange-100",
  related: "border-fuchsia-300/25 bg-fuchsia-300/[0.10] text-fuchsia-100",
};

function parseDate(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric" }).format(date);
}

function priorityLabel(priority: AgendaPriority): string {
  if (priority === "high") return "Prioridade alta";
  if (priority === "medium") return "Prioridade mÃ©dia";
  return "Silencioso";
}

function useAgenda() {
  const [data, setData] = useState<AgendaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const res = await fetch("/api/agenda", { cache: "no-store" });
        if (!res.ok) throw new Error("agenda");
        const json = await res.json();
        if (mounted) setData(json);
      } catch {
        if (mounted) setError(true);
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, []);

  return { data, loading, error };
}

function EventPoster({ event, className = "" }: { event: AgendaEvent; className?: string }) {
  return (
    <TmdbImage
      path={event.titleRef.backdropPath ?? event.titleRef.posterPath}
      kind={event.titleRef.backdropPath ? "backdrop" : "poster"}
      size={event.titleRef.backdropPath ? "hero" : "card"}
      alt={event.title}
      fill
      sizes="(max-width: 768px) 100vw, 640px"
      loading="lazy"
      className={`object-cover ${className}`}
      fallback={<div className="h-full w-full bg-zinc-900" />}
    />
  );
}

function ContextMenu({ event, onAction }: { event: AgendaEvent; onAction?: (event: AgendaEvent, action: keyof AgendaPrefs) => void }) {
  const actions: Array<{ label: string; action: keyof AgendaPrefs }> = [
    { label: "Acompanhar tudo", action: "priority" },
    { label: event.titleRef.mediaType === "tv" ? "Apenas novas temporadas" : "Apenas estreia digital", action: "priority" },
    { label: "Silenciar", action: "muted" },
    { label: "Pausar alertas", action: "muted" },
    { label: "Remover da Agenda", action: "hidden" },
    { label: "Marcar prioridade", action: "priority" },
    { label: "Lembrar depois", action: "remindLater" },
  ];

  return (
    <details className="group/menu relative">
      <summary className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded-full border border-white/[0.12] bg-black/25 text-zinc-300 transition hover:bg-white/[0.08] hover:text-white">
        <MoreHorizontal size={16} />
      </summary>
      <div className="absolute right-0 top-11 z-40 w-64 overflow-hidden rounded-2xl border border-white/[0.10] bg-[#090d16]/95 p-1.5 shadow-2xl backdrop-blur-xl">
        {actions.map((item) => (
          <button
            key={item.label}
            onClick={() => onAction?.(event, item.action)}
            className="block w-full rounded-xl px-3 py-2 text-left text-xs font-bold text-zinc-300 transition hover:bg-white/[0.06] hover:text-white"
          >
            {item.label}
          </button>
        ))}
      </div>
    </details>
  );
}

function HeroCarousel({ events, onAction }: { events: AgendaEvent[]; onAction: (event: AgendaEvent, action: keyof AgendaPrefs) => void }) {
  const [active, setActive] = useState(0);
  const event = events[active] ?? events[0];

  if (!event) {
    return (
      <section className="rounded-[1.75rem] border border-white/[0.08] bg-white/[0.035] p-8 text-center">
        <p className="text-sm font-bold text-zinc-500">Salve filmes e sÃ©ries para a Agenda ganhar vida.</p>
      </section>
    );
  }

  return (
    <section className="relative overflow-hidden rounded-[1.75rem] border border-white/[0.08] bg-white/[0.035] shadow-[0_22px_80px_rgba(0,0,0,0.45)]">
      <div className="absolute inset-0">
        <EventPoster event={event} className="brightness-[0.62] saturate-[1.05]" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#020617] via-[#020617]/80 to-[#020617]/25" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent" />
      </div>

      <div className="relative grid min-h-[460px] gap-6 p-5 sm:p-8 lg:grid-cols-[1fr_360px] lg:items-end">
        <div className="flex max-w-3xl flex-col justify-end pt-24">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={`rounded-full border px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] ${EVENT_ACCENT[event.type]}`}>
              {event.status}
            </span>
            <span className="rounded-full border border-white/[0.12] bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-200">
              {event.countdown}
            </span>
            <span className="rounded-full border border-white/[0.12] bg-black/25 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-zinc-300">
              {priorityLabel(event.priority)}
            </span>
          </div>

          <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">{event.title}</h1>
          <p className="mt-3 text-lg font-bold text-sky-100">{event.subtitle}</p>
          <p className="mt-4 max-w-2xl text-sm leading-relaxed text-zinc-300">{event.description}</p>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link
              href={`/title/${event.titleRef.mediaType}/${event.titleRef.tmdbId}`}
              className="inline-flex items-center gap-2 rounded-full border border-sky-300/30 bg-sky-300/[0.14] px-5 py-2.5 text-xs font-black text-sky-50 transition hover:bg-sky-300/[0.22]"
            >
              <Play size={15} /> Abrir tÃ­tulo
            </Link>
            <ContextMenu event={event} onAction={onAction} />
          </div>
        </div>

        <div className="rounded-2xl border border-white/[0.10] bg-black/25 p-4 backdrop-blur">
          <p className="mb-3 text-[10px] font-black uppercase tracking-[0.25em] text-zinc-500">Chegando em breve</p>
          <div className="space-y-2">
            {events.slice(0, 5).map((item, index) => (
              <button
                key={item.id}
                onClick={() => setActive(index)}
                className={`flex w-full items-center gap-3 rounded-xl p-2 text-left transition ${
                  active === index ? "bg-white/[0.10]" : "hover:bg-white/[0.06]"
                }`}
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.10] text-[10px] font-black text-zinc-300">
                  {index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-black text-white">{item.title}</span>
                  <span className="block truncate text-[11px] font-semibold text-zinc-500">{item.countdown} Â· {item.badge}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function CalendarPanel({ events }: { events: AgendaEvent[] }) {
  const firstEventDate = events[0]?.date ? parseDate(events[0].date) : new Date();
  const [month, setMonth] = useState(new Date(firstEventDate.getFullYear(), firstEventDate.getMonth(), 1));
  const eventsByDate = useMemo(() => {
    const map = new Map<string, AgendaEvent[]>();
    for (const event of events) {
      const list = map.get(event.date) ?? [];
      list.push(event);
      map.set(event.date, list);
    }
    return map;
  }, [events]);
  const days = useMemo(() => {
    const start = new Date(month.getFullYear(), month.getMonth(), 1);
    const offset = (start.getDay() + 6) % 7;
    const gridStart = new Date(start.getTime() - offset * 86_400_000);
    return Array.from({ length: 42 }, (_, index) => new Date(gridStart.getTime() + index * 86_400_000));
  }, [month]);
  return (
    <section className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.035] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">CalendÃ¡rio vivo</p>
          <h2 className="mt-1 text-xl font-black capitalize text-white">{monthLabel(month)}</h2>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.10] text-zinc-300 hover:bg-white/[0.06]"
            aria-label="MÃªs anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <button
            onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}
            className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.10] text-zinc-300 hover:bg-white/[0.06]"
            aria-label="PrÃ³ximo mÃªs"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((day) => (
          <p key={day} className="py-2 text-[10px] font-black uppercase tracking-[0.18em] text-zinc-600">{day}</p>
        ))}
        {days.map((day) => {
          const key = dateKey(day);
          const dayEvents = eventsByDate.get(key) ?? [];
          const inMonth = monthKey(day) === monthKey(month);
          return (
            <div
              key={key}
              className={`min-h-[76px] rounded-xl border p-1.5 text-left transition ${
                dayEvents.length
                  ? "border-white/[0.10] bg-white/[0.045]"
                  : "border-transparent"
              } ${inMonth ? "opacity-100" : "opacity-35"}`}
            >
              <span className="text-[11px] font-black text-zinc-300">{day.getDate()}</span>
              <div className="mt-2 flex flex-wrap gap-1">
                {dayEvents.slice(0, 3).map((event) => (
                  <span key={event.id} className={`h-2 w-2 rounded-full ${event.priority === "high" ? "bg-sky-300 shadow-[0_0_10px_rgba(125,211,252,0.8)]" : "bg-white/35"}`} />
                ))}
              </div>
              {dayEvents[0]?.titleRef.posterPath && (
                <div className="mt-2 h-7 overflow-hidden rounded-md opacity-80">
                  <TmdbImage
                    path={dayEvents[0].titleRef.posterPath}
                    kind="poster"
                    size="card"
                    alt={dayEvents[0].title}
                    width={48}
                    height={72}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SummaryPanel({ data, mode, setMode, ignored, setIgnored }: {
  data: AgendaResponse;
  mode: TrackingMode;
  setMode: (mode: TrackingMode) => void;
  ignored: Record<string, boolean>;
  setIgnored: (value: Record<string, boolean>) => void;
}) {
  const settings = [
    ["ignoreMovies", "Ignorar filmes"],
    ["ignoreWeekly", "Ignorar episÃ³dios semanais"],
    ["ignoreAnime", "Ignorar anime"],
  ] as const;

  return (
    <aside className="space-y-4 lg:sticky lg:top-5">
      <section className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.04] p-4 backdrop-blur">
        <div className="mb-4 flex items-center gap-2">
          <Radar size={17} className="text-sky-300" />
          <p className="text-[10px] font-black uppercase tracking-[0.24em] text-sky-300">Resumo inteligente</p>
        </div>
        <p className="text-lg font-black text-white">
          Semana {data.summary.intensity}
        </p>
        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          {data.summary.upcomingEpisodesThisWeek ?? data.summary.episodesThisWeek} episÃ³dios com data real nesta semana,
          {" "}{data.summary.futureMoviesSaved ?? 0} filmes salvos futuros e {data.summary.importantPremieres} prioridade alta.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          {[
            ["Eps. semana", data.summary.upcomingEpisodesThisWeek ?? data.summary.episodesThisWeek],
            ["Eps. mÃªs", data.summary.upcomingEpisodesThisMonth ?? 0],
            ["Filmes futuros", data.summary.futureMoviesSaved ?? 0],
            ["Prioridade", data.summary.importantPremieres],
          ].map(([label, value]) => (
            <div key={label} className="rounded-xl border border-white/[0.07] bg-black/20 p-3">
              <p className="text-xl font-black text-white">{value}</p>
              <p className="mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-zinc-600">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.4rem] border border-white/[0.08] bg-white/[0.035] p-4">
        <p className="mb-3 text-[10px] font-black uppercase tracking-[0.24em] text-zinc-500">Controles</p>
        <div className="grid gap-2">
          {[
            ["all", "Acompanhar tudo"],
            ["watching", "SÃ³ em andamento"],
            ["big", "Apenas estreias grandes"],
          ].map(([value, label]) => (
            <button
              key={value}
              onClick={() => setMode(value as TrackingMode)}
              className={`rounded-full border px-3 py-2 text-left text-xs font-black transition ${
                mode === value ? "border-sky-300/35 bg-sky-300/[0.12] text-sky-100" : "border-white/[0.10] text-zinc-400 hover:bg-white/[0.05]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-2">
          {settings.map(([key, label]) => (
            <label key={key} className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-black/15 px-3 py-2 text-xs font-bold text-zinc-400">
              {label}
              <input
                type="checkbox"
                checked={Boolean(ignored[key])}
                onChange={(event) => setIgnored({ ...ignored, [key]: event.target.checked })}
                className="h-4 w-4 accent-sky-400"
              />
            </label>
          ))}
        </div>
      </section>
</aside>
  );
}

export default function AgendaClient() {
  const { data, loading, error } = useAgenda();
  const [trackingMode, setTrackingMode] = useState<TrackingMode>("all");
  const [ignored, setIgnored] = useState<Record<string, boolean>>({});
  const [prefs, setPrefs] = useState<AgendaPrefs>(() => {
    try {
      if (typeof window === "undefined") return { hidden: {}, muted: {}, priority: {}, remindLater: {} };
      const stored = window.localStorage.getItem("poplog-agenda-preferences");
      if (stored) return JSON.parse(stored) as AgendaPrefs;
    } catch {
      // PreferÃªncias locais sÃ£o opcionais.
    }
    return { hidden: {}, muted: {}, priority: {}, remindLater: {} };
  });

  function updatePrefs(next: AgendaPrefs) {
    setPrefs(next);
    try {
      window.localStorage.setItem("poplog-agenda-preferences", JSON.stringify(next));
    } catch {
      // Sem armazenamento local, os controles continuam funcionando na sessÃ£o.
    }
  }

  function handleEventAction(event: AgendaEvent, action: keyof AgendaPrefs) {
    const key = `${event.titleRef.mediaType}:${event.titleRef.tmdbId}`;
    updatePrefs({
      ...prefs,
      [action]: {
        ...prefs[action],
        [key]: !prefs[action][key],
      },
    });
  }

  const filteredData = useMemo(() => {
    if (!data) return null;
    const filter = (event: AgendaEvent) => {
      const key = `${event.titleRef.mediaType}:${event.titleRef.tmdbId}`;
      if (prefs.hidden[key]) return false;
      if (prefs.muted[key] && event.priority !== "high") return false;
      if (ignored.ignoreMovies && event.titleRef.mediaType === "movie") return false;
      if (ignored.ignoreWeekly && event.type === "episode") return false;
      if (ignored.ignoreAnime && event.titleRef.genres.some((genre) => genre.toLowerCase().includes("anima"))) return false;
      if (trackingMode === "watching") return event.titleRef.status === "watching" || event.type === "episode" || event.type === "season";
      if (trackingMode === "big") return prefs.priority[key] || event.priority === "high" || event.type === "season" || event.type === "movie_release";
      return true;
    };
    return {
      ...data,
      hero: data.hero.filter(filter),
      events: data.events.filter(filter),
      timeline: data.timeline.filter(filter),
      ecosystem: {
        continueWatching: data.ecosystem.continueWatching.filter(filter),
        nextEpisodes: data.ecosystem.nextEpisodes.filter(filter),
        movieReleases: data.ecosystem.movieReleases.filter(filter),
        related: data.ecosystem.related.filter(filter),
      },
      alerts: data.alerts.filter(filter).filter((event) => !prefs.remindLater[`${event.titleRef.mediaType}:${event.titleRef.tmdbId}`]),
    };
  }, [data, ignored, prefs, trackingMode]);

  if (loading) {
    return (
      <main className="min-h-screen bg-[#020617] px-4 py-8 text-white sm:px-6">
        <div className="mx-auto max-w-7xl animate-pulse">
          <div className="h-[460px] rounded-[1.75rem] bg-white/[0.04]" />
          <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_330px]">
            <div className="h-[520px] rounded-[1.4rem] bg-white/[0.035]" />
            <div className="h-[520px] rounded-[1.4rem] bg-white/[0.035]" />
          </div>
        </div>
      </main>
    );
  }

  if (error || !filteredData) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#020617] px-4 text-white">
        <div className="rounded-3xl border border-white/[0.08] bg-white/[0.035] p-8 text-center">
          <p className="text-lg font-black">NÃ£o consegui montar sua Agenda agora.</p>
          <p className="mt-2 text-sm text-zinc-500">Tente novamente em alguns instantes.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="relative min-h-screen overflow-hidden bg-[#020617] text-white">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.12),transparent_38%),radial-gradient(circle_at_80%_10%,rgba(34,211,238,0.08),transparent_34%)]" />
      <div className="relative z-10 mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.36em] text-sky-300">POPLOG Agenda</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight sm:text-6xl">Seu universo em movimento</h1>
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-zinc-400">
              Tudo que vocÃª salvou importa: episÃ³dios, estreias, temporadas e datas reais reunidos em uma central viva.
            </p>
          </div>
          <div className="flex flex-col items-start gap-2 sm:items-end">
            <button
              onClick={() => window.location.reload()}
              className="rounded-full border border-white/[0.10] bg-white/[0.04] px-4 py-2 text-xs font-black text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
            >
              Atualizar agenda
            </button>
            <span className="text-[11px] font-semibold text-zinc-600">
              {filteredData.summary.lastUpdatedAt
                ? `Dados atualizados em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(filteredData.summary.lastUpdatedAt))}`
                : "Atualizado automaticamente"}
            </span>
            {filteredData.partial && (
              <span className="rounded-full border border-amber-300/20 bg-amber-300/[0.08] px-3 py-1 text-[10px] font-black text-amber-200">
                Atualizando prÃ³ximos lanÃ§amentos...
              </span>
            )}
          </div>
        </header>

        <HeroCarousel events={filteredData.hero.length ? filteredData.hero : filteredData.timeline} onAction={handleEventAction} />

        <div className="grid gap-5 lg:grid-cols-[1fr_330px]">
          <div className="space-y-5">
            <CalendarPanel events={filteredData.events} />
          </div>
          <SummaryPanel
            data={filteredData}
            mode={trackingMode}
            setMode={setTrackingMode}
            ignored={ignored}
            setIgnored={setIgnored}
          />
        </div>

      </div>
    </main>
  );
}

