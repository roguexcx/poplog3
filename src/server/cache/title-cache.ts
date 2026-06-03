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
  const local = await import("@/server/local-services/title-cache-local.service");
  return await local.getCachedTitleWithPayload(mediaType, tmdbId);
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
  const local = await import("@/server/local-services/title-cache-local.service");
  return await local.upsertCachedTitle(title, rawPayload);
}
