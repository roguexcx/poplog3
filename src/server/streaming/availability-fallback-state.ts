import { db } from "@/server/db/client";

type MediaType = "movie" | "tv";
type FallbackSource = "watchmode" | "movieofthenight";
type FallbackResult = "ok" | "empty" | "failed" | "blocked" | "cooldown";

export type AvailabilityFallbackOrigin = {
  endpoint?: string | null;
  userId?: string | null;
  action?: string | null;
  reason?: string | null;
};

export async function getFallbackState(input: {
  tmdbId: number;
  mediaType: MediaType;
  region: string;
  source: FallbackSource;
}): Promise<{
  fallback_checked_at: string | null;
  fallback_result: string | null;
  next_fallback_allowed_at: string | null;
} | null> {
  const row = await db.poplog3AvailabilityFallbackState.findUnique({
    where: {
      tmdbId_mediaType_region_fallbackSource: {
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        region: input.region,
        fallbackSource: input.source,
      },
    },
  });

  if (!row) return null;

  return {
    fallback_checked_at: row.fallbackCheckedAt.toISOString(),
    fallback_result: row.fallbackResult,
    next_fallback_allowed_at: row.nextFallbackAllowedAt.toISOString(),
  };
}

export async function isFallbackAllowed(input: {
  tmdbId: number;
  mediaType: MediaType;
  region: string;
  source: FallbackSource;
}) {
  const state = await getFallbackState(input);
  const next = state?.next_fallback_allowed_at
    ? new Date(state.next_fallback_allowed_at).getTime()
    : 0;

  return {
    allowed: !Number.isFinite(next) || next <= Date.now(),
    state,
  };
}

export async function recordFallbackState(input: {
  tmdbId: number;
  mediaType: MediaType;
  region: string;
  source: FallbackSource;
  result: FallbackResult;
  nextAllowedAt: string;
  rowsCount?: number;
  error?: string | null;
  origin?: AvailabilityFallbackOrigin;
}) {
  const now = new Date().toISOString();
  await db.poplog3AvailabilityFallbackState.upsert({
    where: {
      tmdbId_mediaType_region_fallbackSource: {
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        region: input.region,
        fallbackSource: input.source,
      },
    },
    update: {
      fallbackCheckedAt: new Date(now),
      fallbackResult: input.result,
      nextFallbackAllowedAt: new Date(input.nextAllowedAt),
      reason: input.origin?.reason ?? null,
      originEndpoint: input.origin?.endpoint ?? null,
      userId: input.origin?.userId ?? null,
      action: input.origin?.action ?? null,
      rowsCount: input.rowsCount ?? 0,
      error: input.error ?? null,
    },
    create: {
      tmdbId: input.tmdbId,
      mediaType: input.mediaType,
      region: input.region,
      fallbackSource: input.source,
      fallbackCheckedAt: new Date(now),
      fallbackResult: input.result,
      nextFallbackAllowedAt: new Date(input.nextAllowedAt),
      reason: input.origin?.reason ?? null,
      originEndpoint: input.origin?.endpoint ?? null,
      userId: input.origin?.userId ?? null,
      action: input.origin?.action ?? null,
      rowsCount: input.rowsCount ?? 0,
      error: input.error ?? null,
    },
  });
}
