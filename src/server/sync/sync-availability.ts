import { logApiCall } from "@/server/engine-logger";
import { debugLog, formatError, isDebugEnabled, rateLimitedWarn } from "@/server/logging/log-control";
import { motnFetch } from "@/server/api-clients/movieofthenight/client";
import type { MotnTitleResponse } from "@/server/api-clients/movieofthenight/types";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { watchmodeFetch } from "@/server/api-clients/watchmode/client";
import type { WatchmodeSource } from "@/server/api-clients/watchmode/types";

import {
  getAvailability,
  isAvailabilityFresh,
  replaceAvailability,
  type AvailabilityRow,
  type AvailabilitySource,
  type AvailabilityType,
} from "@/server/cache/availability-cache";
import {
  completePremiumApiBudget,
  reservePremiumApiBudget,
  runPremiumApiQueued,
} from "@/server/rate-limits/premium-api-budget";
import {
  isFallbackAllowed,
  recordFallbackState,
  type AvailabilityFallbackOrigin,
} from "@/server/streaming/availability-fallback-state";

type MediaType = "movie" | "tv";

type TmdbProviderEntry = {
  provider_id?: number;
  provider_name?: string;
  logo_path?: string | null;
  display_priority?: number;
};

type TmdbWatchProvidersPayload = {
  results?: Record<
    string,
    {
      link?: string;
      flatrate?: TmdbProviderEntry[];
      rent?: TmdbProviderEntry[];
      buy?: TmdbProviderEntry[];
      free?: TmdbProviderEntry[];
      ads?: TmdbProviderEntry[];
    }
  >;
};

export type TmdbPayloadWithWatch = {
  ["watch/providers"]?: TmdbWatchProvidersPayload;
};

export type SyncAvailabilityInput = {
  tmdbId: number;
  mediaType: MediaType;
  country?: string;
  tmdbPayload?: TmdbPayloadWithWatch | null;
  imdbId?: string | null;
  force?: boolean;
  maxAgeDays?: number;
  allowExternalFallback?: boolean;
  premiumTtlDays?: number;
  origin?: {
    endpoint: string;
    userId?: string | null;
    action?: string | null;
    reason?: string | null;
  };
};

export type SyncAvailabilityResult = {
  source: AvailabilitySource | "cache" | "none";
  rows: AvailabilityRow[];
  diagnostics: {
    tmdb: "ok" | "empty" | "not_attempted";
    watchmode: "ok" | "empty" | "failed" | "not_attempted";
    motn: "ok" | "empty" | "failed" | "not_attempted";
  };
};

const EXTERNAL_FALLBACK_COOLDOWN_MS = 60 * 60 * 1000;
const AVAILABILITY_LOG_TTL_MS = 5 * 60 * 1000;
const externalFallbackCooldown = new Map<string, number>();
const externalFallbackInflight = new Map<string, Promise<SyncAvailabilityResult>>();

function fallbackKey(input: {
  tmdbId: number;
  mediaType: MediaType;
  country: string;
}) {
  return `${input.mediaType}:${input.tmdbId}:${input.country}`;
}

function logFallbackDecision(
  message: string,
  input: SyncAvailabilityInput & { country: string },
  extra?: Record<string, unknown>,
) {
  const payload = {
    message,
    endpoint: input.origin?.endpoint ?? "unknown",
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    country: input.country,
    userId: input.origin?.userId ?? null,
    action: input.origin?.action ?? null,
    reason: input.origin?.reason ?? null,
    ...extra,
  };

  debugLog("DEBUG_AVAILABILITY", "[availability/fallback:debug]", payload);

  if (isDebugEnabled("DEBUG_AVAILABILITY")) return;
  if (!/blocked|skipped|deduped/i.test(message)) return;

  rateLimitedWarn(
    `availability:fallback:${message}`,
    AVAILABILITY_LOG_TTL_MS,
    [
      message.includes("blocked")
        ? "[availability] fallback externo bloqueado"
        : "[availability] fallback externo adiado",
      `- motivo: ${message}`,
      "- ocorrências iguais serão agrupadas",
    ].join("\n"),
  );
}

function nextAllowedIso(days: number) {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

function fallbackOrigin(input: SyncAvailabilityInput): AvailabilityFallbackOrigin {
  return {
    endpoint: input.origin?.endpoint ?? null,
    userId: input.origin?.userId ?? null,
    action: input.origin?.action ?? null,
    reason: input.origin?.reason ?? null,
  };
}

async function fetchTmdbWatchProviders(
  tmdbId: number,
  mediaType: MediaType,
): Promise<TmdbWatchProvidersPayload | null> {
  try {
    return await tmdbFetch<TmdbWatchProvidersPayload>(
      `/${mediaType}/${tmdbId}/watch/providers`,
      {
        params: { language: "en-US" },
        revalidate: 60 * 60 * 12,
      },
    );
  } catch (error) {
    rateLimitedWarn(
      "availability:tmdb-watch-providers-failed",
      AVAILABILITY_LOG_TTL_MS,
      "[availability] TMDB watch/providers falhou\n- fallback aplicado: cache ou vazio",
      formatError(error),
    );
    return null;
  }
}

function tmdbCategoryToType(category: string): AvailabilityType | null {
  switch (category) {
    case "flatrate":
      return "streaming";
    case "rent":
      return "rent";
    case "buy":
      return "buy";
    case "free":
      return "free";
    case "ads":
      return "ads";
    default:
      return null;
  }
}

function motnTypeToAvailabilityType(t: string | undefined): AvailabilityType | null {
  if (!t) return null;

  switch (t) {
    case "subscription":
    case "addon":
      return "streaming";
    case "rent":
      return "rent";
    case "buy":
      return "buy";
    case "free":
      return "free";
    default:
      return null;
  }
}

function watchmodeTypeToAvailabilityType(t: string | undefined): AvailabilityType | null {
  if (!t) return null;

  switch (t) {
    case "sub":
    case "subscription":
      return "streaming";
    case "rent":
      return "rent";
    case "buy":
    case "purchase":
      return "buy";
    case "free":
      return "free";
    case "ads":
    case "tve":
      return "ads";
    default:
      return null;
  }
}

function extractTmdbRows(
  payload: TmdbWatchProvidersPayload | null | undefined,
  country: string
): Array<{
  providerName: string;
  providerLogoPath: string | null;
  tmdbProviderId: number | null;
  availabilityType: AvailabilityType;
  rawPayload: TmdbProviderEntry;
}> {
  const bucket = payload?.results?.[country];
  if (!bucket) return [];

  const rows: Array<{
    providerName: string;
    providerLogoPath: string | null;
    tmdbProviderId: number | null;
    availabilityType: AvailabilityType;
    rawPayload: TmdbProviderEntry;
  }> = [];

  for (const category of ["flatrate", "rent", "buy", "free", "ads"] as const) {
    const items = bucket[category];
    if (!items || items.length === 0) continue;

    const availabilityType = tmdbCategoryToType(category);
    if (!availabilityType) continue;

    for (const entry of items) {
      if (!entry.provider_name) continue;

      rows.push({
        providerName: entry.provider_name,
        providerLogoPath: entry.logo_path ?? null,
        tmdbProviderId: entry.provider_id ?? null,
        availabilityType,
        rawPayload: entry,
      });
    }
  }

  return rows;
}

async function fetchWatchmodeRows(
  tmdbId: number,
  mediaType: MediaType,
  country: string,
  imdbId: string | null
): Promise<Array<{
  providerName: string;
  providerLogoPath: string | null;
  tmdbProviderId: number | null;
  availabilityType: AvailabilityType;
  deepLink: string | null;
  rawPayload: WatchmodeSource;
}>> {
  const titleKey = imdbId ?? `${mediaType === "tv" ? "tv" : "movie"}-${tmdbId}`;

  const data = await watchmodeFetch<{ sources?: WatchmodeSource[] }>(
    `/title/${titleKey}/sources/?regions=${country}`
  );

  const sources = data.sources ?? [];

    const rows: Array<{
    providerName: string;
    providerLogoPath: string | null;
    tmdbProviderId: number | null;
    availabilityType: AvailabilityType;
    deepLink: string | null;
    rawPayload: WatchmodeSource;
  }> = [];

  for (const source of sources) {
    if (country && source.region !== country) continue;

    const availabilityType = watchmodeTypeToAvailabilityType(source.type);
    if (!availabilityType) continue;

    rows.push({
      providerName: source.name ?? "Desconhecido",
      providerLogoPath: null,
      tmdbProviderId: null,
      availabilityType,
      deepLink: source.web_url ?? null,
      rawPayload: source,
    });
  }

  return rows;
}

async function fetchMotnRows(
  tmdbId: number,
  mediaType: MediaType,
  country: string
): Promise<Array<{
  providerName: string;
  providerLogoPath: string | null;
  tmdbProviderId: number | null;
  availabilityType: AvailabilityType;
  deepLink: string | null;
  quality: string | null;
  rawPayload: unknown;
}>> {
  const motnType = mediaType === "movie" ? "movie" : "series";

  const data = await motnFetch<MotnTitleResponse>(
    `/shows/${motnType}/tmdb/${tmdbId}?country=${country.toLowerCase()}`
  );

  const options =
    data.streamingOptions?.[country.toLowerCase()] ??
    data.streamingOptions?.[country] ??
    [];


    const rows: Array<{
    providerName: string;
    providerLogoPath: string | null;
    tmdbProviderId: number | null;
    availabilityType: AvailabilityType;
    deepLink: string | null;
    quality: string | null;
    rawPayload: unknown;
  }> = [];

  for (const option of options) {
    const availabilityType = motnTypeToAvailabilityType(option.type);
    if (!availabilityType) continue;

    rows.push({
      providerName: option.service?.name ?? option.service?.id ?? "Desconhecido",
      providerLogoPath: null,
      tmdbProviderId: null,
      availabilityType,
      deepLink: option.link ?? null,
      quality: option.quality ?? null,
      rawPayload: option,
    });
  }

  return rows;
}

export async function syncAvailability(
  input: SyncAvailabilityInput
): Promise<SyncAvailabilityResult> {
  const t0 = Date.now();
  const country = input.country ?? "BR";
  const { tmdbId, mediaType } = input;
  const maxAgeDays = input.maxAgeDays ?? 7;
  const allowExternalFallback = input.allowExternalFallback === true;
  const originInput = { ...input, country };
  const key = fallbackKey({ tmdbId, mediaType, country });

  const cached = await getAvailability(mediaType, tmdbId, country);

  if (!input.force && cached.length > 0 && isAvailabilityFresh(cached, maxAgeDays)) {
    logApiCall({
      api: "tmdb",
      op: "sync-availability",
      mediaType,
      tmdbId,
      cacheStatus: "hit",
      durationMs: Date.now() - t0,
      success: true,
    });
    return {
      source: "cache",
      rows: cached,
      diagnostics: {
        tmdb: "not_attempted",
        watchmode: "not_attempted",
        motn: "not_attempted",
      },
    };
  }

  const diagnostics: SyncAvailabilityResult["diagnostics"] = {
    tmdb: "not_attempted",
    watchmode: "not_attempted",
    motn: "not_attempted",
  };

  const tmdbPayload =
    input.tmdbPayload?.["watch/providers"] ??
    (await fetchTmdbWatchProviders(tmdbId, mediaType));

  const tmdbRows = extractTmdbRows(tmdbPayload, country);

  if (tmdbRows.length > 0) {
    diagnostics.tmdb = "ok";

    await replaceAvailability({
      tmdbId,
      mediaType,
      country,
      source: "tmdb",
      rows: tmdbRows,
      ttlDays: maxAgeDays,
    });

    await Promise.all([
      replaceAvailability({ tmdbId, mediaType, country, source: "watchmode", rows: [] }),
      replaceAvailability({ tmdbId, mediaType, country, source: "motn", rows: [] }),
    ]);

    const fresh = await getAvailability(mediaType, tmdbId, country);

    logApiCall({
      api: "tmdb",
      op: "sync-availability",
      mediaType,
      tmdbId,
      cacheStatus: "miss",
      durationMs: Date.now() - t0,
      success: true,
    });

    return {
      source: "tmdb",
      rows: fresh.filter((row) => row.source === "tmdb"),
      diagnostics,
    };
  }

  diagnostics.tmdb = "empty";

  if (!allowExternalFallback) {
    logFallbackDecision("blocked_external_fallback_for_display", originInput, {
      cacheRows: cached.length,
      cacheFresh: cached.length > 0 && isAvailabilityFresh(cached, maxAgeDays),
      tmdbStatus: "empty",
    });

    return {
      source: "none",
      rows: [],
      diagnostics,
    };
  }

  const cooldownUntil = externalFallbackCooldown.get(key) ?? 0;
  if (!input.force && cooldownUntil > Date.now()) {
    logFallbackDecision("skipped_external_fallback_cooldown", originInput, {
      cooldownUntil: new Date(cooldownUntil).toISOString(),
    });

    return {
      source: "none",
      rows: [],
      diagnostics,
    };
  }

  const inflight = externalFallbackInflight.get(key);
  if (inflight) {
    logFallbackDecision("deduped_external_fallback", originInput);
    return inflight;
  }

  const fallbackPromise = runExternalAvailabilityFallback({
    input,
    country,
    t0,
    diagnostics,
  }).finally(() => {
    externalFallbackInflight.delete(key);
    externalFallbackCooldown.set(key, Date.now() + EXTERNAL_FALLBACK_COOLDOWN_MS);
  });

  externalFallbackInflight.set(key, fallbackPromise);
  return fallbackPromise;
}

async function runExternalAvailabilityFallback(args: {
  input: SyncAvailabilityInput;
  country: string;
  t0: number;
  diagnostics: SyncAvailabilityResult["diagnostics"];
}): Promise<SyncAvailabilityResult> {
  const { input, country, t0, diagnostics } = args;
  const { tmdbId, mediaType } = input;
  const originInput = { ...input, country };
  const premiumTtlDays = input.premiumTtlDays ?? 15;
  const nextAllowedAt = nextAllowedIso(premiumTtlDays);
  const origin = fallbackOrigin(input);

  logFallbackDecision("starting_external_fallback", originInput, {
    reason: input.origin?.reason ?? "tmdb_empty_or_cache_expired",
  });

  const watchmodeState = await isFallbackAllowed({
    tmdbId,
    mediaType,
    region: country,
    source: "watchmode",
  });

  if (!watchmodeState.allowed) {
    diagnostics.watchmode = "not_attempted";
    logFallbackDecision("skipped_watchmode_persistent_cooldown", originInput, {
      nextFallbackAllowedAt: watchmodeState.state?.next_fallback_allowed_at ?? null,
      fallbackResult: watchmodeState.state?.fallback_result ?? null,
    });
  } else {
    const budget = await reservePremiumApiBudget("watchmode", {
      endpoint: input.origin?.endpoint ?? null,
      tmdbId,
      mediaType,
      region: country,
      userId: input.origin?.userId ?? null,
      action: input.origin?.action ?? null,
      reason: input.origin?.reason ?? "tmdb_empty_or_cache_expired",
    });

    if (!budget.ok) {
      diagnostics.watchmode = "not_attempted";
      await recordFallbackState({
        tmdbId,
        mediaType,
        region: country,
        source: "watchmode",
        result: "blocked",
        nextAllowedAt: nextAllowedIso(1),
        error: budget.reason,
        origin,
      });
      logFallbackDecision("blocked_watchmode_budget", originInput, { reason: budget.reason });
    } else {
      try {
        const watchmodeRows = await runPremiumApiQueued("watchmode", () =>
          fetchWatchmodeRows(
            tmdbId,
            mediaType,
            country,
            input.imdbId ?? null,
          ),
        );

        if (watchmodeRows.length > 0) {
          diagnostics.watchmode = "ok";

          await replaceAvailability({
            tmdbId,
            mediaType,
            country,
            source: "watchmode",
            rows: watchmodeRows.map((row) => ({
              ...row,
              providerConfidence: "watchmode_fallback",
            })),
            ttlDays: premiumTtlDays,
            fallback: {
              checkedAt: new Date().toISOString(),
              result: "ok",
              source: "watchmode",
              nextAllowedAt,
            },
          });

          await recordFallbackState({
            tmdbId,
            mediaType,
            region: country,
            source: "watchmode",
            result: "ok",
            nextAllowedAt,
            rowsCount: watchmodeRows.length,
            origin,
          });

          await completePremiumApiBudget(budget.reservation, "success");

          const fresh = await getAvailability(mediaType, tmdbId, country);

          logApiCall({
            api: "watchmode",
            op: "sync-availability",
            mediaType,
            tmdbId,
            endpoint: input.origin?.endpoint,
            cacheStatus: "miss",
            durationMs: Date.now() - t0,
            success: true,
            fallbackFrom: "tmdb",
          });

          logFallbackDecision("watchmode_external_fallback_ok", originInput, {
            rows: watchmodeRows.length,
            dailyUsed: budget.reservation.dailyUsed,
            dailyLimit: budget.reservation.dailyLimit,
            monthlyUsed: budget.reservation.monthlyUsed,
            monthlyLimit: budget.reservation.monthlyLimit,
          });

          return {
            source: "watchmode",
            rows: fresh.filter((row) => row.source === "watchmode"),
            diagnostics,
          };
        }

        diagnostics.watchmode = "empty";
        await recordFallbackState({
          tmdbId,
          mediaType,
          region: country,
          source: "watchmode",
          result: "empty",
          nextAllowedAt,
          rowsCount: 0,
          origin,
        });
        await completePremiumApiBudget(budget.reservation, "empty");
        logFallbackDecision("watchmode_external_fallback_empty", originInput);
      } catch (error) {
        rateLimitedWarn(
          "availability:watchmode-failed",
          AVAILABILITY_LOG_TTL_MS,
          "[availability] Watchmode falhou\n- fallback aplicado: próxima fonte ou vazio",
          formatError(error),
        );

        diagnostics.watchmode = "failed";
        const errorMessage = error instanceof Error ? error.message : String(error);
        await recordFallbackState({
          tmdbId,
          mediaType,
          region: country,
          source: "watchmode",
          result: "failed",
          nextAllowedAt,
          rowsCount: 0,
          error: errorMessage,
          origin,
        });
        await completePremiumApiBudget(budget.reservation, "failed", errorMessage);

        logApiCall({
          api: "watchmode",
          op: "sync-availability",
          mediaType,
          tmdbId,
          endpoint: input.origin?.endpoint,
          cacheStatus: "failed",
          durationMs: Date.now() - t0,
          success: false,
          fallbackFrom: "tmdb",
          error: errorMessage,
        });
      }
    }
  }

  const motnState = await isFallbackAllowed({
    tmdbId,
    mediaType,
    region: country,
    source: "movieofthenight",
  });

  if (!motnState.allowed) {
    diagnostics.motn = "not_attempted";
    logFallbackDecision("skipped_motn_persistent_cooldown", originInput, {
      nextFallbackAllowedAt: motnState.state?.next_fallback_allowed_at ?? null,
      fallbackResult: motnState.state?.fallback_result ?? null,
    });
  } else {
    const budget = await reservePremiumApiBudget("movieofthenight", {
      endpoint: input.origin?.endpoint ?? null,
      tmdbId,
      mediaType,
      region: country,
      userId: input.origin?.userId ?? null,
      action: input.origin?.action ?? null,
      reason: input.origin?.reason ?? "watchmode_empty_or_failed",
    });

    if (!budget.ok) {
      diagnostics.motn = "not_attempted";
      await recordFallbackState({
        tmdbId,
        mediaType,
        region: country,
        source: "movieofthenight",
        result: "blocked",
        nextAllowedAt: nextAllowedIso(1),
        error: budget.reason,
        origin,
      });
      logFallbackDecision("blocked_motn_budget", originInput, { reason: budget.reason });
    } else {
      try {
        const motnRows = await runPremiumApiQueued("movieofthenight", () =>
          fetchMotnRows(tmdbId, mediaType, country),
        );

        if (motnRows.length > 0) {
          diagnostics.motn = "ok";

          await replaceAvailability({
            tmdbId,
            mediaType,
            country,
            source: "motn",
            rows: motnRows.map((row) => ({
              ...row,
              providerConfidence: "movieofthenight_fallback",
            })),
            ttlDays: premiumTtlDays,
            fallback: {
              checkedAt: new Date().toISOString(),
              result: "ok",
              source: "movieofthenight",
              nextAllowedAt,
            },
          });

          await recordFallbackState({
            tmdbId,
            mediaType,
            region: country,
            source: "movieofthenight",
            result: "ok",
            nextAllowedAt,
            rowsCount: motnRows.length,
            origin,
          });
          await completePremiumApiBudget(budget.reservation, "success");

          const fresh = await getAvailability(mediaType, tmdbId, country);

          logApiCall({
            api: "motn",
            op: "sync-availability",
            mediaType,
            tmdbId,
            endpoint: input.origin?.endpoint,
            cacheStatus: "miss",
            durationMs: Date.now() - t0,
            success: true,
            fallbackFrom: "watchmode",
          });

          logFallbackDecision("motn_external_fallback_ok", originInput, {
            rows: motnRows.length,
            dailyUsed: budget.reservation.dailyUsed,
            dailyLimit: budget.reservation.dailyLimit,
            monthlyUsed: budget.reservation.monthlyUsed,
            monthlyLimit: budget.reservation.monthlyLimit,
          });

          return {
            source: "motn",
            rows: fresh.filter((row) => row.source === "motn"),
            diagnostics,
          };
        }

        diagnostics.motn = "empty";
        await recordFallbackState({
          tmdbId,
          mediaType,
          region: country,
          source: "movieofthenight",
          result: "empty",
          nextAllowedAt,
          rowsCount: 0,
          origin,
        });
        await completePremiumApiBudget(budget.reservation, "empty");
        logFallbackDecision("motn_external_fallback_empty", originInput);
      } catch (error) {
        rateLimitedWarn(
          "availability:motn-failed",
          AVAILABILITY_LOG_TTL_MS,
          "[availability] MOTN falhou\n- fallback aplicado: vazio",
          formatError(error),
        );

        diagnostics.motn = "failed";
        const errorMessage = error instanceof Error ? error.message : String(error);
        await recordFallbackState({
          tmdbId,
          mediaType,
          region: country,
          source: "movieofthenight",
          result: "failed",
          nextAllowedAt,
          rowsCount: 0,
          error: errorMessage,
          origin,
        });
        await completePremiumApiBudget(budget.reservation, "failed", errorMessage);

        logApiCall({
          api: "motn",
          op: "sync-availability",
          mediaType,
          tmdbId,
          endpoint: input.origin?.endpoint,
          cacheStatus: "failed",
          durationMs: Date.now() - t0,
          success: false,
          fallbackFrom: "watchmode",
          error: errorMessage,
        });
      }
    }
  }

  return {
    source: "none",
    rows: [],
    diagnostics,
  };
}
