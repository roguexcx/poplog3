import {
  invalidateContinuitySectionCache as invalidateRepositoryCache,
  readContinuitySectionCache as readRepositoryCache,
  writeContinuitySectionCache as writeRepositoryCache,
} from "@/server/repositories";

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
  const result = await readRepositoryCache<T>({
    sectionKey,
    userId: options.userId ?? null,
    region: options.region ?? null,
    language: options.language ?? null,
  });
  return result.ok ? result.data : null;
}

export async function writeContinuitySectionCache<T>(input: {
  sectionKey: string;
  userId?: string | null;
  region?: string | null;
  language?: string | null;
  payload: T;
  ttlMs: number;
}): Promise<void> {
  await writeRepositoryCache(input);
}

export function invalidateContinuitySectionCache(userId: string): void {
  void invalidateRepositoryCache({ userId });
}

export async function invalidateContinuitySectionCacheLocal(input: {
  userId?: string | null;
  sectionKey?: string;
} = {}): Promise<boolean> {
  const result = await invalidateRepositoryCache(input);
  return result.ok;
}
