import type { TraktAnticipatedItem, TraktCalendarEpisodeItem, TraktCalendarMovieItem, TraktMovieRelease } from "./trakt-calendar.client";
import type { RadarEvent, RadarEventType } from "./types";
import { contentTypeFromGenres, labelForEvent, normalizeTextKey, relativeDateLabel } from "./radar-event-utils";

function imageFrom(images: { poster?: string[] | null; fanart?: string[] | null; thumb?: string[] | null } | null | undefined, kind: "poster" | "backdrop") {
  if (!images) return null;
  return kind === "poster"
    ? images.poster?.[0] ?? images.thumb?.[0] ?? null
    : images.fanart?.[0] ?? images.thumb?.[0] ?? null;
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text === "[object Object]" || text === "{}" || text === "[]") return null;
  if (text.startsWith("{") || text.startsWith("[")) return null;
  return text;
}

export function normalizeEpisodeItem(item: TraktCalendarEpisodeItem): RadarEvent | null {
  const show = item.show;
  const episode = item.episode;
  const date = (item.first_aired ?? "").slice(0, 10);
  const title = cleanText(show?.title);
  if (!show || !episode || !date || !title) return null;

  const season = episode.season ?? null;
  const number = episode.number ?? null;
  const eventType: RadarEventType =
    season === 1 && number === 1
      ? "new_show"
      : number === 1
        ? "season_premiere"
        : "episode";
  const id = `trakt:episode:${episode.ids?.trakt ?? `${show.ids.trakt}-${season}-${number}`}:${date}`;

  return {
    id,
    poplogId: null,
    titleId: `show:${show.ids.trakt ?? show.ids.slug ?? normalizeTextKey(title)}`,
    mediaType: "episode",
    contentType: contentTypeFromGenres(show.genres, "show"),
    eventType,
    title,
    originalTitle: cleanText(show.title) ?? title,
    overview: cleanText(episode.overview) ?? cleanText(show.overview),
    date,
    dateEnd: null,
    timezone: show.airs?.timezone ?? null,
    relativeDateLabel: relativeDateLabel(date),
    seasonNumber: season,
    episodeNumber: number,
    episodeCount: 1,
    episodeRange: season && number ? `S${String(season).padStart(2, "0")}E${String(number).padStart(2, "0")}` : null,
    releaseType: null,
    country: show.country ?? null,
    source: "trakt_calendar_shows",
    confidence: "high",
    poster: imageFrom(show.images, "poster"),
    backdrop: imageFrom(show.images, "backdrop"),
    ids: {
      trakt: show.ids.trakt,
      imdb: show.ids.imdb ?? null,
      tvdb: show.ids.tvdb ?? null,
      tmdb: show.ids.tmdb ?? null,
      slug: show.ids.slug ?? null,
    },
    filters: [],
    bucket: null,
    score: 0,
    label: labelForEvent(eventType),
    groupLabel: null,
    rawSourceRefs: [{ source: "trakt", ref: id }],
  };
}

export function normalizeMovieCalendarItem(item: TraktCalendarMovieItem): RadarEvent | null {
  const movie = item.movie;
  const date = (item.released ?? movie?.released ?? "").slice(0, 10);
  const title = cleanText(movie?.title);
  if (!movie || !date || !title) return null;

  const id = `trakt:movie:${movie.ids.trakt ?? movie.ids.slug ?? normalizeTextKey(title)}:${date}`;
  return {
    id,
    poplogId: null,
    titleId: `movie:${movie.ids.trakt ?? movie.ids.slug ?? normalizeTextKey(title)}`,
    mediaType: "movie",
    contentType: contentTypeFromGenres(movie.genres, "movie"),
    eventType: "movie_theatrical",
    title,
    originalTitle: cleanText(movie.title) ?? title,
    overview: cleanText(movie.overview),
    date,
    dateEnd: null,
    timezone: null,
    relativeDateLabel: relativeDateLabel(date),
    seasonNumber: null,
    episodeNumber: null,
    episodeCount: null,
    episodeRange: null,
    releaseType: "theatrical",
    country: movie.country ?? null,
    source: "trakt_calendar_movies",
    confidence: "high",
    poster: imageFrom(movie.images, "poster"),
    backdrop: imageFrom(movie.images, "backdrop"),
    ids: {
      trakt: movie.ids.trakt,
      imdb: movie.ids.imdb ?? null,
      tmdb: movie.ids.tmdb ?? null,
      slug: movie.ids.slug ?? null,
    },
    filters: [],
    bucket: null,
    score: 0,
    label: labelForEvent("movie_theatrical"),
    groupLabel: null,
    rawSourceRefs: [{ source: "trakt", ref: id }],
  };
}

export function normalizeMovieRelease(base: RadarEvent, release: TraktMovieRelease): RadarEvent | null {
  const date = release.release_date?.slice(0, 10);
  if (!date) return null;
  const releaseType = release.release_type ?? "unknown";
  const eventTypeByRelease: Record<string, RadarEventType> = {
    premiere: "movie_premiere",
    limited: "movie_limited",
    theatrical: "movie_theatrical",
    digital: "movie_digital",
    physical: "movie_physical",
    tv: "movie_tv",
    unknown: "unknown_dated_event",
  };
  const eventType = eventTypeByRelease[releaseType] ?? "unknown_dated_event";
  return {
    ...base,
    id: `${base.titleId}:${releaseType}:${date}:${release.country ?? "global"}`,
    eventType,
    date,
    relativeDateLabel: relativeDateLabel(date),
    releaseType,
    country: release.country ?? base.country,
    source: "trakt_movie_releases",
    label: labelForEvent(eventType),
    rawSourceRefs: [...base.rawSourceRefs, { source: "trakt-release", ref: `${releaseType}:${date}` }],
  };
}

export function normalizeAnticipated(item: TraktAnticipatedItem, media: "show" | "movie"): RadarEvent | null {
  const titleObj = media === "show" ? item.show : item.movie;
  const date = media === "show" ? item.show?.first_aired?.slice(0, 10) : item.movie?.released?.slice(0, 10);
  const title = cleanText(titleObj?.title);
  if (!titleObj || !title) return null;
  const ids = titleObj.ids;
  return {
    id: `trakt:anticipated:${media}:${ids.trakt ?? ids.slug ?? normalizeTextKey(title)}`,
    poplogId: null,
    titleId: `${media}:${ids.trakt ?? ids.slug ?? normalizeTextKey(title)}`,
    mediaType: media,
    contentType: contentTypeFromGenres(titleObj.genres, media),
    eventType: date ? "anticipated_with_date" : "unknown_dated_event",
    title,
    originalTitle: cleanText(titleObj.title) ?? title,
    overview: cleanText(titleObj.overview),
    date: date ?? new Date().toISOString().slice(0, 10),
    dateEnd: null,
    timezone: media === "show" ? item.show?.airs?.timezone ?? null : null,
    relativeDateLabel: date ? relativeDateLabel(date) : "Mais aguardado",
    seasonNumber: null,
    episodeNumber: null,
    episodeCount: null,
    episodeRange: null,
    releaseType: null,
    country: titleObj.country ?? null,
    source: "trakt_anticipated",
    confidence: date ? "medium" : "low",
    poster: imageFrom(titleObj.images, "poster"),
    backdrop: imageFrom(titleObj.images, "backdrop"),
    ids: { trakt: ids.trakt, imdb: ids.imdb ?? null, tvdb: ids.tvdb ?? null, tmdb: ids.tmdb ?? null, slug: ids.slug ?? null },
    filters: ["anticipated"],
    bucket: "anticipated",
    score: item.list_count ?? 0,
    label: date ? "Em breve" : "Mais aguardado",
    groupLabel: item.list_count ? `${item.list_count} listas` : null,
    rawSourceRefs: [{ source: "trakt-anticipated", ref: String(ids.trakt ?? ids.slug ?? title) }],
  };
}
