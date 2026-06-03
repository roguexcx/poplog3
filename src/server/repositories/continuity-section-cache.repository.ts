import { db } from "@/server/db/client";
import type {
  ContinuitySectionCacheEntry,
  ContinuitySectionCacheKey,
  RepositoryResult,
  RepositoryVoidResult,
} from "./types";

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeKey(input: ContinuitySectionCacheKey) {
  return {
    sectionKey: input.sectionKey,
    userId: input.userId ?? null,
    region: input.region ?? null,
    language: input.language ?? null,
  };
}

export async function readContinuitySectionCache<T>(
  input: ContinuitySectionCacheKey,
): Promise<RepositoryResult<ContinuitySectionCacheEntry<T> | null>> {
  try {
    const key = normalizeKey(input);
    const row = await db.continuitySectionCache.findFirst({
      where: key,
      orderBy: { updatedAt: "desc" },
    });

    if (!row) return { ok: true, data: null };

    return {
      ok: true,
      data: {
        payload: row.payload as T,
        status: row.expiresAt.getTime() > Date.now() ? "hit" : "stale",
        expiresAt: row.expiresAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      },
    };
  } catch (error) {
    console.warn("[continuity-section-cache.repository] read failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function writeContinuitySectionCache<T>(
  input: ContinuitySectionCacheKey & {
    payload: T;
    ttlMs: number;
  },
): Promise<RepositoryVoidResult> {
  try {
    const key = normalizeKey(input);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlMs);

    const existing = await db.continuitySectionCache.findFirst({
      where: key,
      select: { id: true },
    });

    if (existing) {
      await db.continuitySectionCache.update({
        where: { id: existing.id },
        data: {
          payload: input.payload as object,
          expiresAt,
          updatedAt: now,
        },
      });
    } else {
      await db.continuitySectionCache.create({
        data: {
          ...key,
          payload: input.payload as object,
          expiresAt,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    return { ok: true, data: null };
  } catch (error) {
    console.warn("[continuity-section-cache.repository] write failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function invalidateContinuitySectionCache(input: {
  userId?: string | null;
  sectionKey?: string;
} = {}): Promise<RepositoryResult<number>> {
  try {
    const result = await db.continuitySectionCache.deleteMany({
      where: {
        userId: input.userId ?? undefined,
        sectionKey: input.sectionKey,
      },
    });

    return { ok: true, data: result.count };
  } catch (error) {
    console.warn(
      "[continuity-section-cache.repository] invalidation failed",
      messageFromError(error),
    );
    return { ok: false, error: messageFromError(error) };
  }
}
