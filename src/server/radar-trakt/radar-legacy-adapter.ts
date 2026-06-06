import type { IcsAgendaResponse, RadarSections } from "@/app/api/ics/agenda/route";
import type { IcsEngineStats, IcsSeriesGroup, MovieGroup, CinemaReleaseGroup } from "@/lib/ics-engine";
import type { RadarEvent, RadarPayload } from "./types";
import { normalizeTextKey } from "./radar-event-utils";

function numericId(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = String(value ?? "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash || 1;
}

function categoryFor(event: RadarEvent): IcsSeriesGroup["category"] {
  if (event.contentType === "movie") return "MOVIE";
  if (event.contentType === "animation" || event.contentType === "anime") return "ANIMATION";
  if (event.contentType === "documentary") return "DOCUMENTARY";
  if (event.contentType === "reality") return "REALITY";
  if (event.contentType === "sports") return "SPORTS";
  if (event.contentType === "news") return "NEWS";
  if (event.contentType === "kids") return "KIDS";
  if (event.contentType === "live_event") return "LIVE_EVENT";
  if (event.contentType === "talk_show" || event.contentType === "variety") return "VARIETY";
  if (event.contentType === "soap") return "DAILY_SOAP";
  return "SERIES";
}

function eventToGroup(event: RadarEvent): IcsSeriesGroup {
  const dateTime = `${event.date}T12:00:00.000Z`;
  const tmdbId = event.ids.tmdb ?? numericId(event.ids.trakt ?? event.ids.imdb ?? event.id);
  const category = categoryFor(event);
  return {
    key: event.id,
    rawTitle: event.title,
    source: "ics",
    sourceTag: event.source,
    category,
    episodeCount: event.episodeCount ?? 1,
    nextAirDate: event.date,
    lastAirDate: event.date,
    spanDays: 0,
    episodes: [{
      season: event.seasonNumber ?? 0,
      episode: event.episodeNumber ?? 0,
      episodeName: event.groupLabel ?? event.label,
      startAt: dateTime,
      endAt: event.dateEnd ? `${event.dateEnd}T13:00:00.000Z` : `${event.date}T13:00:00.000Z`,
      uid: event.id,
    }],
    seasons: event.seasonNumber != null ? [event.seasonNumber] : [],
    relevanceScore: event.score,
    isRelevant: true,
    streamingProvider: event.eventType === "movie_streaming" ? { name: "Streaming" } : null,
    sectionMeta: {
      section: event.bucket === "next" ? "vemAi" : event.bucket === "week" ? "novosEpisodios" : "destaques",
      badge: event.relativeDateLabel,
      reason: event.label,
      episodeDate: event.date,
      selectedEpisode: {
        season: event.seasonNumber ?? 0,
        episode: event.episodeNumber ?? 0,
        episodeName: event.label,
      },
      episodeCount: event.episodeCount ?? undefined,
      episodeLabel: event.label,
      clusterLabel: event.groupLabel ?? event.label,
      releasePattern: event.releaseType ?? event.eventType,
    },
    tmdb: {
      tmdb_id: tmdbId,
      name: event.title,
      original_name: event.originalTitle ?? event.title,
      overview: event.overview,
      poster_path: event.poster,
      backdrop_path: event.backdrop,
      clean_backdrop_path: event.backdrop,
      genre_ids: [],
      genres: [event.contentType],
      popularity: event.score,
      vote_average: 0,
      vote_count: 0,
      number_of_seasons: null,
      origin_country: event.country ? [event.country] : [],
      original_language: "en",
      first_air_date: event.date,
      status: null,
      networks: [],
      production_companies: [],
      refined_category: category,
    },
  };
}

function eventToMovie(event: RadarEvent): MovieGroup {
  return {
    key: event.id,
    source: "tmdb",
    sourceTag: event.source,
    movie: {
      tmdb_id: event.ids.tmdb ?? numericId(event.ids.trakt ?? event.id),
      release_date: event.date,
      backdrop_path: event.backdrop,
      poster_path: event.poster,
      clean_backdrop_path: event.backdrop,
      popularity: event.score,
      vote_average: 0,
      vote_count: 0,
      original_language: "en",
      overview: event.overview,
      name: event.title,
      original_name: event.originalTitle ?? event.title,
      genre_ids: [],
      genres: [event.contentType],
      origin_country: event.country ? [event.country] : [],
    },
    relevanceScore: event.score,
  };
}

function eventToCinema(event: RadarEvent): CinemaReleaseGroup {
  return {
    key: event.id,
    eventType: "movie_theatrical_release",
    source: "tmdb_cinema_release",
    releaseDate: event.date,
    dateConfidence: event.country === "BR" ? "cinema_br_confirmed" : "cinema_global_fallback",
    movie: {
      tmdb_id: event.ids.tmdb ?? numericId(event.ids.trakt ?? event.id),
      name: event.title,
      original_name: event.originalTitle ?? event.title,
      release_date: event.date,
      backdrop_path: event.backdrop,
      poster_path: event.poster,
      clean_backdrop_path: event.backdrop,
      popularity: event.score,
      vote_average: 0,
      vote_count: 0,
      original_language: "en",
      overview: event.overview,
      genre_ids: [],
      genres: [event.contentType],
      origin_country: event.country ? [event.country] : [],
    },
    relevanceScore: event.score,
  };
}

export function radarPayloadToLegacyAgenda(payload: RadarPayload): IcsAgendaResponse {
  const now = payload.sections.now.items.filter((event) => event.mediaType !== "movie").map(eventToGroup);
  const highlights = payload.sections.highlights.items.filter((event) => event.mediaType !== "movie").map(eventToGroup);
  const week = payload.sections.week.items.filter((event) => event.mediaType !== "movie").map(eventToGroup);
  const next = payload.sections.next.items.filter((event) => event.mediaType !== "movie").map(eventToGroup);
  const recent = payload.sections.recent.items.filter((event) => event.mediaType !== "movie").map(eventToGroup);
  const movieEvents = Object.values(payload.sections).flatMap((section) => section.items).filter((event) => event.mediaType === "movie");
  const movies = movieEvents.map(eventToMovie);
  const cinema = movieEvents.map(eventToCinema);

  const groups = [...now, ...highlights, ...week, ...next, ...recent].filter((group, index, arr) => {
    const key = `${group.key}:${normalizeTextKey(group.rawTitle)}`;
    return arr.findIndex((candidate) => `${candidate.key}:${normalizeTextKey(candidate.rawTitle)}` === key) === index;
  });

  const sections: RadarSections = {
    today: [...now, ...highlights],
    thisWeek: week,
    next30Days: next,
    cinemaToday: cinema.filter((item) => payload.sections.now.items.some((event) => event.id === item.key)),
    cinemaThisWeek: cinema.filter((item) => payload.sections.week.items.some((event) => event.id === item.key)),
    cinemaNext: cinema.filter((item) => payload.sections.next.items.some((event) => event.id === item.key)),
  };

  const stats: IcsEngineStats = {
    totalEvents: payload.stats.rawEvents,
    totalGroups: payload.stats.groupedEvents,
    byCategory: groups.reduce((acc, group) => {
      acc[group.category] = (acc[group.category] ?? 0) + 1;
      return acc;
    }, {} as IcsEngineStats["byCategory"]),
    hiddenGroups: 0,
    featuredGroups: highlights.length,
  };

  return {
    groups,
    featuredGroups: [...highlights, ...now, ...week, ...next, ...recent],
    secondaryGroups: [],
    movies,
    cinemaReleases: cinema,
    sections,
    stats,
    fetchedAt: payload.generatedAt,
    source: "trakt",
    pendingEnrichment: 0,
    trendingDay: [],
    trendingWeek: [],
    fromCache: payload.fromCache,
    cachedAt: payload.cachedAt,
    cacheVersion: payload.cacheVersion,
  };
}
