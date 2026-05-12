import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getApiBudgetEnv } from "@/lib/env";
import type { ExternalApiName } from "@/lib/api/api-usage-log";

export type ApiBudgetWindow = "daily" | "monthly";

export type ApiBudgetConfig = {
  apiName: ExternalApiName;
  window: ApiBudgetWindow;
  limit: number;
};

export type ApiBudgetStatus = ApiBudgetConfig & {
  used: number | null;
  remaining: number | null;
  estimatedCost: number;
  allowed: boolean;
  unavailableReason?: string;
};

function startOfTodayIso(): string {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
}

function startOfMonthIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
}

export function getApiBudgetConfig(): Record<ExternalApiName, ApiBudgetConfig> {
  const env = getApiBudgetEnv();
  return {
    tmdb: {
      apiName: "tmdb",
      window: "daily",
      limit: env.tmdbDailyBudget,
    },
    watchmode: {
      apiName: "watchmode",
      window: "monthly",
      limit: env.watchmodeMonthlyBudget,
    },
    movieofthenight: {
      apiName: "movieofthenight",
      window: "monthly",
      limit: env.movieOfTheNightMonthlyBudget,
    },
  };
}

export function estimateRefreshCost(input: {
  apiName?: ExternalApiName;
  items: number;
  dryRun?: boolean;
}): number {
  return Math.max(0, Math.floor(input.items)) * (input.apiName === "tmdb" || !input.apiName ? 1 : 1);
}

async function countUsage(apiName: ExternalApiName, sinceIso: string): Promise<number | null> {
  try {
    const supabase = createSupabaseAdminClient();
    const { count, error } = await supabase
      .from("api_sync_logs")
      .select("id", { count: "exact", head: true })
      .eq("api_name", apiName)
      .eq("success", true)
      .gte("created_at", sinceIso);

    if (error) return null;
    return count ?? 0;
  } catch {
    return null;
  }
}

export async function getApiBudgetStatus(input: {
  apiName: ExternalApiName;
  estimatedCost?: number;
}): Promise<ApiBudgetStatus> {
  const config = getApiBudgetConfig()[input.apiName];
  const estimatedCost = Math.max(0, Math.floor(input.estimatedCost ?? 0));
  const sinceIso = config.window === "daily" ? startOfTodayIso() : startOfMonthIso();
  const used = await countUsage(input.apiName, sinceIso);

  if (used === null) {
    return {
      ...config,
      used,
      remaining: null,
      estimatedCost,
      allowed: true,
      unavailableReason: "usage_log_unavailable",
    };
  }

  const remaining = Math.max(0, config.limit - used);
  return {
    ...config,
    used,
    remaining,
    estimatedCost,
    allowed: estimatedCost <= remaining,
  };
}

export async function assertWithinApiBudget(input: {
  apiName: ExternalApiName;
  estimatedCost: number;
}): Promise<ApiBudgetStatus> {
  const status = await getApiBudgetStatus(input);
  if (!status.allowed) {
    throw new Error(
      `Budget guard bloqueou ${input.apiName}: custo estimado ${status.estimatedCost}, restante ${status.remaining}.`,
    );
  }
  return status;
}

export async function recordApiBudgetUsage(): Promise<void> {
  // O uso real fica registrado em api_sync_logs; esta funcao existe para encaixe futuro.
}
