import type {
  AgendaEvent,
  AgendaTemporalLayer,
  AgendaTimelineGroup,
} from "@/server/agenda/types";
import type { PoplogEpisode, PoplogSeason } from "@/server/types/season";

const DAY_MS = 86_400_000;

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function parseDateOnly(date: string): Date {
  return new Date(`${date}T12:00:00`);
}

export function daysBetweenDates(from: string, to = toDateOnly(new Date())): number {
  const fromTime = parseDateOnly(from).getTime();
  const toTime = parseDateOnly(to).getTime();
  return Math.round((fromTime - toTime) / DAY_MS);
}

export function classifyAirDate(
  date: string | null | undefined,
  now = new Date(),
): AgendaTemporalLayer {
  if (!date) return "beyond";

  const today = toDateOnly(now);
  const diff = daysBetweenDates(date, today);

  if (diff === 0) {
    const explicitHour = /T(\d{2}):/.exec(date)?.[1];
    const hour = explicitHour ? Number(explicitHour) : now.getHours();
    return hour >= 18 ? "tonight" : "today";
  }

  if (diff === 1) return "tomorrow";
  if (diff > 1 && diff <= 7) return "this_week";
  if (diff > 7 && diff <= 14) return "next_week";
  if (diff > 14 && diff <= 31) return "this_month";
  return "beyond";
}

export function isSeasonFinale(
  episode:
    | Pick<PoplogEpisode, "episode_number">
    | { episode_number?: number | null; episodeNumber?: number | null },
  season: Pick<PoplogSeason, "episode_count" | "episodes"> | null,
): boolean {
  if (!season) return false;

  const episodeNumber =
    "episodeNumber" in episode ? episode.episodeNumber : episode.episode_number;
  if (episodeNumber == null) return false;

  const explicitCount = season.episode_count ?? null;
  if (explicitCount != null) return episodeNumber === explicitCount;

  const maxEpisode = Math.max(
    0,
    ...season.episodes.map((ep) => ep.episode_number ?? 0),
  );
  return maxEpisode > 0 && episodeNumber === maxEpisode;
}

export function detectHiatusReturn(
  lastAirDate: string | null | undefined,
  currentAirDate: string | null | undefined,
  minGapDays = 60,
): boolean {
  if (!lastAirDate || !currentAirDate) return false;
  const gap = Math.round(
    (parseDateOnly(currentAirDate).getTime() - parseDateOnly(lastAirDate).getTime()) /
      DAY_MS,
  );
  return gap > minGapDays;
}

const LAYER_TITLES: Record<AgendaTemporalLayer, string> = {
  today: "Hoje",
  tonight: "Hoje à noite",
  tomorrow: "Amanhã",
  this_week: "Esta semana",
  next_week: "Semana que vem",
  this_month: "Este mês",
  beyond: "Mais adiante",
};

const LAYER_ORDER: AgendaTemporalLayer[] = [
  "tonight",
  "today",
  "tomorrow",
  "this_week",
  "next_week",
  "this_month",
  "beyond",
];

export function buildTemporalTimeline(events: AgendaEvent[]): AgendaTimelineGroup[] {
  return LAYER_ORDER.map((layer) => {
    const layerEvents = events
      .filter((event) => event.layer === layer)
      .sort((a, b) => {
        const dateCompare = (a.airDate ?? "9999").localeCompare(b.airDate ?? "9999");
        return dateCompare !== 0 ? dateCompare : b.score - a.score;
      });

    return {
      layer,
      title: LAYER_TITLES[layer],
      events: layerEvents,
    };
  }).filter((group) => group.events.length > 0);
}
