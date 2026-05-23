import { supabaseAdmin } from "@/server/supabase/admin";
import { debugLog, formatError, rateLimitedWarn } from "@/server/logging/log-control";
import { API_BUDGETS } from "./api-budgets";
import { API_COOLDOWNS } from "./api-cooldowns";

type PremiumApi = "omdb" | "watchmode" | "movieofthenight";
type MediaType = "movie" | "tv";

type BudgetOrigin = {
  endpoint?: string | null;
  tmdbId?: number | null;
  mediaType?: MediaType | null;
  region?: string | null;
  userId?: string | null;
  action?: string | null;
  reason?: string | null;
};

type Reservation = {
  id: string | null;
  api: PremiumApi;
  dailyUsed: number;
  dailyLimit: number;
  monthlyUsed: number | null;
  monthlyLimit: number | null;
};

type BudgetStatus = "success" | "failed" | "empty" | "blocked";

const queueByApi = new Map<PremiumApi, Promise<unknown>>();
const lastRunByApi = new Map<PremiumApi, number>();
const BUDGET_LOG_TTL_MS = 5 * 60 * 1000;

function todayKey(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

function monthKey(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

function limitsFor(api: PremiumApi) {
  const config = API_BUDGETS[api];
  return {
    daily: config.daily,
    monthly: "monthly" in config ? config.monthly : null,
  };
}

function cooldownMsFor(api: PremiumApi) {
  if (api === "movieofthenight") return API_COOLDOWNS.movieofthenight.minIntervalMs;
  return API_COOLDOWNS[api].minIntervalMs;
}

async function countUsage(api: PremiumApi, period: "day" | "month", key: string) {
  const column = period === "day" ? "period_day" : "period_month";
  const { count, error } = await supabaseAdmin
    .from("poplog3_premium_api_usage")
    .select("id", { count: "exact", head: true })
    .eq("api", api)
    .eq(column, key)
    .in("status", ["reserved", "success", "failed", "empty"]);

  if (error) {
    rateLimitedWarn(
      `premium-api-budget:count:${api}:${period}`,
      BUDGET_LOG_TTL_MS,
      "[availability] orçamento de API externa indisponível\n- fallback aplicado: tratar uso como zero",
      formatError(error),
    );
    return 0;
  }

  return count ?? 0;
}

export async function reservePremiumApiBudget(
  api: PremiumApi,
  origin: BudgetOrigin,
): Promise<{ ok: true; reservation: Reservation } | { ok: false; reason: string }> {
  const now = new Date();
  const limits = limitsFor(api);
  const day = todayKey(now);
  const month = monthKey(now);

  const [dailyUsed, monthlyUsed] = await Promise.all([
    countUsage(api, "day", day),
    limits.monthly === null ? Promise.resolve(null) : countUsage(api, "month", month),
  ]);

  const dailyRemaining = limits.daily - dailyUsed;
  const monthlyRemaining = limits.monthly === null ? Infinity : limits.monthly - (monthlyUsed ?? 0);

  if (dailyRemaining <= 0 || monthlyRemaining <= 0) {
    const reason = "premium_api_budget_exhausted";
    await recordBlockedBudget(api, origin, reason, {
      dailyUsed,
      dailyLimit: limits.daily,
      monthlyUsed,
      monthlyLimit: limits.monthly,
    });
    return { ok: false, reason };
  }

  const nearDailyLimit = dailyRemaining <= Math.max(1, Math.ceil(limits.daily * 0.05));
  const nearMonthlyLimit =
    limits.monthly !== null &&
    monthlyRemaining <= Math.max(1, Math.ceil(limits.monthly * 0.05));

  if (nearDailyLimit || nearMonthlyLimit) {
    const reason = "premium_api_budget_near_safe_limit";
    await recordBlockedBudget(api, origin, reason, {
      dailyUsed,
      dailyLimit: limits.daily,
      monthlyUsed,
      monthlyLimit: limits.monthly,
    });
    return { ok: false, reason };
  }

  const { data, error } = await supabaseAdmin
    .from("poplog3_premium_api_usage")
    .insert({
      api,
      period_day: day,
      period_month: month,
      endpoint: origin.endpoint ?? null,
      tmdb_id: origin.tmdbId ?? null,
      media_type: origin.mediaType ?? null,
      region: origin.region ?? null,
      user_id: origin.userId ?? null,
      action: origin.action ?? null,
      reason: origin.reason ?? null,
      status: "reserved",
      daily_used: dailyUsed + 1,
      daily_limit: limits.daily,
      monthly_used: monthlyUsed === null ? null : monthlyUsed + 1,
      monthly_limit: limits.monthly,
    })
    .select("id")
    .single();

  if (error) {
    rateLimitedWarn(
      `premium-api-budget:reserve:${api}`,
      BUDGET_LOG_TTL_MS,
      "[availability] reserva de API externa falhou\n- fallback aplicado: bloquear chamada premium",
      formatError(error),
    );
    return { ok: false, reason: "premium_api_budget_store_failed" };
  }

  debugLog("DEBUG_AVAILABILITY", "[premium-api-budget:debug] reserved", {
    api,
    endpoint: origin.endpoint ?? null,
    tmdbId: origin.tmdbId ?? null,
    mediaType: origin.mediaType ?? null,
    region: origin.region ?? null,
    userId: origin.userId ?? null,
    action: origin.action ?? null,
    reason: origin.reason ?? null,
    dailyUsed: dailyUsed + 1,
    dailyLimit: limits.daily,
    monthlyUsed: monthlyUsed === null ? null : monthlyUsed + 1,
    monthlyLimit: limits.monthly,
  });

  return {
    ok: true,
    reservation: {
      id: (data as { id?: string } | null)?.id ?? null,
      api,
      dailyUsed: dailyUsed + 1,
      dailyLimit: limits.daily,
      monthlyUsed: monthlyUsed === null ? null : monthlyUsed + 1,
      monthlyLimit: limits.monthly,
    },
  };
}

async function recordBlockedBudget(
  api: PremiumApi,
  origin: BudgetOrigin,
  reason: string,
  usage: {
    dailyUsed: number;
    dailyLimit: number;
    monthlyUsed: number | null;
    monthlyLimit: number | null;
  },
) {
  await supabaseAdmin
    .from("poplog3_premium_api_usage")
    .insert({
      api,
      endpoint: origin.endpoint ?? null,
      tmdb_id: origin.tmdbId ?? null,
      media_type: origin.mediaType ?? null,
      region: origin.region ?? null,
      user_id: origin.userId ?? null,
      action: origin.action ?? null,
      reason: origin.reason ?? reason,
      status: "blocked",
      daily_used: usage.dailyUsed,
      daily_limit: usage.dailyLimit,
      monthly_used: usage.monthlyUsed,
      monthly_limit: usage.monthlyLimit,
      error: reason,
    })
    .then(({ error }) => {
      if (error) {
        rateLimitedWarn(
          `premium-api-budget:blocked-log:${api}`,
          BUDGET_LOG_TTL_MS,
          "[availability] log de bloqueio premium falhou",
          formatError(error),
        );
      }
    });

  rateLimitedWarn(
    `premium-api-budget:blocked:${api}:${reason}`,
    BUDGET_LOG_TTL_MS,
    [
      "[availability] fallback externo bloqueado",
      `- fonte: ${api}`,
      `- motivo: ${reason}`,
      "- ocorrências iguais serão agrupadas",
    ].join("\n"),
  );
}

export async function completePremiumApiBudget(
  reservation: Reservation | null,
  status: BudgetStatus,
  error?: string | null,
) {
  if (!reservation?.id) return;

  const { error: updateError } = await supabaseAdmin
    .from("poplog3_premium_api_usage")
    .update({
      status,
      error: error ?? null,
      used_at: new Date().toISOString(),
    })
    .eq("id", reservation.id);

  if (updateError) {
    rateLimitedWarn(
      `premium-api-budget:complete:${reservation.api}:${status}`,
      BUDGET_LOG_TTL_MS,
      "[availability] fechamento de orçamento premium falhou",
      formatError(updateError),
    );
  }
}

export async function runPremiumApiQueued<T>(
  api: PremiumApi,
  task: () => Promise<T>,
): Promise<T> {
  const previous = queueByApi.get(api) ?? Promise.resolve();

  const run = previous
    .catch(() => undefined)
    .then(async () => {
      const minInterval = cooldownMsFor(api);
      const elapsed = Date.now() - (lastRunByApi.get(api) ?? 0);
      if (elapsed < minInterval) {
        await new Promise((resolve) => setTimeout(resolve, minInterval - elapsed));
      }

      try {
        return await task();
      } finally {
        lastRunByApi.set(api, Date.now());
      }
    });

  queueByApi.set(api, run);
  return run;
}
