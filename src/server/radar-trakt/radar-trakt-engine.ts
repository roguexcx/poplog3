import { db } from "@/server/db/client";
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
import { resolveAssetUrl } from "@/server/source-engine/asset-urls";
import { resolveCatalogLocalization } from "@/lib/i18n/catalog-localization";
import { getCatalogLocalizationsByPoplogId } from "@/server/catalog/catalog-localization-store";

export const RADAR_TRAKT_CACHE_VERSION = 3;

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

  const enriched = await enrichWithLocalCatalog(normalized, {
    language: options.language,
    region: options.region,
  });
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

async function enrichWithLocalCatalog(
  events: RadarEvent[],
  options: { language: string; region: string },
): Promise<RadarEvent[]> {
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
  const imdbIds = [...new Set([...movies, ...shows].map((row) => row.imdbId).filter((id): id is string => Boolean(id)))];
  const poplogIds = [...new Set([...movies, ...shows].map((row) => row.id).filter(Boolean))];
  const [translations, assets, catalogLocalizations] = await Promise.all([
    imdbIds.length
      ? db.titleTranslation.findMany({ where: { imdbId: { in: imdbIds } } }).catch(() => [])
      : Promise.resolve([]),
    imdbIds.length
      ? db.titleAsset.findMany({
          where: { imdbId: { in: imdbIds }, type: { in: ["poster", "backdrop"] } },
          orderBy: [{ isOverride: "desc" }, { isPrimary: "desc" }, { updatedAt: "desc" }],
        }).catch(() => [])
      : Promise.resolve([]),
    Promise.all(
      poplogIds.map(async (poplogId) => ({
        poplogId,
        rows: await getCatalogLocalizationsByPoplogId(poplogId).catch(() => []),
      })),
    ),
  ]);
  const translationsByImdb = new Map<string, typeof translations>();
  for (const translation of translations) {
    const list = translationsByImdb.get(translation.imdbId) ?? [];
    list.push(translation);
    translationsByImdb.set(translation.imdbId, list);
  }
  const assetsByImdb = new Map<string, typeof assets>();
  for (const asset of assets) {
    const list = assetsByImdb.get(asset.imdbId) ?? [];
    list.push(asset);
    assetsByImdb.set(asset.imdbId, list);
  }
  const localizationsByPoplogId = new Map(catalogLocalizations.map((entry) => [entry.poplogId, entry.rows]));

  function pickTranslation(imdbId: string | null | undefined) {
    if (!imdbId) return null;
    const rows = translationsByImdb.get(imdbId) ?? [];
    return (
      rows.find((row) => row.language === options.language && row.region === options.region) ??
      rows.find((row) => row.language === options.language) ??
      rows.find((row) => row.language === "en-US") ??
      rows[0] ??
      null
    );
  }

  function pickAsset(imdbId: string | null | undefined, type: "poster" | "backdrop") {
    if (!imdbId) return null;
    const rows = (assetsByImdb.get(imdbId) ?? []).filter((asset) => asset.type === type);
    const picked =
      rows.find((asset) => asset.language === options.language && asset.region === options.region) ??
      rows.find((asset) => asset.language === options.language && !asset.region) ??
      rows.find((asset) => asset.language === options.language) ??
      rows.find((asset) => asset.language === null) ??
      rows.find((asset) => asset.language === "en-US") ??
      rows[0] ??
      null;
    return resolveAssetUrl(picked?.assetKey ?? picked?.sourceUrl ?? null);
  }

  return events.map((event) => {
    const mediaType = event.mediaType === "movie" ? "movie" : "tv";
    const row = event.ids.tmdb ? byKey.get(`${mediaType}:${event.ids.tmdb}`) : null;
    if (!row) return event;
    const translation = pickTranslation(row.imdbId);
    const poster = pickAsset(row.imdbId, "poster");
    const backdrop = pickAsset(row.imdbId, "backdrop");
    const resolved = resolveCatalogLocalization(
      {
        title: translation?.title ?? row.title ?? event.title,
        originalTitle: row.originalTitle ?? event.originalTitle,
        overview: translation?.overview ?? row.overview ?? event.overview,
        localizations: localizationsByPoplogId.get(row.id) ?? [],
      },
      options.language,
    );
    return {
      ...event,
      poplogId: row.id,
      title: resolved.title ?? event.title,
      originalTitle: row.originalTitle ?? event.originalTitle,
      overview: resolved.overview ?? event.overview,
      poster: poster ?? row.posterPath ?? event.poster,
      backdrop: backdrop ?? row.backdropPath ?? event.backdrop,
      ids: { ...event.ids, poplog: row.id, imdb: row.imdbId ?? event.ids.imdb },
    };
  });
}
