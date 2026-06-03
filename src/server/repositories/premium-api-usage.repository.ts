import { db } from "@/server/db/client";
import type { PremiumApi } from "@prisma/client";
import type { PremiumApiUsageInput, RepositoryResult, RepositoryVoidResult } from "./types";

type BudgetStatus = "reserved" | "success" | "failed" | "empty" | "blocked";

function dateOnly(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(`${value}T00:00:00.000Z`);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function countPremiumApiUsage(input: {
  api: PremiumApi;
  period: "day" | "month";
  key: Date | string;
  statuses?: BudgetStatus[];
}): Promise<RepositoryResult<number>> {
  try {
    const count = await db.poplog3PremiumApiUsage.count({
      where: {
        api: input.api,
        periodDay: input.period === "day" ? dateOnly(input.key) : undefined,
        periodMonth: input.period === "month" ? String(input.key).slice(0, 7) : undefined,
        status: { in: input.statuses ?? ["reserved", "success", "failed", "empty"] },
      },
    });

    return { ok: true, data: count };
  } catch (error) {
    console.warn("[premium-api-usage.repository] count failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function createPremiumApiUsage(
  input: PremiumApiUsageInput,
): Promise<RepositoryResult<{ id: string } | null>> {
  try {
    const row = await db.poplog3PremiumApiUsage.create({
      data: {
        api: input.api,
        periodDay: dateOnly(input.periodDay),
        periodMonth: input.periodMonth,
        endpoint: input.endpoint ?? null,
        tmdbId: input.tmdbId ?? null,
        mediaType: input.mediaType ?? null,
        region: input.region ?? null,
        userId: input.userId ?? null,
        action: input.action ?? null,
        reason: input.reason ?? null,
        status: input.status ?? "reserved",
        dailyUsed: input.dailyUsed ?? null,
        dailyLimit: input.dailyLimit ?? null,
        monthlyUsed: input.monthlyUsed ?? null,
        monthlyLimit: input.monthlyLimit ?? null,
        error: input.error ?? null,
      },
      select: { id: true },
    });

    return { ok: true, data: row };
  } catch (error) {
    console.warn("[premium-api-usage.repository] create failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function completePremiumApiUsage(input: {
  id: string;
  status: BudgetStatus;
  error?: string | null;
}): Promise<RepositoryVoidResult> {
  try {
    await db.poplog3PremiumApiUsage.update({
      where: { id: input.id },
      data: {
        status: input.status,
        error: input.error ?? null,
        usedAt: new Date(),
      },
    });

    return { ok: true, data: null };
  } catch (error) {
    console.warn("[premium-api-usage.repository] complete failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}

export async function deletePremiumApiUsage(id: string): Promise<RepositoryVoidResult> {
  try {
    await db.poplog3PremiumApiUsage.delete({ where: { id } });
    return { ok: true, data: null };
  } catch (error) {
    console.warn("[premium-api-usage.repository] delete failed", messageFromError(error));
    return { ok: false, error: messageFromError(error) };
  }
}
