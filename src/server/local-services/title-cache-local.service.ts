import { normalizeTmdbTitleDetails } from "@/server/normalizers/tmdb-title-details";
import {
  deleteCachedTitleRow,
  getCachedTitleRow,
  isTitleCacheFresh,
  isTitlePayloadComplete,
  upsertCachedTitleRow,
} from "@/server/repositories";
import type { PoplogTitle } from "@/server/types/title";
import type { PoplogTitleDetails } from "@/server/types/title-details";
import { recoverTitleFromRowSync } from "@/server/titles/recover-canonical-title";

type MediaType = "movie" | "tv";

export type CachedTitle = PoplogTitle | PoplogTitleDetails;

export type GetCachedTitleResult = {
  title: CachedTitle | null;
  rawPayload: Record<string, unknown> | null;
};

export type UpsertCachedTitleResult = {
  ok: boolean;
  persisted: {
    poster_path: string | null;
    backdrop_path: string | null;
    title: string | null;
    payload_keys: number;
  } | null;
  error?: string;
  skipped?: "empty-payload" | "missing-id";
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasMeaningfulPayload(payload: unknown): boolean {
  return isPlainObject(payload) && Object.keys(payload).length > 0;
}

function dateToString(value: Date | null): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

export async function getCachedTitle(mediaType: MediaType, tmdbId: number): Promise<CachedTitle | null> {
  const result = await getCachedTitleWithPayload(mediaType, tmdbId);
  return result.title;
}

export async function getCachedTitleWithPayload(
  mediaType: MediaType,
  tmdbId: number,
): Promise<GetCachedTitleResult> {
  const row = await getCachedTitleRow(mediaType, tmdbId);
  if (!row) return { title: null, rawPayload: null };

  const rawPayload = isPlainObject(row.tmdbPayload) ? row.tmdbPayload : null;
  if (rawPayload && Object.keys(rawPayload).length > 0) {
    const details = normalizeTmdbTitleDetails(
      rawPayload as Parameters<typeof normalizeTmdbTitleDetails>[0],
    );
    if (details) {
      return {
        title: { ...details, last_synced_at: (row.lastSyncedAt ?? new Date(0)).toISOString() },
        rawPayload,
      };
    }
  }

  // Sem payload normalizável: recuperação canônica LOCAL antes de devolver.
  const recovered = recoverTitleFromRowSync({
    id: row.id,
    tmdbId: row.tmdbId,
    imdbId: row.imdbId,
    traktId: row.traktId,
    slug: row.slug,
    mediaType: row.mediaType,
    title: row.title,
    originalTitle: row.originalTitle,
    tmdbPayload: row.tmdbPayload,
    sourcePayload: row.sourcePayload,
  });
  return {
    title: {
      tmdb_id: row.tmdbId,
      media_type: row.mediaType,
      title: recovered.title ?? row.title ?? "",
      original_title: row.originalTitle,
      overview: row.overview,
      poster_path: row.posterPath,
      backdrop_path: row.backdropPath,
      release_date: dateToString(row.releaseDate),
      first_air_date: dateToString(row.firstAirDate),
      last_air_date: dateToString(row.lastAirDate),
      year: row.year,
      runtime: row.runtime,
      episode_run_time: row.episodeRunTime as number[] | null,
      genres: (row.genres ?? []) as unknown as number[],
      popularity: row.popularity === null ? null : Number(row.popularity),
      vote_average: row.voteAverage === null ? null : Number(row.voteAverage),
      vote_count: row.voteCount,
      number_of_episodes: row.numberOfEpisodes,
      number_of_seasons: row.numberOfSeasons,
      original_language: row.originalLanguage,
      last_synced_at: (row.lastSyncedAt ?? new Date(0)).toISOString(),
    },
    rawPayload,
  };
}

export async function upsertCachedTitle(
  title: CachedTitle,
  rawPayload: unknown,
): Promise<UpsertCachedTitleResult> {
  if (!title?.tmdb_id || !title.media_type) {
    return { ok: false, persisted: null, skipped: "missing-id" };
  }

  const payloadHasContent = hasMeaningfulPayload(rawPayload);
  if (!payloadHasContent && !title.poster_path && !title.backdrop_path && !title.title) {
    return { ok: false, persisted: null, skipped: "empty-payload" };
  }

  const ok = await upsertCachedTitleRow({
    tmdbId: title.tmdb_id,
    mediaType: title.media_type,
    title: title.title,
    originalTitle: title.original_title,
    overview: title.overview,
    posterPath: title.poster_path,
    backdropPath: title.backdrop_path,
    releaseDate: title.release_date,
    firstAirDate: title.first_air_date,
    lastAirDate: "last_air_date" in title ? title.last_air_date : null,
    year: title.year,
    runtime: title.runtime,
    episodeRunTime: title.episode_run_time,
    genres: title.genres ?? [],
    popularity: title.popularity,
    voteAverage: title.vote_average,
    voteCount: title.vote_count,
    numberOfEpisodes: "number_of_episodes" in title ? title.number_of_episodes : null,
    numberOfSeasons: "number_of_seasons" in title ? title.number_of_seasons : null,
    originalLanguage: title.original_language,
    tmdbPayload: payloadHasContent ? rawPayload : undefined,
  });

  if (!ok) return { ok: false, persisted: null, error: "Falha ao persistir titulo local." };

  const row = await getCachedTitleRow(title.media_type, title.tmdb_id);
  const payload = row?.tmdbPayload;
  return {
    ok: true,
    persisted: row
      ? {
          poster_path: row.posterPath,
          backdrop_path: row.backdropPath,
          title: row.title,
          payload_keys: isPlainObject(payload) ? Object.keys(payload).length : 0,
        }
      : null,
  };
}

export async function deleteCachedTitle(mediaType: MediaType, tmdbId: number): Promise<boolean> {
  return deleteCachedTitleRow(mediaType, tmdbId);
}

export { isTitleCacheFresh, isTitlePayloadComplete };
