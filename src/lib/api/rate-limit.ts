import { logApiUsage, type ExternalApiName } from "@/lib/api/api-usage-log";

type RateLimitConfig = {
  limit: number;
  windowMs: number;
};

const RATE_LIMITS: Record<ExternalApiName, RateLimitConfig> = {
  tmdb: { limit: 500, windowMs: 60_000 },
  watchmode: { limit: 15, windowMs: 60_000 },
  movieofthenight: { limit: 3, windowMs: 60 * 60_000 },
};

const counters = new Map<ExternalApiName, { count: number; windowStartedAt: number }>();

export function assertCanCallApi(apiName: ExternalApiName, endpoint = "unknown"): void {
  const config = RATE_LIMITS[apiName];
  const now = Date.now();
  const current = counters.get(apiName);

  if (!current || now - current.windowStartedAt >= config.windowMs) {
    counters.set(apiName, { count: 1, windowStartedAt: now });
    return;
  }

  if (current.count >= config.limit) {
    logApiUsage({
      apiName,
      endpoint,
      success: false,
      skippedReason: "rate_limit_guard",
    });
    throw new Error(`Rate limit guard bloqueou chamada para ${apiName}.`);
  }

  current.count += 1;
}
