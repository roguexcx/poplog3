import { buildTmdbRawUrl } from "@/lib/images/url";
import {
  catalogGetMovie,
  catalogGetPeople,
  catalogGetShow,
  catalogGetVideos,
} from "@/server/source-engine/engine";
import type { CatalogPeople, CatalogTitle, CatalogVideo } from "@/server/source-engine/types/catalog.types";
import { db } from "@/server/db/client";
import {
  resolvePoplogTitleIdentity,
  type PoplogTitleExternalIds,
  type PoplogTitleIdentity,
  type PoplogTitleSourceHint,
} from "./poplog-title-identity";
import type { PoplogTitleAliasResolution } from "./poplog-title-aliases";

type MediaType = "movie" | "tv";

export type PoplogTitleDetailsSource = "balloonerismm" | "local" | "legacy";

export type PoplogTitleDetailsResult = {
  /**
   * May be null/undefined for titles resolved from external aliases before a
   * controlled POPLOG_ID persistence step links them to the internal catalog.
   */
  poplogId?: string | number;
  mediaType: MediaType;
  title: string;
  originalTitle?: string | null;
  overview?: string | null;
  year?: number | null;
  releaseDate?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  genres?: string[];
  runtime?: number | null;
  voteAverage?: number | null;
  voteCount?: number | null;
  externalIds: PoplogTitleExternalIds;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
  status?: string | null;
  lastAirDate?: string | null;
  cast?: Array<{
    id: string | number;
    name: string;
    character?: string | null;
    photoUrl?: string | null;
  }>;
  crew?: Array<{
    id: string | number;
    name: string;
    job: string;
    department?: string | null;
    photoUrl?: string | null;
  }>;
  videos?: Array<{
    id: string | number;
    title: string;
    url: string;
    type: string;
    thumbnailUrl?: string | null;
  }>;
  /** Orçamento em USD. */
  budget?: number | null;
  /** Bilheteria total mundial em USD. */
  revenue?: number | null;
  /** Bilheteria doméstica (EUA) em USD. */
  domesticGross?: number | null;
  /** Pontuação Metacritic (0–100). */
  metacriticScore?: number | null;
  productionCompanies?: Array<{ name: string }>;
  productionCountries?: Array<{ code: string; name: string }>;
  spokenLanguages?: Array<{ code: string; name: string }>;
  inProduction?: boolean | null;
  seriesType?: string | null;
  sourceMeta: {
    primarySource: PoplogTitleDetailsSource;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    confidence?: number;
    resolvedFrom?: PoplogTitleIdentity["resolvedFrom"];
    rawSource?: PoplogTitleDetailsSource;
    aliasResolution?: PoplogTitleAliasResolution;
  };
};

export type PoplogTitleDetailsDebugSource = {
  source: PoplogTitleDetailsSource | "legacy_tmdb_fallback" | "unknown";
  resolvedFrom?: PoplogTitleIdentity["resolvedFrom"];
  poplogId: string | number | null;
  externalIds: PoplogTitleExternalIds;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  rawSource: PoplogTitleDetailsSource | "unknown";
  usedLegacy: boolean;
  usedTmdbApi: boolean;
  usedBalloonerismm: boolean;
  aliasLookupAttempted?: boolean;
  aliasLookupSource?: string[];
  aliasLookupFound?: boolean;
  externalIdsBefore?: PoplogTitleExternalIds;
  externalIdsAfter?: PoplogTitleExternalIds;
  aliasPersisted?: boolean;
  aliasPersistReason?: string | null;
};

type LoaderInput = {
  mediaType: MediaType;
  id: string;
  sourceHint?: PoplogTitleSourceHint;
};

type LocalTitleRow = {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string | null;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: Date | null;
  firstAirDate: Date | null;
  lastAirDate: Date | null;
  year: number | null;
  runtime: number | null;
  episodeRunTime: unknown;
  genres: unknown;
  voteAverage: unknown;
  voteCount: number | null;
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
};

function dateString(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function imageUrl(path: string | null | undefined, size: string): string | null {
  return buildTmdbRawUrl(size, path);
}

function mergeExternalIds(
  identity: PoplogTitleIdentity,
  local?: LocalTitleRow | null,
): PoplogTitleExternalIds {
  return {
    ...identity.externalIds,
    tmdbId: identity.externalIds.tmdbId ?? local?.tmdbId,
  };
}

function localGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((genre) => {
      if (typeof genre === "string") return genre;
      if (genre && typeof genre === "object" && "name" in genre) {
        const name = (genre as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((genre): genre is string => Boolean(genre));
}

function compactExternalIds(ids: PoplogTitleExternalIds): PoplogTitleExternalIds {
  return Object.fromEntries(
    Object.entries(ids).filter(([, value]) => value !== undefined && value !== null && value !== ""),
  ) as PoplogTitleExternalIds;
}

function remoteGenres(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((genre) => {
      if (typeof genre === "string") return genre;
      if (genre && typeof genre === "object" && "name" in genre) {
        const name = (genre as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((genre): genre is string => Boolean(genre));
}

function localToDetails(
  identity: PoplogTitleIdentity,
  row: LocalTitleRow,
): PoplogTitleDetailsResult {
  const releaseDate = row.mediaType === "movie"
    ? dateString(row.releaseDate)
    : dateString(row.firstAirDate);

  return {
    poplogId: row.id,
    mediaType: row.mediaType,
    title: row.title ?? row.originalTitle ?? "Sem titulo",
    originalTitle: row.originalTitle,
    overview: row.overview,
    year: row.year,
    releaseDate,
    lastAirDate: row.mediaType === "tv" ? dateString(row.lastAirDate) : null,
    numberOfSeasons: row.numberOfSeasons ?? null,
    numberOfEpisodes: row.numberOfEpisodes ?? null,
    posterUrl: imageUrl(row.posterPath, "w500"),
    backdropUrl: imageUrl(row.backdropPath, "w1280"),
    genres: localGenres(row.genres),
    runtime: row.mediaType === "movie"
      ? row.runtime
      : Array.isArray(row.episodeRunTime)
        ? Number(row.episodeRunTime[0] ?? 0) || null
        : null,
    voteAverage: row.voteAverage != null ? Number(row.voteAverage) : null,
    voteCount: row.voteCount,
    externalIds: mergeExternalIds(identity, row),
    sourceMeta: {
      primarySource: "local",
      confidence: identity.confidence,
      resolvedFrom: identity.resolvedFrom,
      rawSource: "local",
      aliasResolution: identity.aliasResolution,
    },
  };
}

function balloonerismmToDetails(
  identity: PoplogTitleIdentity,
  title: CatalogTitle,
  people?: CatalogPeople | null,
  videos?: CatalogVideo[],
): PoplogTitleDetailsResult {
  return {
    poplogId: identity.poplogId,
    mediaType: title.mediaType === "show" ? "tv" : "movie",
    title: title.title || identity.title || "Sem titulo",
    originalTitle: undefined,
    overview: title.overview ?? null,
    year: title.year ?? null,
    releaseDate: title.year ? `${title.year}-01-01` : null,
    posterUrl: imageUrl(title.posterPath, "w500"),
    backdropUrl: imageUrl(title.backdropPath, "w1280"),
    genres: remoteGenres(title.genres),
    runtime: title.runtime ?? null,
    status: title.status ?? null,
    voteAverage: title.rating ?? null,
    voteCount: title.votes ?? null,
    numberOfSeasons: title.numberOfSeasons ?? null,
    numberOfEpisodes: title.numberOfEpisodes ?? null,
    externalIds: compactExternalIds({
      ...identity.externalIds,
      tmdbId: title.ids.tmdbId ?? identity.externalIds.tmdbId,
      imdbId: title.ids.imdbId ?? identity.externalIds.imdbId,
      tvdbId: title.ids.tvdbId ?? identity.externalIds.tvdbId,
      traktId: title.ids.traktId ?? identity.externalIds.traktId,
      balloonerismmId: identity.externalIds.balloonerismmId ?? title.ids.imdbId,
      slug: identity.externalIds.slug,
    }),
    cast: (people?.cast ?? []).map((person) => ({
      id: person.ids.imdbId ?? person.name,
      name: person.name,
      character: person.character ?? null,
      photoUrl: imageUrl(person.profileRemoteUrl, "w185"),
    })),
    crew: (people?.crew ?? []).map((person) => ({
      id: person.ids.imdbId ?? person.name,
      name: person.name,
      job: person.job ?? "Crew",
      department: person.department ?? null,
      photoUrl: imageUrl(person.profileRemoteUrl, "w185"),
    })),
    videos: (videos ?? []).map((video) => ({
      id: video.id,
      title: video.title,
      url: video.url,
      type: video.type,
      thumbnailUrl: video.thumbnailUrl ?? null,
    })),
    budget: title.budget ?? null,
    revenue: title.revenue ?? null,
    domesticGross: title.domesticGross ?? null,
    metacriticScore: title.metacriticScore ?? null,
    productionCompanies: title.productionCompanies,
    productionCountries: title.productionCountries,
    spokenLanguages: title.spokenLanguages,
    inProduction: title.inProduction ?? null,
    seriesType: title.seriesType ?? null,
    sourceMeta: {
      primarySource: "balloonerismm",
      confidence: identity.confidence,
      resolvedFrom: identity.resolvedFrom,
      rawSource: "balloonerismm",
      aliasResolution: identity.aliasResolution,
    },
  };
}

async function findLocalTitle(identity: PoplogTitleIdentity): Promise<LocalTitleRow | null> {
  if (identity.poplogId) {
    const row = await db.poplog3Title.findFirst({
      where: { id: String(identity.poplogId), mediaType: identity.mediaType },
    }).catch(() => null);
    if (row) return row as LocalTitleRow;
  }

  const tmdbId = identity.externalIds.tmdbId;
  if (!tmdbId) return null;

  return db.poplog3Title.findUnique({
    where: {
      tmdbId_mediaType: {
        tmdbId,
        mediaType: identity.mediaType,
      },
    },
  }).catch(() => null) as Promise<LocalTitleRow | null>;
}

function detailLookupId(identity: PoplogTitleIdentity): string | null {
  return identity.externalIds.imdbId ?? identity.externalIds.balloonerismmId ?? null;
}

export function getPoplogTitleDetailsDebugSource(
  details: PoplogTitleDetailsResult | null,
  options: {
    usedLegacy?: boolean;
    usedTmdbApi?: boolean;
    fallbackReason?: string | null;
  } = {},
): PoplogTitleDetailsDebugSource {
  const primarySource = details?.sourceMeta.primarySource ?? "unknown";
  const aliasResolution = details?.sourceMeta.aliasResolution;
  const usedLegacy = options.usedLegacy ?? primarySource === "legacy";
  const usedTmdbApi = options.usedTmdbApi ?? false;
  const source = usedTmdbApi
    ? "legacy_tmdb_fallback"
    : primarySource;

  return {
    source,
    resolvedFrom: details?.sourceMeta.resolvedFrom,
    poplogId: details?.poplogId ?? null,
    externalIds: details?.externalIds ?? {},
    fallbackUsed: Boolean(
      options.usedLegacy ||
        options.usedTmdbApi ||
        details?.sourceMeta.fallbackUsed,
    ),
    fallbackReason:
      options.fallbackReason ??
      details?.sourceMeta.fallbackReason ??
      (usedTmdbApi ? "legacy_tmdb_fallback" : null),
    rawSource: details?.sourceMeta.rawSource ?? primarySource,
    usedLegacy,
    usedTmdbApi,
    usedBalloonerismm: primarySource === "balloonerismm",
    aliasLookupAttempted: aliasResolution?.aliasLookupAttempted,
    aliasLookupSource: aliasResolution?.aliasLookupSource,
    aliasLookupFound: aliasResolution?.aliasLookupFound,
    externalIdsBefore: aliasResolution?.externalIdsBefore,
    externalIdsAfter: aliasResolution?.externalIdsAfter,
    aliasPersisted: aliasResolution?.aliasPersisted,
    aliasPersistReason: aliasResolution?.aliasPersistReason,
  };
}

export async function getPoplogTitleDetails({
  mediaType,
  id,
  sourceHint = "auto",
}: LoaderInput): Promise<PoplogTitleDetailsResult | null> {
  const identity = await resolvePoplogTitleIdentity({ mediaType, id, sourceHint });
  const local = await findLocalTitle(identity);
  const lookupId = detailLookupId(identity);

  if (lookupId) {
    const [remoteTitle, people, videos] = await Promise.all([
      mediaType === "movie"
        ? catalogGetMovie({ imdbId: lookupId })
        : catalogGetShow({ imdbId: lookupId }),
      catalogGetPeople({ mediaType: mediaType === "movie" ? "movie" : "show", imdbId: lookupId }).catch(() => null),
      catalogGetVideos({ mediaType: mediaType === "movie" ? "movie" : "show", imdbId: lookupId }).catch(() => []),
    ]);

    if (remoteTitle) {
      const details = balloonerismmToDetails(identity, remoteTitle, people, videos);
      return {
        ...details,
        poplogId: details.poplogId ?? local?.id,
        // Fields Balloonerismm doesn't provide — fall back to local DB
        lastAirDate: details.lastAirDate ?? (local?.lastAirDate ? dateString(local.lastAirDate) : null),
        numberOfSeasons: details.numberOfSeasons ?? local?.numberOfSeasons ?? null,
        numberOfEpisodes: details.numberOfEpisodes ?? local?.numberOfEpisodes ?? null,
        externalIds: {
          ...mergeExternalIds(identity, local),
          ...details.externalIds,
        },
      };
    }
  }

  if (local) {
    return {
      ...localToDetails(identity, local),
      sourceMeta: {
        primarySource: "local",
        fallbackUsed: Boolean(!lookupId),
        fallbackReason: lookupId ? undefined : "missing_imdb_alias_for_balloonerismm",
        confidence: identity.confidence,
        resolvedFrom: identity.resolvedFrom,
        rawSource: "local",
        aliasResolution: identity.aliasResolution,
      },
    };
  }

  return {
    mediaType,
    title: identity.title ?? `Titulo ${id}`,
    year: identity.year ?? null,
    externalIds: identity.externalIds,
    sourceMeta: {
      primarySource: "legacy",
      fallbackUsed: true,
      fallbackReason: lookupId ? "balloonerismm_empty" : "unresolved_external_identity",
      confidence: identity.confidence,
      resolvedFrom: identity.resolvedFrom,
      rawSource: "legacy",
      aliasResolution: identity.aliasResolution,
    },
  };
}
