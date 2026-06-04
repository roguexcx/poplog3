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

type MediaType = "movie" | "tv";

export type PoplogTitleDetailsSource = "balloonerismm" | "local" | "legacy";

export type PoplogTitleDetailsResult = {
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
  }>;
  sourceMeta: {
    primarySource: PoplogTitleDetailsSource;
    fallbackUsed?: boolean;
    fallbackReason?: string;
    confidence?: number;
    resolvedFrom?: PoplogTitleIdentity["resolvedFrom"];
    rawSource?: PoplogTitleDetailsSource;
  };
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
  year: number | null;
  runtime: number | null;
  episodeRunTime: unknown;
  genres: unknown;
  voteAverage: unknown;
  voteCount: number | null;
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
    title: title.title,
    originalTitle: undefined,
    overview: title.overview ?? null,
    year: title.year ?? null,
    releaseDate: title.year ? `${title.year}-01-01` : null,
    posterUrl: imageUrl(title.posterPath, "w500"),
    backdropUrl: imageUrl(title.backdropPath, "w1280"),
    genres: title.genres ?? [],
    runtime: title.runtime ?? null,
    voteAverage: title.rating ?? null,
    voteCount: title.votes ?? null,
    externalIds: {
      ...identity.externalIds,
      ...title.ids,
      balloonerismmId: identity.externalIds.balloonerismmId ?? title.ids.imdbId,
    },
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
    })),
    sourceMeta: {
      primarySource: "balloonerismm",
      confidence: identity.confidence,
      resolvedFrom: identity.resolvedFrom,
      rawSource: "balloonerismm",
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
    },
  };
}
