export type ContinuitySectionCacheStatus = "hit" | "stale" | "miss" | "error";

export type ContinuitySectionCacheEntry<T> = {
  payload: T;
  status: Exclude<ContinuitySectionCacheStatus, "miss" | "error">;
  expiresAt: string;
  updatedAt: string;
};

export async function readContinuitySectionCache<T>(
  sectionKey: string,
  options: {
    userId?: string | null;
    region?: string | null;
    language?: string | null;
  } = {},
): Promise<ContinuitySectionCacheEntry<T> | null> {
  try {
    const local = await import("@/server/local-services/continuity-section-cache-local.service");
    return await local.readContinuitySectionCache<T>(sectionKey, options);
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
  try {
    const local = await import("@/server/local-services/continuity-section-cache-local.service");
    await local.writeContinuitySectionCache(input);
  } catch (error) {
    console.warn("[continuity-section-cache] local write failed", {
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
}
