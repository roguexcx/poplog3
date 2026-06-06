import type { RadarEvent, RadarEventType } from "./types";
import { dayDiff, isRecurringLowShow, normalizeTextKey } from "./radar-event-utils";

const EVENT_WEIGHTS: Record<RadarEventType, number> = {
  new_show: 42,
  season_premiere: 36,
  movie_theatrical: 32,
  movie_streaming: 31,
  movie_digital: 29,
  season_finale: 28,
  series_finale: 34,
  season_drop: 27,
  movie_premiere: 26,
  movie_limited: 22,
  multiple_episodes: 18,
  episode: 14,
  movie_physical: 14,
  movie_tv: 12,
  anticipated_with_date: 20,
  recent_release: 18,
  unknown_dated_event: 6,
};

export function scoreRadarEvents(events: RadarEvent[]): RadarEvent[] {
  return events.map((event) => {
    const diff = Math.abs(dayDiff(event.date));
    const todayBoost = diff === 0 ? 30 : diff === 1 ? 20 : diff <= 3 ? 12 : diff <= 10 ? 6 : 0;
    const imageBoost = event.backdrop ? 12 : event.poster ? 7 : -16;
    const metadataBoost = (event.overview && !looksBrokenText(event.overview) ? 6 : -4) + (event.ids.trakt || event.ids.imdb || event.ids.tvdb ? 5 : 0);
    const regionBoost = event.country === "BR" ? 6 : 0;
    const anticipatedBoost = event.filters.includes("anticipated") ? Math.min(12, Math.log2(Math.max(1, event.score)) * 2) : 0;
    const recurringPenalty = isRecurringLowShow(event.contentType, event.title) ? recurringPenaltyFor(event) : 0;
    const repetitivePenalty = (event.episodeCount ?? 0) >= 4 && event.eventType !== "season_drop" ? 8 : 0;
    const eventClarityBoost = event.label && event.label !== "Evento com data" ? 4 : -4;
    const score =
      EVENT_WEIGHTS[event.eventType] +
      todayBoost +
      imageBoost +
      metadataBoost +
      regionBoost +
      anticipatedBoost +
      eventClarityBoost -
      recurringPenalty -
      repetitivePenalty;
    return { ...event, score: Math.round(score) };
  }).sort((a, b) => b.score - a.score || a.date.localeCompare(b.date));
}

function recurringPenaltyFor(event: RadarEvent): number {
  if (
    event.eventType === "new_show" ||
    event.eventType === "season_premiere" ||
    event.eventType === "season_finale" ||
    event.eventType === "series_finale"
  ) {
    return 8;
  }
  const key = normalizeTextKey(event.title);
  if (key.includes("wwe") || key.includes("smackdown") || key.includes("raw")) return 26;
  if (event.contentType === "sports") return 24;
  if (event.contentType === "news") return 24;
  if (event.contentType === "talk_show") return 22;
  if (event.contentType === "soap") return 26;
  return 18;
}

function looksBrokenText(text: string): boolean {
  return text.includes("[object Object]") || text.trim() === "{}" || text.trim() === "[]";
}
