import { db } from "@/server/db/client";
import type { TraktMovieFull } from "@/server/api-clients/trakt/types";
import {
  fetchRadarCalendarWindow,
  fetchRadarDiscovery,
  fetchRadarMovieReleases,
} from "./trakt-calendar.client";
import {
  normalizeAnticipated,
  normalizeEpisodeItem,
  normalizeMovieCalendarItem,
  normalizeMovieRelease,
} from "./radar-event-normalizer";
import { groupRadarEvents } from "./radar-event-grouper";
import { scoreRadarEvents } from "./radar-event-scorer";
import { buildRadarSections } from "./radar-event-buckets";
import { buildRadarFilters } from "./radar-event-filters";
import type { RadarEvent, RadarPayload } from "./types";
import { addDays, toDateStr } from "./radar-event-utils";

export const RADAR_TRAKT_CACHE_VERSION = 2;

type LocalTitleRow = Awaited<ReturnType<typeof db.poplog3Title.findMany>>[number];

export async function buildRadarGeneralPayload(options: {
  region: string;
  language: string;
  debug?: boolean;
}): Promise<RadarPayload> {
  const startedAt = Date.now();
  const windowStart = toDateStr(addDays(new Date(), -7));
  const windowDays = 37;
  const [calendar, discovery] = await Promise.all([
    fetchRadarCalendarWindow(windowStart, windowDays),
    fetchRadarDiscovery(),
  ]);

  const normalized: RadarEvent[] = [];
  for (const item of calendar.shows) {
    const event = normalizeEpisodeItem(item);
    if (event) normalized.push(event);
  }
  const movieBaseEvents = calendar.movies.flatMap((item) => {
    const event = normalizeMovieCalendarItem(item);
    return event ? [event] : [];
  });
  normalized.push(...movieBaseEvents);

  const releaseEvents = await enrichMovieReleases(movieBaseEvents, options.region);
  normalized.push(...releaseEvents);

  const anticipated = [
    ...discovery.shows.flatMap((item) => {
      const event = normalizeAnticipated(item, "show");
      return event ? [event] : [];
    }),
    ...discovery.movies.flatMap((item) => {
      const event = normalizeAnticipated(item, "movie");
      return event ? [event] : [];
    }),
  ];

  const datedAnticipated = anticipated.filter((event) => event.confidence !== "low");
  const pureAnticipated = anticipated.filter((event) => event.confidence === "low").slice(0, 18);
  normalized.push(...datedAnticipated, ...pureAnticipated);

  const enriched = await enrichWithLocalCatalog(normalized);
  const grouped = groupRadarEvents(enriched);
  const scored = scoreRadarEvents(grouped);
  const sections = buildRadarSections(scored);
  const payload: RadarPayload = {
    mode: "general",
    source: "trakt",
    generatedAt: new Date().toISOString(),
    fromCache: false,
    cacheVersion: RADAR_TRAKT_CACHE_VERSION,
    region: options.region,
    language: options.language,
    sections,
    filters: [],
    stats: {
      rawEvents: calendar.shows.length + calendar.movies.length + anticipated.length,
      normalizedEvents: normalized.length,
      groupedEvents: grouped.length,
      discarded: Math.max(0, calendar.shows.length + calendar.movies.length - normalized.length),
      sectionCounts: {
        now: sections.now.count,
        highlights: sections.highlights.count,
        week: sections.week.count,
        next: sections.next.count,
        recent: sections.recent.count,
        anticipated: sections.anticipated.count,
      },
    },
    debug: options.debug
      ? {
          durationMs: Date.now() - startedAt,
          endpoints: ["calendars/all/shows", "calendars/all/movies", "anticipated", "movie releases"],
        }
      : undefined,
  };

  return { ...payload, filters: buildRadarFilters(payload) };
}

async function enrichMovieReleases(baseEvents: RadarEvent[], region: string): Promise<RadarEvent[]> {
  const limited = baseEvents.slice(0, 30);
  const releases = await Promise.all(
    limited.map(async (event) => {
      const id = event.ids.trakt ?? event.ids.slug;
      if (!id) return [];
      const rows = await fetchRadarMovieReleases(id, region).catch(() => []);
      return rows.flatMap((row) => {
        const normalized = normalizeMovieRelease(event, row);
        return normalized ? [normalized] : [];
      });
    }),
  );
  return releases.flat();
}

async function enrichWithLocalCatalog(events: RadarEvent[]): Promise<RadarEvent[]> {
  const tmdbMovieIds = events.filter((event) => event.mediaType === "movie" && event.ids.tmdb).map((event) => event.ids.tmdb!);
  const tmdbTvIds = events.filter((event) => event.mediaType !== "movie" && event.ids.tmdb).map((event) => event.ids.tmdb!);
  const [movies, shows] = await Promise.all([
    tmdbMovieIds.length
      ? db.poplog3Title.findMany({ where: { mediaType: "movie", tmdbId: { in: [...new Set(tmdbMovieIds)] } } }).catch(() => [])
      : Promise.resolve([] as LocalTitleRow[]),
    tmdbTvIds.length
      ? db.poplog3Title.findMany({ where: { mediaType: "tv", tmdbId: { in: [...new Set(tmdbTvIds)] } } }).catch(() => [])
      : Promise.resolve([] as LocalTitleRow[]),
  ]);
  const byKey = new Map([...movies, ...shows].map((row) => [`${row.mediaType}:${row.tmdbId}`, row]));

  return events.map((event) => {
    const mediaType = event.mediaType === "movie" ? "movie" : "tv";
    const row = event.ids.tmdb ? byKey.get(`${mediaType}:${event.ids.tmdb}`) : null;
    if (!row) return event;
    return {
      ...event,
      poplogId: row.id,
      title: row.title ?? event.title,
      originalTitle: row.originalTitle ?? event.originalTitle,
      overview: row.overview ?? event.overview,
      poster: row.posterPath ?? event.poster,
      backdrop: row.backdropPath ?? event.backdrop,
      ids: { ...event.ids, poplog: row.id },
    };
  });
}
