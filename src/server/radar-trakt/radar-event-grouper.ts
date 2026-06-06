import type { RadarEvent } from "./types";
import { dayDiff, labelForEvent, isRecurringLowShow, normalizeTextKey } from "./radar-event-utils";

function identityKey(event: RadarEvent): string {
  const ids = event.ids;
  const titleIdentity =
    ids.trakt ? `trakt:${ids.trakt}` :
    ids.imdb ? `imdb:${ids.imdb}` :
    ids.tvdb ? `tvdb:${ids.tvdb}` :
    ids.tmdb ? `tmdb:${ids.tmdb}` :
    ids.slug ? `slug:${ids.slug}` :
    `title:${normalizeTextKey(event.title)}`;

  if (event.mediaType === "episode") {
    if (isRecurringLowShow(event.contentType, event.title)) {
      const week = Math.floor((dayDiff(event.date) + 30) / 7);
      return `${titleIdentity}|week:${week}|s${event.seasonNumber ?? 0}|recurring`;
    }
    return `${titleIdentity}|${event.date}|s${event.seasonNumber ?? 0}|${event.eventType}`;
  }

  if (event.mediaType === "movie") {
    return `${titleIdentity}|${event.date}|movie-release`;
  }

  return `${titleIdentity}|${event.date}|${event.eventType}`;
}

function episodeSortValue(event: RadarEvent): number {
  return (event.seasonNumber ?? 0) * 10_000 + (event.episodeNumber ?? 0);
}

function mergeEpisodeEvents(events: RadarEvent[]): RadarEvent {
  const sorted = [...events].sort((a, b) => episodeSortValue(a) - episodeSortValue(b));
  const first = sorted[0];
  if (sorted.length === 1) return first;

  const last = sorted[sorted.length - 1];
  const sameSeason = sorted.every((item) => item.seasonNumber === first.seasonNumber);
  const episodeRange =
    sameSeason && first.episodeNumber && last.episodeNumber
      ? `S${String(first.seasonNumber ?? 0).padStart(2, "0")}E${String(first.episodeNumber).padStart(2, "0")}-E${String(last.episodeNumber).padStart(2, "0")}`
      : null;

  const eventType =
    first.episodeNumber === 1 && sorted.length >= 3
      ? "season_drop"
      : "multiple_episodes";
  const recurring = isRecurringLowShow(first.contentType, first.title);

  return {
    ...first,
    id: `${first.id}:grouped:${sorted.length}`,
    eventType,
    episodeCount: sorted.length,
    episodeRange,
    label: recurring ? "Novos episódios esta semana" : labelForEvent(eventType, sorted.length),
    groupLabel: recurring ? `${sorted.length} episódios na semana` : `${sorted.length} episódios`,
    rawSourceRefs: sorted.flatMap((item) => item.rawSourceRefs),
  };
}

const RELEASE_PRIORITY = new Map([
  ["movie_streaming", 7],
  ["movie_digital", 6],
  ["movie_theatrical", 5],
  ["movie_premiere", 4],
  ["movie_limited", 3],
  ["movie_tv", 2],
  ["movie_physical", 1],
]);

function mergeMovieReleases(events: RadarEvent[]): RadarEvent {
  const sorted = [...events].sort((a, b) => (RELEASE_PRIORITY.get(b.eventType) ?? 0) - (RELEASE_PRIORITY.get(a.eventType) ?? 0));
  const primary = sorted[0];
  if (sorted.length === 1) return primary;
  const releaseTypes = [...new Set(sorted.map((event) => event.releaseType).filter(Boolean))].join(", ");
  return {
    ...primary,
    id: `${primary.id}:releases:${sorted.length}`,
    groupLabel: releaseTypes || `${sorted.length} releases`,
    rawSourceRefs: sorted.flatMap((item) => item.rawSourceRefs),
  };
}

export function groupRadarEvents(events: RadarEvent[]): RadarEvent[] {
  const buckets = new Map<string, RadarEvent[]>();
  for (const event of events) {
    const key = identityKey(event);
    const list = buckets.get(key) ?? [];
    list.push(event);
    buckets.set(key, list);
  }

  const grouped: RadarEvent[] = [];
  for (const list of buckets.values()) {
    if (list.length > 1 && list.every((event) => event.mediaType === "episode")) {
      grouped.push(mergeEpisodeEvents(list));
    } else if (list.length > 1 && list.every((event) => event.mediaType === "movie")) {
      grouped.push(mergeMovieReleases(list));
    } else {
      grouped.push(list.sort((a, b) => b.confidence.localeCompare(a.confidence))[0]);
    }
  }

  return grouped;
}
