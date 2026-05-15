import { PoplogTitle } from "@/server/types/title";
import { PoplogTitleDetails } from "@/server/types/title-details";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import {
  isTitleCacheFresh,
  isTitlePayloadComplete,
} from "@/server/cache/is-title-cache-fresh";
import { upsertExternalIds } from "@/server/cache/external-ids-cache";

import {
  getCachedTitleWithPayload,
  upsertCachedTitle,
  type UpsertCachedTitleResult,
} from "@/server/cache/title-cache";

import {
  normalizeTmdbTitleDetails,
  type TmdbTitleDetailsPayload,
} from "@/server/normalizers/tmdb-title-details";

type MediaType = "movie" | "tv";

type SyncTmdbTitleOptions = {
  force?: boolean;
};

type SyncTmdbTitleResult = {
  title: PoplogTitle | PoplogTitleDetails;
  source: "cache" | "tmdb";
  cache_status:
    | "fresh"
    | "created"
    | "stale_refreshed"
    | "force_refreshed"
    | "payload_incomplete_refreshed";
  persistence?: UpsertCachedTitleResult;
  rawPayload?: TmdbTitlePayload | Record<string, unknown> | null;
};

type TmdbImageEntry = {
  file_path: string;
  iso_639_1?: string | null;
  vote_average?: number;
  vote_count?: number;
};

type TmdbImagesPayload = {
  posters?: TmdbImageEntry[];
  backdrops?: TmdbImageEntry[];
  logos?: TmdbImageEntry[];
};

type TmdbTitlePayload = TmdbTitleDetailsPayload & {
  images?: TmdbImagesPayload;
  external_ids?: {
    imdb_id?: string | null;
    tvdb_id?: number | string | null;
    freebase_mid?: string | null;
  } | null;
};

function pickBestImage(entries: TmdbImageEntry[] | undefined): string | null {
  if (!entries || entries.length === 0) return null;

  const preferredLangs: (string | null | undefined)[] = [null, "en", "pt"];

  for (const lang of preferredLangs) {
    const matches = entries.filter((entry) => {
      const entryLang = entry.iso_639_1 ?? null;
      return entryLang === lang;
    });

    if (matches.length > 0) {
      const sorted = matches
        .slice()
        .sort((a, b) => (b.vote_average ?? 0) - (a.vote_average ?? 0));
      return sorted[0]?.file_path ?? null;
    }
  }

  return entries[0]?.file_path ?? null;
}

function assertValidTmdbPayload(
  payload: unknown,
  mediaType: MediaType,
  id: number
): asserts payload is TmdbTitlePayload {
  if (!payload || typeof payload !== "object") {
    throw new Error(`TMDB ${mediaType}/${id} retornou payload invalido.`);
  }
  const obj = payload as Record<string, unknown>;
  if (typeof obj.id !== "number") {
    throw new Error(`TMDB ${mediaType}/${id} retornou payload sem 'id'.`);
  }
  if (!obj.title && !obj.name) {
    throw new Error(`TMDB ${mediaType}/${id} retornou payload sem 'title' nem 'name'.`);
  }
}

const APPEND =
  "credits,videos,images,recommendations,similar,external_ids,watch/providers";

export async function syncTmdbTitle(
  mediaType: MediaType,
  id: number,
  options: SyncTmdbTitleOptions = {}
): Promise<SyncTmdbTitleResult> {
  const cached = await getCachedTitleWithPayload(mediaType, id);

  // Cache fresh E payload completo: retorna direto.
  if (
    !options.force &&
    cached.title &&
    isTitleCacheFresh(cached.title.last_synced_at) &&
    isTitlePayloadComplete(cached.rawPayload)
  ) {
    return {
      title: cached.title,
      source: "cache",
      cache_status: "fresh",
      rawPayload: cached.rawPayload,
    };
  }

  const willForceForIncompleteness =
    !options.force &&
    cached.title &&
    isTitleCacheFresh(cached.title.last_synced_at) &&
    !isTitlePayloadComplete(cached.rawPayload);

  const data = await tmdbFetch<TmdbTitlePayload>(`/${mediaType}/${id}`, {
    params: {
      append_to_response: APPEND,
      include_image_language: "pt,en,null",
      language: "pt-BR",
    },
  });

  assertValidTmdbPayload(data, mediaType, id);

  let posterPath = data.poster_path ?? null;
  let backdropPath = data.backdrop_path ?? null;
  let englishData: TmdbTitlePayload | null = null;

  if (!posterPath || !backdropPath) {
    try {
      const fetched = await tmdbFetch<TmdbTitlePayload>(`/${mediaType}/${id}`, {
        params: {
          append_to_response: APPEND,
          include_image_language: "en,null",
          language: "en-US",
        },
      });
      assertValidTmdbPayload(fetched, mediaType, id);
      englishData = fetched;

      posterPath = posterPath ?? englishData.poster_path ?? null;
      backdropPath = backdropPath ?? englishData.backdrop_path ?? null;
    } catch (error) {
      console.warn(
        `[sync-tmdb-title] fallback en-US falhou para ${mediaType}/${id}:`,
        error instanceof Error ? error.message : error
      );
    }
  }

  const combinedImages: TmdbImagesPayload = {
    posters: [
      ...(data.images?.posters ?? []),
      ...(englishData?.images?.posters ?? []),
    ],
    backdrops: [
      ...(data.images?.backdrops ?? []),
      ...(englishData?.images?.backdrops ?? []),
    ],
  };

  if (!posterPath) posterPath = pickBestImage(combinedImages.posters);
  if (!backdropPath) backdropPath = pickBestImage(combinedImages.backdrops);

  const finalData: TmdbTitlePayload = {
    ...data,
    title: data.title ?? englishData?.title ?? undefined,
    name: data.name ?? englishData?.name ?? undefined,
    overview:
      data.overview && data.overview.trim().length > 0
        ? data.overview
        : (englishData?.overview ?? data.overview ?? undefined),
    poster_path: posterPath,
    backdrop_path: backdropPath,
    images: combinedImages,
  };

  const title = normalizeTmdbTitleDetails(finalData);

  if (!title) {
    throw new Error("Failed to normalize TMDB title.");
  }

  const persistence = await upsertCachedTitle(title, finalData);

  try {
    const externalIds = finalData.external_ids ?? null;
    const imdbId = finalData.imdb_id ?? externalIds?.imdb_id ?? null;
    const tvdbIdRaw = externalIds?.tvdb_id ?? null;
    const tvdbId =
      tvdbIdRaw === null || tvdbIdRaw === undefined
        ? null
        : String(tvdbIdRaw);

    if (imdbId || tvdbId) {
      await upsertExternalIds({
        tmdbId: title.tmdb_id,
        mediaType: title.media_type,
        imdbId,
        tvdbId,
      });
    }
  } catch (err) {
    console.warn(
      `[sync-tmdb-title] external_ids upsert falhou ${mediaType}/${id}:`,
      err instanceof Error ? err.message : err
    );
  }

  const cache_status: SyncTmdbTitleResult["cache_status"] = options.force
    ? "force_refreshed"
    : willForceForIncompleteness
      ? "payload_incomplete_refreshed"
      : cached.title
        ? "stale_refreshed"
        : "created";

  return {
    title,
    source: "tmdb",
    cache_status,
    persistence,
    rawPayload: finalData,
  };
}
