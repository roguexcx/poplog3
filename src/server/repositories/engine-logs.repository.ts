import { db } from "@/server/db/client";
import type { EngineApi, CacheStatus, MediaType } from "@prisma/client";
import type { EngineLogInput, RepositoryResult, RepositoryVoidResult } from "./types";

const PERSISTENCE_WINDOW_HOURS = 24;

function toDate(value: Date | string | number | undefined): Date {
  if (value === undefined) return new Date();
  return value instanceof Date ? value : new Date(value);
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type EngineLogEntryRow = {
  id: bigint;
  ts: Date;
  api: EngineApi;
  op: string;
  origin: string;
  mediaType: MediaType | null;
  tmdbId: number | null;
  endpoint: string | null;
  cacheStatus: CacheStatus;
  durationMs: number;
  success: boolean;
  httpStatus: number | null;
  error: string | null;
  fallbackFrom: EngineApi | null;
};

export async function createEngineLogEntry(
  input: EngineLogInput,
): Promise<RepositoryResult<EngineLogEntryRow | null>> {
  try {
    const row = await db.engineApiCallLog.create({
      data: {
        ts: toDate(input.ts),
        api: input.api,
        op: input.op,
        origin: input.origin,
        mediaType: input.mediaType ?? null,
        tmdbId: input.tmdbId ?? null,
        endpoint: input.endpoint ?? null,
        cacheStatus: input.cacheStatus,
        durationMs: input.durationMs,
        success: input.success,
        httpStatus: input.httpStatus ?? null,
        error: input.error ?? null,
        fallbackFrom: input.fallbackFrom ?? null,
      },
    });

    return { ok: true, data: row };
  } catch (error) {
    console.warn("[engine-logs.repository] create failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function listRecentEngineLogEntries(input: {
  limit?: number;
  since?: Date;
  api?: EngineApi;
  success?: boolean;
} = {}): Promise<RepositoryResult<EngineLogEntryRow[]>> {
  try {
    const since =
      input.since ??
      new Date(Date.now() - PERSISTENCE_WINDOW_HOURS * 60 * 60 * 1000);

    const rows = await db.engineApiCallLog.findMany({
      where: {
        ts: { gte: since },
        api: input.api,
        success: input.success,
      },
      orderBy: { ts: "desc" },
      take: input.limit ?? 100,
    });

    return { ok: true, data: rows };
  } catch (error) {
    console.warn("[engine-logs.repository] list failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function clearEngineLogEntries(input: {
  olderThan?: Date;
} = {}): Promise<RepositoryResult<number>> {
  try {
    const result = await db.engineApiCallLog.deleteMany({
      where: input.olderThan ? { ts: { lt: input.olderThan } } : {},
    });

    return { ok: true, data: result.count };
  } catch (error) {
    console.warn("[engine-logs.repository] clear failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteEngineLogEntry(id: bigint): Promise<RepositoryVoidResult> {
  try {
    await db.engineApiCallLog.delete({ where: { id } });
    return { ok: true, data: null };
  } catch (error) {
    console.warn("[engine-logs.repository] delete failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}
