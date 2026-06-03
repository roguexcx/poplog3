import { db } from "@/server/db/client";
import type { EngineApi } from "@prisma/client";
import type { ApiUsageDailyInput, RepositoryResult, RepositoryVoidResult } from "./types";

function dateOnly(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function upsertApiUsageDaily(
  input: ApiUsageDailyInput,
): Promise<RepositoryResult<unknown>> {
  try {
    const row = await db.apiUsageDaily.upsert({
      where: {
        day_api: {
          day: dateOnly(input.day),
          api: input.api,
        },
      },
      update: {
        totalCalls: input.totalCalls ?? 0,
        cacheHits: input.cacheHits ?? 0,
        errors: input.errors ?? 0,
        avgMs: input.avgMs ?? 0,
        maxMs: input.maxMs ?? 0,
        p95Ms: input.p95Ms ?? 0,
      },
      create: {
        day: dateOnly(input.day),
        api: input.api,
        totalCalls: input.totalCalls ?? 0,
        cacheHits: input.cacheHits ?? 0,
        errors: input.errors ?? 0,
        avgMs: input.avgMs ?? 0,
        maxMs: input.maxMs ?? 0,
        p95Ms: input.p95Ms ?? 0,
      },
    });

    return { ok: true, data: row };
  } catch (error) {
    console.warn("[api-usage.repository] upsert failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function listApiUsageDaily(input: {
  from?: Date | string;
  to?: Date | string;
  api?: EngineApi;
  limit?: number;
} = {}): Promise<RepositoryResult<unknown[]>> {
  try {
    const rows = await db.apiUsageDaily.findMany({
      where: {
        api: input.api,
        day: {
          gte: input.from ? dateOnly(input.from) : undefined,
          lte: input.to ? dateOnly(input.to) : undefined,
        },
      },
      orderBy: { day: "desc" },
      take: input.limit ?? 90,
    });

    return { ok: true, data: rows };
  } catch (error) {
    console.warn("[api-usage.repository] list failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deleteApiUsageDaily(
  day: Date | string,
  api: EngineApi,
): Promise<RepositoryVoidResult> {
  try {
    await db.apiUsageDaily.delete({
      where: {
        day_api: {
          day: dateOnly(day),
          api,
        },
      },
    });

    return { ok: true, data: null };
  } catch (error) {
    console.warn("[api-usage.repository] delete failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}
