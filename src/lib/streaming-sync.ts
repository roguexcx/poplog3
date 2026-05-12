import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  isMovieOfTheNightEnabled,
  isStreamingDebugLogsEnabled,
  isStreamingSyncEnabled,
  isWatchmodeEnabled,
} from "@/lib/env";
import {
  assertWithinApiBudget,
  estimateRefreshCost,
  getApiBudgetConfig,
  getApiBudgetStatus,
  type ApiBudgetStatus,
} from "@/lib/api/api-budget";
import {
  getCachedStreamingAvailability,
  shouldRefreshStreamingAvailability,
} from "@/lib/streaming-cache";
import {
  resolveStreamingAvailability,
  type StreamingAvailabilityResult,
  type StreamingAvailabilityStatus,
} from "@/lib/streaming";

type MediaType = "movie" | "tv";

export type StreamingRefreshPriority = "critical" | "high" | "normal" | "low";
export type StreamingRefreshProfile = "quick" | "normal" | "deep" | "single" | "dryRun";

export type StreamingRefreshCandidate = {
  tmdbId: number;
  mediaType: MediaType;
  country: string;
  priority: StreamingRefreshPriority;
  reason: string;
  reasons: string[];
  streamStatus?: StreamingAvailabilityStatus;
  confidenceScore?: number;
  cacheValidUntil?: string | null;
  lastCheckedAt?: string | null;
  inferred?: boolean;
  availableAbroad?: boolean;
  userSignal?: "saved" | "watchlist" | "watching" | "favorite";
  wouldCallTmdb: boolean;
  estimatedCost: number;
};

export type RefreshSingleInput = {
  tmdbId: number;
  mediaType: MediaType;
  country?: string;
  force?: boolean;
  dryRun?: boolean;
  profile?: StreamingRefreshProfile;
};

export type RefreshManyInput = {
  country?: string;
  limit?: number;
  force?: boolean;
  dryRun?: boolean;
  profile?: StreamingRefreshProfile;
};

export type StreamingRefreshResult = {
  ok: boolean;
  dryRun: boolean;
  profile: StreamingRefreshProfile;
  estimatedCost: number;
  budget?: ApiBudgetStatus;
  refreshed: number;
  skipped: number;
  blockedReason?: string;
  candidates: StreamingRefreshCandidate[];
  results: Array<{
    tmdbId: number;
    mediaType: MediaType;
    country: string;
    success: boolean;
    cacheStatus?: "hit" | "miss" | "expired";
    availability?: StreamingAvailabilityResult;
    error?: string;
  }>;
};

type AvailabilityCandidateRow = {
  tmdb_id: number;
  media_type: MediaType;
  country: string;
  stream_status: StreamingAvailabilityStatus;
  source_confidence: number;
  inferred: boolean;
  available_abroad: boolean;
  cache_valid_until: string | null;
  last_checked_at: string | null;
  updated_at: string;
};

type UserTitleSignalRow = {
  tmdb_id: number;
  media_type: MediaType;
  status: string | null;
  favorite: boolean | null;
};

const DEFAULT_PROFILE: StreamingRefreshProfile = "normal";
const MAX_REFRESH_LIMIT = 50;

const REFRESH_PROFILES: Record<Exclude<StreamingRefreshProfile, "single" | "dryRun">, {
  defaultLimit: number;
  queryMultiplier: number;
}> = {
  quick: { defaultLimit: 5, queryMultiplier: 10 },
  normal: { defaultLimit: 10, queryMultiplier: 12 },
  deep: { defaultLimit: 25, queryMultiplier: 16 },
};

function profileFor(input?: StreamingRefreshProfile): StreamingRefreshProfile {
  if (input === "quick" || input === "normal" || input === "deep" || input === "single" || input === "dryRun") {
    return input;
  }
  return DEFAULT_PROFILE;
}

function defaultLimitForProfile(profile: StreamingRefreshProfile): number {
  if (profile === "quick" || profile === "dryRun") return REFRESH_PROFILES.quick.defaultLimit;
  if (profile === "deep") return REFRESH_PROFILES.deep.defaultLimit;
  return REFRESH_PROFILES.normal.defaultLimit;
}

function clampLimit(limit: number | undefined, profile: StreamingRefreshProfile): number {
  const fallback = defaultLimitForProfile(profile);
  if (!Number.isFinite(limit ?? fallback)) return fallback;
  return Math.max(1, Math.min(Math.floor(limit ?? fallback), MAX_REFRESH_LIMIT));
}

function isExpired(cacheValidUntil?: string | null): boolean {
  if (!cacheValidUntil) return true;
  return new Date(cacheValidUntil).getTime() <= Date.now();
}

function priorityOrder(priority: StreamingRefreshPriority): number {
  const order: Record<StreamingRefreshPriority, number> = { critical: 0, high: 1, normal: 2, low: 3 };
  return order[priority];
}

export function classifyStreamingRefreshPriority(input: {
  isExpired: boolean;
  streamStatus?: StreamingAvailabilityStatus | null;
  confidenceScore?: number | null;
  cacheValidUntil?: string | null;
  lastCheckedAt?: string | null;
  inferred?: boolean | null;
  availableAbroad?: boolean | null;
  userSignal?: StreamingRefreshCandidate["userSignal"];
  force?: boolean;
}): { priority: StreamingRefreshPriority; reason: string; reasons: string[] } {
  const reasons: string[] = [];
  if (input.force) reasons.push("force_refresh");
  if (!input.cacheValidUntil) reasons.push("cache_valid_until_missing");
  if (!input.lastCheckedAt) reasons.push("last_checked_at_missing");
  if (input.isExpired) reasons.push("cache_expired");
  if ((input.confidenceScore ?? 100) < 45) reasons.push("low_confidence");
  if (input.streamStatus === "digital_expected") reasons.push("digital_expected");
  if (input.streamStatus === "recently_released") reasons.push("recently_released");
  if (input.streamStatus === "cinema_now") reasons.push("cinema_now");
  if (input.streamStatus === "upcoming") reasons.push("upcoming");
  if (input.streamStatus === "available_abroad" || input.availableAbroad) reasons.push("available_abroad");
  if (input.inferred) reasons.push("inferred");
  if (input.userSignal) reasons.push(`user_${input.userSignal}`);

  if (input.force) return { priority: "critical", reason: "force_refresh", reasons };
  if (!input.cacheValidUntil || !input.lastCheckedAt) {
    return { priority: "critical", reason: "cache_metadata_missing", reasons };
  }
  if (!input.isExpired) {
    if ((input.confidenceScore ?? 100) < 35 || input.inferred) {
      return { priority: "high", reason: "valid_but_uncertain", reasons };
    }
    return { priority: "low", reason: "cache_valid", reasons };
  }
  if (
    input.streamStatus === "digital_expected" ||
    input.streamStatus === "cinema_now" ||
    input.streamStatus === "upcoming"
  ) {
    return { priority: "critical", reason: "hot_release_window", reasons };
  }
  if (input.userSignal === "watching" || input.userSignal === "favorite") {
    return { priority: "critical", reason: "user_signal_cache_expired", reasons };
  }
  if (
    input.userSignal ||
    input.streamStatus === "recently_released" ||
    input.streamStatus === "available_abroad" ||
    input.availableAbroad ||
    input.inferred ||
    (input.confidenceScore ?? 100) < 45
  ) {
    return { priority: "high", reason: "expired_priority_signal", reasons };
  }
  if (input.streamStatus === "available_subscription" || input.streamStatus === "available_rent") {
    return { priority: "normal", reason: "available_cache_expired", reasons };
  }
  return { priority: "low", reason: "expired_low_priority", reasons };
}

export async function logStreamingSync(entry: {
  apiName: "tmdb" | "watchmode" | "movieofthenight" | "cache";
  endpoint: string;
  status: string;
  success: boolean;
  responseTimeMs?: number;
  errorMessage?: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const supabase = createSupabaseAdminClient();
    const payload = {
      api_name: entry.apiName,
      endpoint: entry.endpoint,
      status: entry.status,
      response_time_ms: entry.responseTimeMs ?? null,
      success: entry.success,
      error_message: entry.errorMessage ?? null,
      metadata_json: entry.metadata ?? {},
    };

    const { error } = await supabase.from("api_sync_logs").insert(payload);
    if (error) {
      await supabase.from("api_sync_logs").insert({
        api_name: payload.api_name,
        endpoint: payload.endpoint,
        status: payload.status,
        response_time_ms: payload.response_time_ms,
        success: payload.success,
        error_message: payload.error_message,
      });
    }
  } catch {
    // Sync logging is best effort and must not affect refresh behavior.
  }
}

function candidateFromCache(input: {
  tmdbId: number;
  mediaType: MediaType;
  country: string;
  force?: boolean;
  streamStatus?: StreamingAvailabilityStatus;
  confidenceScore?: number;
  cacheValidUntil?: string | null;
  lastCheckedAt?: string | null;
  inferred?: boolean;
  availableAbroad?: boolean;
  userSignal?: StreamingRefreshCandidate["userSignal"];
}): StreamingRefreshCandidate {
  const expired = isExpired(input.cacheValidUntil);
  const classification = classifyStreamingRefreshPriority({
    ...input,
    isExpired: expired,
  });
  const wouldCallTmdb = Boolean(input.force || expired);
  return {
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    country: input.country,
    priority: classification.priority,
    reason: classification.reason,
    reasons: classification.reasons,
    streamStatus: input.streamStatus,
    confidenceScore: input.confidenceScore,
    cacheValidUntil: input.cacheValidUntil,
    lastCheckedAt: input.lastCheckedAt,
    inferred: input.inferred,
    availableAbroad: input.availableAbroad,
    userSignal: input.userSignal,
    wouldCallTmdb,
    estimatedCost: estimateRefreshCost({ apiName: "tmdb", items: wouldCallTmdb ? 1 : 0 }),
  };
}

function userSignalPriority(rows: UserTitleSignalRow[]): StreamingRefreshCandidate["userSignal"] | undefined {
  if (rows.some((row) => row.favorite)) return "favorite";
  if (rows.some((row) => row.status === "watching")) return "watching";
  if (rows.some((row) => row.status === "watchlist")) return "watchlist";
  if (rows.length > 0) return "saved";
  return undefined;
}

async function getUserSignals(candidates: StreamingRefreshCandidate[]): Promise<Map<string, StreamingRefreshCandidate["userSignal"]>> {
  const ids = Array.from(new Set(candidates.map((candidate) => candidate.tmdbId)));
  if (ids.length === 0) return new Map();

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("user_titles")
      .select("tmdb_id, media_type, status, favorite")
      .in("tmdb_id", ids);

    if (error || !data) return new Map();

    const grouped = new Map<string, UserTitleSignalRow[]>();
    for (const row of data as UserTitleSignalRow[]) {
      const key = `${row.media_type}:${row.tmdb_id}`;
      grouped.set(key, [...(grouped.get(key) ?? []), row]);
    }

    const signals = new Map<string, StreamingRefreshCandidate["userSignal"]>();
    for (const [key, rows] of grouped.entries()) {
      signals.set(key, userSignalPriority(rows));
    }
    return signals;
  } catch {
    return new Map();
  }
}

function sortCandidates(a: StreamingRefreshCandidate, b: StreamingRefreshCandidate): number {
  const priorityDiff = priorityOrder(a.priority) - priorityOrder(b.priority);
  if (priorityDiff !== 0) return priorityDiff;
  const confidenceDiff = (a.confidenceScore ?? 100) - (b.confidenceScore ?? 100);
  if (confidenceDiff !== 0) return confidenceDiff;
  return new Date(a.cacheValidUntil ?? 0).getTime() - new Date(b.cacheValidUntil ?? 0).getTime();
}

export async function getStreamingRefreshCandidates(input: RefreshManyInput = {}): Promise<StreamingRefreshCandidate[]> {
  const country = input.country ?? "BR";
  const profile = input.profile === "dryRun" ? "quick" : profileFor(input.profile);
  const limit = clampLimit(input.limit, profile);
  const multiplier = profile === "deep" || profile === "normal" || profile === "quick"
    ? REFRESH_PROFILES[profile].queryMultiplier
    : REFRESH_PROFILES.normal.queryMultiplier;
  const queryLimit = Math.max(limit * multiplier, 100);

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("title_streaming_availability")
      .select(`
        tmdb_id,
        media_type,
        country,
        stream_status,
        source_confidence,
        inferred,
        available_abroad,
        cache_valid_until,
        last_checked_at,
        updated_at
      `)
      .eq("country", country)
      .order("cache_valid_until", { ascending: true, nullsFirst: true })
      .limit(queryLimit);

    if (error || !data) return [];

    const seen = new Set<string>();
    const baseCandidates: StreamingRefreshCandidate[] = [];
    for (const row of data as AvailabilityCandidateRow[]) {
      const key = `${row.media_type}:${row.tmdb_id}:${row.country}`;
      if (seen.has(key)) continue;
      seen.add(key);
      baseCandidates.push(candidateFromCache({
        tmdbId: row.tmdb_id,
        mediaType: row.media_type,
        country: row.country,
        force: input.force,
        streamStatus: row.stream_status,
        confidenceScore: row.source_confidence,
        cacheValidUntil: row.cache_valid_until,
        lastCheckedAt: row.last_checked_at,
        inferred: row.inferred,
        availableAbroad: row.available_abroad,
      }));
    }

    const userSignals = await getUserSignals(baseCandidates);
    const enriched = baseCandidates.map((candidate) => candidateFromCache({
      ...candidate,
      force: input.force,
      userSignal: userSignals.get(`${candidate.mediaType}:${candidate.tmdbId}`),
    }));

    return enriched.sort(sortCandidates).slice(0, limit);
  } catch {
    return [];
  }
}

export async function refreshSingleTitleAvailability(input: RefreshSingleInput): Promise<StreamingRefreshResult> {
  const country = input.country ?? "BR";
  const profile = input.profile === "dryRun" ? "dryRun" : "single";
  const dryRun = Boolean(input.dryRun || input.profile === "dryRun");
  const cached = await getCachedStreamingAvailability({
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    country,
  });
  const candidate = candidateFromCache({
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    country,
    force: input.force,
    streamStatus: cached?.availability.streamStatus,
    confidenceScore: cached?.availability.confidenceScore,
    cacheValidUntil: cached?.cacheValidUntil ?? null,
    lastCheckedAt: cached?.availability.lastCheckedAt ?? null,
    inferred: cached?.availability.inferred,
    availableAbroad: cached?.availability.availableAbroad,
  });
  const estimatedCost = candidate.estimatedCost;

  if (dryRun) {
    return { ok: true, dryRun, profile, estimatedCost, refreshed: 0, skipped: 1, candidates: [candidate], results: [] };
  }

  if (!isStreamingSyncEnabled()) {
    await logStreamingSync({
      apiName: "cache",
      endpoint: `streaming-refresh/${input.mediaType}/${input.tmdbId}`,
      status: "skipped_disabled",
      success: false,
      errorMessage: "STREAMING_SYNC_ENABLED=false",
      metadata: {
        refresh_profile: profile,
        items_requested: 1,
        items_processed: 0,
        items_skipped: 1,
        dry_run: false,
        country,
        reason: "STREAMING_SYNC_ENABLED=false",
      },
    });
    return {
      ok: false,
      dryRun,
      profile,
      estimatedCost,
      refreshed: 0,
      skipped: 1,
      blockedReason: "STREAMING_SYNC_ENABLED=false",
      candidates: [candidate],
      results: [],
    };
  }

  if (!shouldRefreshStreamingAvailability(cached, input.force)) {
    return {
      ok: true,
      dryRun,
      profile,
      estimatedCost: 0,
      refreshed: 0,
      skipped: 1,
      candidates: [candidate],
      results: [{ tmdbId: input.tmdbId, mediaType: input.mediaType, country, success: true, cacheStatus: "hit" }],
    };
  }

  let budget: ApiBudgetStatus;
  try {
    budget = await assertWithinApiBudget({ apiName: "tmdb", estimatedCost });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Budget indisponivel.";
    await logStreamingSync({
      apiName: "cache",
      endpoint: `streaming-refresh/${input.mediaType}/${input.tmdbId}`,
      status: "skipped_budget",
      success: false,
      errorMessage,
      metadata: {
        refresh_profile: profile,
        items_requested: 1,
        items_processed: 0,
        items_skipped: 1,
        dry_run: false,
        country,
        source_api: "tmdb",
        reason: "budget_guard",
      },
    });
    return {
      ok: false,
      dryRun,
      profile,
      estimatedCost,
      refreshed: 0,
      skipped: 1,
      blockedReason: errorMessage,
      candidates: [candidate],
      results: [],
    };
  }

  const startedAt = Date.now();
  try {
    const availability = await resolveStreamingAvailability(input.tmdbId, input.mediaType, {
      forceRefresh: true,
      useCache: true,
    }, country);
    await logStreamingSync({
      apiName: "tmdb",
      endpoint: `/${input.mediaType}/${input.tmdbId}/watch/providers`,
      status: "refreshed",
      success: true,
      responseTimeMs: Date.now() - startedAt,
      metadata: {
        refresh_profile: profile,
        items_requested: 1,
        items_processed: 1,
        items_skipped: 0,
        dry_run: false,
        country,
        source_api: "tmdb",
        reason: candidate.reason,
      },
    });
    return {
      ok: true,
      dryRun,
      profile,
      estimatedCost,
      budget,
      refreshed: 1,
      skipped: 0,
      candidates: [candidate],
      results: [{
        tmdbId: input.tmdbId,
        mediaType: input.mediaType,
        country,
        success: true,
        cacheStatus: cached ? "expired" : "miss",
        availability,
      }],
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await logStreamingSync({
      apiName: "tmdb",
      endpoint: `/${input.mediaType}/${input.tmdbId}/watch/providers`,
      status: "error",
      success: false,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      metadata: {
        refresh_profile: profile,
        items_requested: 1,
        items_processed: 0,
        items_skipped: 0,
        dry_run: false,
        country,
        source_api: "tmdb",
        reason: candidate.reason,
      },
    });
    return {
      ok: false,
      dryRun,
      profile,
      estimatedCost,
      budget,
      refreshed: 0,
      skipped: 0,
      candidates: [candidate],
      results: [{ tmdbId: input.tmdbId, mediaType: input.mediaType, country, success: false, error: errorMessage }],
    };
  }
}

export async function refreshManyStreamingAvailability(input: RefreshManyInput = {}): Promise<StreamingRefreshResult> {
  const requestedProfile = profileFor(input.profile);
  const dryRun = Boolean(input.dryRun || requestedProfile === "dryRun");
  const profile = requestedProfile === "single" ? DEFAULT_PROFILE : requestedProfile;
  const limit = clampLimit(input.limit, profile);
  const candidates = await getStreamingRefreshCandidates({ ...input, limit, profile });
  const estimatedCost = estimateRefreshCost({
    apiName: "tmdb",
    items: candidates.filter((candidate) => candidate.wouldCallTmdb).length,
    dryRun,
  });

  if (dryRun) {
    return { ok: true, dryRun, profile, estimatedCost, refreshed: 0, skipped: candidates.length, candidates, results: [] };
  }

  if (!isStreamingSyncEnabled()) {
    await logStreamingSync({
      apiName: "cache",
      endpoint: "streaming-refresh/batch",
      status: "skipped_disabled",
      success: false,
      errorMessage: "STREAMING_SYNC_ENABLED=false",
      metadata: {
        refresh_profile: profile,
        items_requested: limit,
        items_processed: 0,
        items_skipped: candidates.length,
        dry_run: false,
        country: input.country ?? "BR",
        reason: "STREAMING_SYNC_ENABLED=false",
      },
    });
    return {
      ok: false,
      dryRun,
      profile,
      estimatedCost,
      refreshed: 0,
      skipped: candidates.length,
      blockedReason: "STREAMING_SYNC_ENABLED=false",
      candidates,
      results: [],
    };
  }

  let budget: ApiBudgetStatus;
  try {
    budget = await assertWithinApiBudget({ apiName: "tmdb", estimatedCost });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Budget indisponivel.";
    await logStreamingSync({
      apiName: "cache",
      endpoint: "streaming-refresh/batch",
      status: "skipped_budget",
      success: false,
      errorMessage,
      metadata: {
        refresh_profile: profile,
        items_requested: limit,
        items_processed: 0,
        items_skipped: candidates.length,
        dry_run: false,
        country: input.country ?? "BR",
        source_api: "tmdb",
        reason: "budget_guard",
      },
    });
    return {
      ok: false,
      dryRun,
      profile,
      estimatedCost,
      refreshed: 0,
      skipped: candidates.length,
      blockedReason: errorMessage,
      candidates,
      results: [],
    };
  }

  const results: StreamingRefreshResult["results"] = [];
  let refreshed = 0;
  let skipped = 0;
  const startedAt = Date.now();

  for (const candidate of candidates.slice(0, limit)) {
    const result = await refreshSingleTitleAvailability({
      tmdbId: candidate.tmdbId,
      mediaType: candidate.mediaType,
      country: candidate.country,
      force: input.force,
      dryRun: false,
      profile: "single",
    });
    refreshed += result.refreshed;
    skipped += result.skipped;
    results.push(...result.results);
  }

  await logStreamingSync({
    apiName: "cache",
    endpoint: "streaming-refresh/batch",
    status: results.every((result) => result.success) ? "batch_completed" : "batch_completed_with_errors",
    success: results.every((result) => result.success),
    responseTimeMs: Date.now() - startedAt,
    metadata: {
      refresh_profile: profile,
      items_requested: limit,
      items_processed: refreshed,
      items_skipped: skipped,
      dry_run: false,
      country: input.country ?? "BR",
      source_api: "tmdb",
      reason: "batch_refresh",
    },
  });

  return {
    ok: results.every((result) => result.success),
    dryRun,
    profile,
    estimatedCost,
    budget,
    refreshed,
    skipped,
    candidates,
    results,
  };
}

export const refreshStreamingAvailability = refreshManyStreamingAvailability;

function nextProfileSuggestion(input: {
  expiredRecords: number;
  criticalCandidates: number;
  highCandidates: number;
}): StreamingRefreshProfile {
  if (input.expiredRecords === 0) return "quick";
  if (input.criticalCandidates > 0 || input.highCandidates > 5) return "normal";
  if (input.expiredRecords > 25) return "deep";
  return "quick";
}

export async function getStreamingSyncStatus() {
  const flags = {
    streamingSyncEnabled: isStreamingSyncEnabled(),
    watchmodeEnabled: isWatchmodeEnabled(),
    movieOfTheNightEnabled: isMovieOfTheNightEnabled(),
    streamingDebugLogs: isStreamingDebugLogsEnabled(),
  };

  const budgetConfig = getApiBudgetConfig();

  try {
    const supabase = createSupabaseAdminClient();
    const now = new Date().toISOString();
    const [
      availabilityCount,
      expiredCount,
      validCount,
      missingCacheUntilCount,
      inferredCount,
      availableAbroadCount,
      providerCount,
      confidenceRows,
      logs,
      tmdbBudget,
      watchmodeBudget,
      movieOfTheNightBudget,
      quickCandidates,
    ] = await Promise.all([
      supabase.from("title_streaming_availability").select("id", { count: "exact", head: true }),
      supabase.from("title_streaming_availability").select("id", { count: "exact", head: true }).lte("cache_valid_until", now),
      supabase.from("title_streaming_availability").select("id", { count: "exact", head: true }).gt("cache_valid_until", now),
      supabase.from("title_streaming_availability").select("id", { count: "exact", head: true }).is("cache_valid_until", null),
      supabase.from("title_streaming_availability").select("id", { count: "exact", head: true }).eq("inferred", true),
      supabase.from("title_streaming_availability").select("id", { count: "exact", head: true }).eq("available_abroad", true),
      supabase.from("streaming_providers").select("id", { count: "exact", head: true }),
      supabase.from("title_streaming_availability").select("source_confidence").limit(5000),
      supabase
        .from("api_sync_logs")
        .select("api_name, endpoint, status, response_time_ms, success, error_message, metadata_json, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      getApiBudgetStatus({ apiName: "tmdb" }),
      getApiBudgetStatus({ apiName: "watchmode" }),
      getApiBudgetStatus({ apiName: "movieofthenight" }),
      getStreamingRefreshCandidates({ profile: "quick", dryRun: true }),
    ]);

    const confidenceValues = ((confidenceRows.data ?? []) as Array<{ source_confidence: number | null }>)
      .map((row) => row.source_confidence)
      .filter((value): value is number => typeof value === "number");
    const averageConfidence = confidenceValues.length
      ? Math.round(confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length)
      : null;
    const criticalCandidates = quickCandidates.filter((candidate) => candidate.priority === "critical").length;
    const highCandidates = quickCandidates.filter((candidate) => candidate.priority === "high").length;

    return {
      ok: true,
      flags,
      availabilityRecords: availabilityCount.count ?? 0,
      expiredRecords: expiredCount.count ?? 0,
      validRecords: validCount.count ?? 0,
      missingCacheValidUntilRecords: missingCacheUntilCount.count ?? 0,
      averageConfidence,
      inferredRecords: inferredCount.count ?? 0,
      availableAbroadRecords: availableAbroadCount.count ?? 0,
      providers: providerCount.count ?? 0,
      recentLogs: logs.data ?? [],
      budgets: {
        config: budgetConfig,
        tmdb: tmdbBudget,
        watchmode: watchmodeBudget,
        movieOfTheNight: movieOfTheNightBudget,
      },
      suggestedNextProfile: nextProfileSuggestion({
        expiredRecords: expiredCount.count ?? 0,
        criticalCandidates,
        highCandidates,
      }),
      candidatePreview: quickCandidates,
    };
  } catch (error) {
    return {
      ok: false,
      flags,
      budgets: { config: budgetConfig },
      error: error instanceof Error ? error.message : "Status indisponivel",
    };
  }
}
