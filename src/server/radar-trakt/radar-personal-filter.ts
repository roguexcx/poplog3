import { db } from "@/server/db/client";
import type { RadarEvent, RadarLibraryIdentity, RadarPayload } from "./types";
import { buildRadarFilters } from "./radar-event-filters";
import { normalizeTextKey } from "./radar-event-utils";

const ACTIVE_STATUSES = ["watching", "watchlist", "watched", "fridge"] as const;

export async function getRadarLibraryIdentity(userId: string | null): Promise<RadarLibraryIdentity> {
  if (!userId) {
    return emptyIdentity();
  }

  const rows = await db.userTitleState.findMany({
    where: {
      userId,
      isHidden: false,
      OR: [
        { favorite: true },
        { status: { in: [...ACTIVE_STATUSES] } },
      ],
      NOT: { status: "abandoned" },
    },
    select: {
      id: true,
      tmdbId: true,
      mediaType: true,
      status: true,
    },
  }).catch(() => []);

  const externalRows = rows.length
    ? await db.titleExternalId.findMany({
        where: {
          OR: rows.map((row) => ({ tmdbId: row.tmdbId, mediaType: row.mediaType })),
        },
      }).catch(() => [])
    : [];

  const externalByTmdb = new Map(externalRows.map((row) => [`${row.mediaType}:${row.tmdbId}`, row]));
  const identity = emptyIdentity();

  for (const row of rows) {
    identity.librarySize += 1;
    identity.poplogIds.add(row.id);
    if (row.mediaType === "tv") identity.tmdbTvIds.add(row.tmdbId);
    if (row.mediaType === "movie") identity.tmdbMovieIds.add(row.tmdbId);
    const external = externalByTmdb.get(`${row.mediaType}:${row.tmdbId}`);
    if (external?.traktId) identity.traktIds.add(String(external.traktId));
    if (external?.imdbId) identity.imdbIds.add(external.imdbId);
    if (external?.tvdbId) identity.tvdbIds.add(String(external.tvdbId));
  }

  return identity;
}

function emptyIdentity(): RadarLibraryIdentity {
  return {
    librarySize: 0,
    poplogIds: new Set(),
    traktIds: new Set(),
    imdbIds: new Set(),
    tvdbIds: new Set(),
    tmdbTvIds: new Set(),
    tmdbMovieIds: new Set(),
    slugs: new Set(),
    titles: new Set(),
  };
}

function matchesLibrary(event: RadarEvent, library: RadarLibraryIdentity): boolean {
  if (event.poplogId != null && library.poplogIds.has(String(event.poplogId))) return true;
  if (event.ids.trakt != null && library.traktIds.has(String(event.ids.trakt))) return true;
  if (event.ids.imdb && library.imdbIds.has(event.ids.imdb)) return true;
  if (event.ids.tvdb != null && library.tvdbIds.has(String(event.ids.tvdb))) return true;
  if (event.mediaType === "movie" && event.ids.tmdb != null && library.tmdbMovieIds.has(event.ids.tmdb)) return true;
  if ((event.mediaType === "show" || event.mediaType === "episode") && event.ids.tmdb != null && library.tmdbTvIds.has(event.ids.tmdb)) return true;
  if (event.ids.slug && library.slugs.has(event.ids.slug)) return true;
  return library.titles.has(normalizeTextKey(event.title));
}

export function applyRadarPersonalFilter(base: RadarPayload, library: RadarLibraryIdentity): RadarPayload {
  const sections = { ...base.sections };
  let matchedCount = 0;

  for (const id of Object.keys(sections) as Array<keyof typeof sections>) {
    const items = sections[id].items.filter((event) => matchesLibrary(event, library));
    matchedCount += items.length;
    sections[id] = { ...sections[id], items, count: items.length };
  }

  const payload = {
    ...base,
    mode: "personal" as const,
    sections,
    libraryFiltered: true,
    librarySize: library.librarySize,
    matchedCount,
    missingLibraryCount: Math.max(0, library.librarySize - matchedCount),
  };
  return { ...payload, filters: buildRadarFilters(payload) };
}
