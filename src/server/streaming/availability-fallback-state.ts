import { db } from "@/server/db/client";
import { isLocalAvailabilityEnabled } from "@/server/runtime/local-db-flags";
import { supabaseAdmin } from "@/server/supabase/admin";

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
  if (isLocalAvailabilityEnabled()) {
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

  const { data, error } = await supabaseAdmin
    .from("poplog3_availability_fallback_state")
    .select("fallback_checked_at, fallback_result, next_fallback_allowed_at")
    .eq("tmdb_id", input.tmdbId)
    .eq("media_type", input.mediaType)
    .eq("region", input.region)
    .eq("fallback_source", input.source)
    .maybeSingle();

  if (error) {
    console.error("[availability-fallback-state] read failed", { input, error });
    return null;
  }

  return data as {
    fallback_checked_at: string | null;
    fallback_result: string | null;
    next_fallback_allowed_at: string | null;
  } | null;
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
  if (isLocalAvailabilityEnabled()) {
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
    return;
  }

  const { error } = await supabaseAdmin
    .from("poplog3_availability_fallback_state")
    .upsert(
      {
        tmdb_id: input.tmdbId,
        media_type: input.mediaType,
        region: input.region,
        fallback_source: input.source,
        fallback_checked_at: now,
        fallback_result: input.result,
        next_fallback_allowed_at: input.nextAllowedAt,
        reason: input.origin?.reason ?? null,
        origin_endpoint: input.origin?.endpoint ?? null,
        user_id: input.origin?.userId ?? null,
        action: input.origin?.action ?? null,
        rows_count: input.rowsCount ?? 0,
        error: input.error ?? null,
        updated_at: now,
      },
      { onConflict: "tmdb_id,media_type,region,fallback_source" },
    );

  if (error) {
    console.error("[availability-fallback-state] write failed", { input, error });
  }
}
