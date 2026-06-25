export type ContinuitySectionCacheStatus = "hit" | "stale" | "miss" | "error";

export type ContinuitySectionCacheEntry<T> = {
  payload: T;
  status: Exclude<ContinuitySectionCacheStatus, "miss" | "error">;
  expiresAt: string;
  updatedAt: string;
};

function cachePart(value: string | null | undefined, fallback: string): string {
  return encodeURIComponent(value?.trim() || fallback);
}

function redisContinuityKey(input: {
  sectionKey: string;
  userId?: string | null;
  region?: string | null;
  language?: string | null;
}): string {
  return [
    "continuity",
    "section",
    cachePart(input.sectionKey, "unknown"),
    "user",
    cachePart(input.userId, "anon"),
    "region",
    cachePart(input.region, "global"),
    "language",
    cachePart(input.language, "default"),
  ].join(":");
}

export async function readContinuitySectionCache<T>(
  sectionKey: string,
  options: {
    userId?: string | null;
    region?: string | null;
    language?: string | null;
  } = {},
): Promise<ContinuitySectionCacheEntry<T> | null> {
  const redisKey = redisContinuityKey({ sectionKey, ...options });

  try {
    const { redisGetJson } = await import("@/server/cache/redis-client");
    const cached = await redisGetJson<ContinuitySectionCacheEntry<T>>(redisKey);
    if (cached) {
      return {
        ...cached,
        status: Date.parse(cached.expiresAt) > Date.now() ? "hit" : "stale",
      };
    }
  } catch (error) {
    console.warn("[continuity-section-cache] redis read skipped", {
      sectionKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const local = await import("@/server/local-services/continuity-section-cache-local.service");
    const entry = await local.readContinuitySectionCache<T>(sectionKey, options);
    if (entry?.status === "hit") {
      const ttlMs = Date.parse(entry.expiresAt) - Date.now();
      if (ttlMs > 1000) {
        void import("@/server/cache/redis-client")
          .then(({ redisSetJson }) => redisSetJson(redisKey, entry, ttlMs))
          .catch(() => false);
      }
    }
    return entry;
  } catch (error) {
    console.warn("[continuity-section-cache] local read failed", {
      sectionKey,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function writeContinuitySectionCache<T>(input: {
  sectionKey: string;
  userId?: string | null;
  region?: string | null;
  language?: string | null;
  payload: T;
  ttlMs: number;
}) {
  const now = new Date();
  const entry: ContinuitySectionCacheEntry<T> = {
    payload: input.payload,
    status: "hit",
    expiresAt: new Date(now.getTime() + input.ttlMs).toISOString(),
    updatedAt: now.toISOString(),
  };

  try {
    const local = await import("@/server/local-services/continuity-section-cache-local.service");
    await local.writeContinuitySectionCache(input);
  } catch (error) {
    console.warn("[continuity-section-cache] local write failed", {
      sectionKey: input.sectionKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const { redisSetJson } = await import("@/server/cache/redis-client");
    await redisSetJson(redisContinuityKey(input), entry, input.ttlMs);
  } catch (error) {
    console.warn("[continuity-section-cache] redis write skipped", {
      sectionKey: input.sectionKey,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export function invalidateContinuitySectionCache(userId: string) {
  void import("@/server/local-services/continuity-section-cache-local.service")
    .then((local) => local.invalidateContinuitySectionCacheLocal({ userId }))
    .catch((error) => {
      console.warn("[continuity-section-cache] local invalidation failed", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  void import("@/server/cache/redis-client")
    .then(({ redisDeleteByPattern }) =>
      redisDeleteByPattern(`continuity:section:*:user:${cachePart(userId, "anon")}:*`),
    )
    .catch((error) => {
      console.warn("[continuity-section-cache] redis invalidation skipped", {
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}
