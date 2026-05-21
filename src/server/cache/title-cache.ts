import { normalizeTmdbTitleDetails } from "@/server/normalizers/tmdb-title-details";
import { supabaseAdmin } from "@/server/supabase/admin";
import { PoplogTitle } from "@/server/types/title";
import { PoplogTitleDetails } from "@/server/types/title-details";

type MediaType = "movie" | "tv";

export type CachedTitle = PoplogTitle | PoplogTitleDetails;

export type GetCachedTitleResult = {
  title: CachedTitle | null;
  /** Payload TMDB cru — util pra extrair watch/providers, seasons[], etc. */
  rawPayload: Record<string, unknown> | null;
};

export async function getCachedTitle(
  mediaType: MediaType,
  tmdbId: number
): Promise<CachedTitle | null> {
  const result = await getCachedTitleWithPayload(mediaType, tmdbId);
  return result.title;
}

export async function getCachedTitleWithPayload(
  mediaType: MediaType,
  tmdbId: number
): Promise<GetCachedTitleResult> {
  const { data, error } = await supabaseAdmin
    .from("poplog3_titles")
    .select("*")
    .eq("media_type", mediaType)
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  if (error) {
    console.error("[title-cache/get]", error);
    return { title: null, rawPayload: null };
  }

  if (!data) return { title: null, rawPayload: null };

  const rawPayload =
    data.tmdb_payload && typeof data.tmdb_payload === "object"
      ? (data.tmdb_payload as Record<string, unknown>)
      : null;

  if (rawPayload && Object.keys(rawPayload).length > 0) {
    const details = normalizeTmdbTitleDetails(
      rawPayload as Parameters<typeof normalizeTmdbTitleDetails>[0]
    );

    if (details) {
      return {
        title: { ...details, last_synced_at: data.last_synced_at },
        rawPayload,
      };
    }
  }

  return {
    title: {
      tmdb_id: data.tmdb_id,
      media_type: data.media_type,
      title: data.title,
      original_title: data.original_title,
      overview: data.overview,
      poster_path: data.poster_path,
      backdrop_path: data.backdrop_path,
      release_date: data.release_date,
      first_air_date: data.first_air_date,
      last_air_date: data.last_air_date,
      year: data.year,
      runtime: data.runtime,
      episode_run_time: data.episode_run_time,
      genres: data.genres ?? [],
      popularity: data.popularity,
      vote_average: data.vote_average,
      vote_count: data.vote_count,
      number_of_episodes: data.number_of_episodes,
      number_of_seasons: data.number_of_seasons,
      original_language: data.original_language,
      last_synced_at: data.last_synced_at,
    },
    rawPayload,
  };
}

function normalizeImagePath(
  path: string | null | undefined
): string | null {
  if (!path) return null;
  const trimmed = String(path).trim();
  if (trimmed.length === 0) return null;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function hasMeaningfulPayload(payload: unknown): boolean {
  if (!isPlainObject(payload)) return false;
  return Object.keys(payload).length > 0;
}

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

export async function upsertCachedTitle(
  title: CachedTitle,
  rawPayload: unknown
): Promise<UpsertCachedTitleResult> {
  if (!title?.tmdb_id || !title.media_type) {
    console.warn("[title-cache/upsert] payload sem tmdb_id/media_type.");
    return { ok: false, persisted: null, skipped: "missing-id" };
  }

  const payloadHasContent = hasMeaningfulPayload(rawPayload);

  if (
    !payloadHasContent &&
    !title.poster_path &&
    !title.backdrop_path &&
    !title.title
  ) {
    console.warn(
      `[title-cache/upsert] payload vazio para ${title.media_type}/${title.tmdb_id}.`
    );
    return { ok: false, persisted: null, skipped: "empty-payload" };
  }

  const existing = await getCachedTitle(title.media_type, title.tmdb_id);

  const nextPoster =
    normalizeImagePath(title.poster_path) ?? existing?.poster_path ?? null;
  const nextBackdrop =
    normalizeImagePath(title.backdrop_path) ?? existing?.backdrop_path ?? null;
  const nextTitle = title.title ?? existing?.title ?? null;
  const nextOverview = title.overview ?? existing?.overview ?? null;
  const nextYear = title.year ?? existing?.year ?? null;
  const nextRuntime = title.runtime ?? existing?.runtime ?? null;
  const nextEpisodeRunTime =
    title.episode_run_time ?? existing?.episode_run_time ?? null;

  const now = new Date().toISOString();

  const { error } = await supabaseAdmin.from("poplog3_titles").upsert(
    {
      tmdb_id: title.tmdb_id,
      media_type: title.media_type,
      title: nextTitle,
      original_title: title.original_title ?? existing?.original_title ?? null,
      overview: nextOverview,
      poster_path: nextPoster,
      backdrop_path: nextBackdrop,
      release_date: title.release_date || existing?.release_date || null,
      first_air_date: title.first_air_date || existing?.first_air_date || null,
      last_air_date: title.last_air_date || existing?.last_air_date || null,
      year: nextYear,
      runtime: nextRuntime,
      episode_run_time: nextEpisodeRunTime,
      genres: title.genres ?? [],
      popularity: title.popularity ?? existing?.popularity ?? null,
      vote_average: title.vote_average ?? existing?.vote_average ?? null,
      vote_count: title.vote_count ?? existing?.vote_count ?? null,
      number_of_episodes:
        "number_of_episodes" in title
          ? title.number_of_episodes ?? null
          : null,
      number_of_seasons:
        "number_of_seasons" in title
          ? title.number_of_seasons ?? null
          : null,
      original_language:
        title.original_language ?? existing?.original_language ?? null,
      tmdb_payload: payloadHasContent ? rawPayload : undefined,
      updated_at: now,
      last_synced_at: now,
    },
    {
      onConflict: "tmdb_id,media_type",
    }
  );

  if (error) {
    console.error(
      `[title-cache/upsert] erro em ${title.media_type}/${title.tmdb_id}:`,
      error
    );
    throw new Error(
      `Falha ao persistir titulo ${title.media_type}/${title.tmdb_id}: ${error.message}`
    );
  }

  const { data: persistedRow, error: readError } = await supabaseAdmin
    .from("poplog3_titles")
    .select("poster_path,backdrop_path,title,tmdb_payload")
    .eq("tmdb_id", title.tmdb_id)
    .eq("media_type", title.media_type)
    .maybeSingle();

  if (readError) {
    console.warn(
      `[title-cache/upsert] re-leitura falhou ${title.media_type}/${title.tmdb_id}:`,
      readError
    );
    return { ok: true, persisted: null };
  }

  const persistedPayload = persistedRow?.tmdb_payload;
  const payloadKeys = isPlainObject(persistedPayload)
    ? Object.keys(persistedPayload).length
    : 0;

  return {
    ok: true,
    persisted: persistedRow
      ? {
          poster_path: persistedRow.poster_path ?? null,
          backdrop_path: persistedRow.backdrop_path ?? null,
          title: persistedRow.title ?? null,
          payload_keys: payloadKeys,
        }
      : null,
  };
}
