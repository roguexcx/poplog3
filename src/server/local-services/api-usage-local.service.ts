import {
  completePremiumApiUsage,
  countPremiumApiUsage,
  createPremiumApiUsage,
  deleteApiUsageDaily,
  deletePremiumApiUsage,
  listApiUsageDaily,
  upsertApiUsageDaily,
} from "@/server/repositories";
import type { ApiUsageDailyInput, PremiumApiUsageInput } from "@/server/repositories/types";
import type { EngineApi, PremiumApi } from "@prisma/client";

export async function upsertDailyApiUsage(input: ApiUsageDailyInput) {
  return upsertApiUsageDaily(input);
}

export async function listDailyApiUsage(input: {
  from?: Date | string;
  to?: Date | string;
  api?: EngineApi;
  limit?: number;
} = {}) {
  return listApiUsageDaily(input);
}

export async function deleteDailyApiUsage(day: Date | string, api: EngineApi) {
  return deleteApiUsageDaily(day, api);
}

export async function countPremiumUsage(input: {
  api: PremiumApi;
  period: "day" | "month";
  key: Date | string;
}) {
  return countPremiumApiUsage(input);
}

export async function reservePremiumUsage(input: PremiumApiUsageInput) {
  return createPremiumApiUsage({ ...input, status: input.status ?? "reserved" });
}

export async function completePremiumUsage(input: {
  id: string;
  status: "reserved" | "success" | "failed" | "empty" | "blocked";
  error?: string | null;
}) {
  return completePremiumApiUsage(input);
}

export async function deletePremiumUsage(id: string) {
  return deletePremiumApiUsage(id);
}
