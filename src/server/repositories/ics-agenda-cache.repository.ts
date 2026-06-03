import { db } from "@/server/db/client";
import type { IcsAgendaCacheEntry, RepositoryResult, RepositoryVoidResult } from "./types";

const DEFAULT_CACHE_ID = "main";

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readIcsAgendaCache<T>(input: {
  id?: string;
  ttlHours: number;
}): Promise<RepositoryResult<IcsAgendaCacheEntry<T> | null>> {
  try {
    const row = await db.icsAgendaCache.findUnique({
      where: { id: input.id ?? DEFAULT_CACHE_ID },
    });

    if (!row) return { ok: true, data: null };

    const ageHours = (Date.now() - row.cachedAt.getTime()) / 3_600_000;
    return {
      ok: true,
      data: {
        payload: row.payload as T,
        cachedAt: row.cachedAt.toISOString(),
        ageHours,
        status: ageHours < input.ttlHours ? "hit" : "stale",
      },
    };
  } catch (error) {
    console.warn("[ics-agenda-cache.repository] read failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function writeIcsAgendaCache<T>(input: {
  id?: string;
  payload: T;
  cachedAt?: Date;
}): Promise<RepositoryVoidResult> {
  try {
    await db.icsAgendaCache.upsert({
      where: { id: input.id ?? DEFAULT_CACHE_ID },
      update: {
        payload: input.payload as object,
        cachedAt: input.cachedAt ?? new Date(),
      },
      create: {
        id: input.id ?? DEFAULT_CACHE_ID,
        payload: input.payload as object,
        cachedAt: input.cachedAt ?? new Date(),
      },
    });

    return { ok: true, data: null };
  } catch (error) {
    console.warn("[ics-agenda-cache.repository] write failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteIcsAgendaCache(id = DEFAULT_CACHE_ID): Promise<RepositoryVoidResult> {
  try {
    await db.icsAgendaCache.delete({ where: { id } });
    return { ok: true, data: null };
  } catch (error) {
    console.warn("[ics-agenda-cache.repository] delete failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}
