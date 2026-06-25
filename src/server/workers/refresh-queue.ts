import type { MediaType, PoplogRefreshQueue } from "@prisma/client";

import { db } from "@/server/db/client";

export type RefreshQueueStatus = "queued" | "running" | "completed" | "failed";

export type RefreshQueueJobInput = {
  kind: string;
  cacheKey?: string | null;
  mediaType?: MediaType | null;
  poplogId?: string | null;
  traktId?: bigint | number | string | null;
  imdbId?: string | null;
  slug?: string | null;
  priority?: number;
  runAfter?: Date;
};

export type RefreshQueueClaimOptions = {
  limit?: number;
  lockMs?: number;
  kinds?: string[];
};

function normalizeKind(kind: string): string {
  return kind.trim().toLowerCase().replace(/[^a-z0-9:_-]+/g, "-").slice(0, 64) || "generic";
}

function normalizeTraktId(value: RefreshQueueJobInput["traktId"]): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function buildCacheKey(input: RefreshQueueJobInput): string {
  const kind = normalizeKind(input.kind);
  const identity =
    input.imdbId ??
    input.poplogId ??
    input.traktId?.toString() ??
    input.slug ??
    "global";
  return [
    kind,
    input.mediaType ?? "any",
    String(identity).toLowerCase(),
  ].join(":").slice(0, 191);
}

function configuredConcurrency(): number {
  const value = Number(process.env.POPLOG_WORKER_MAX_CONCURRENCY ?? 2);
  return Number.isFinite(value) ? Math.max(1, Math.min(8, Math.floor(value))) : 2;
}

export function refreshQueueConfig() {
  return {
    maxConcurrency: configuredConcurrency(),
    lockMs: Math.max(5_000, Number(process.env.POPLOG_REFRESH_QUEUE_LOCK_MS ?? 60_000)),
    retryDelayMs: Math.max(5_000, Number(process.env.POPLOG_REFRESH_QUEUE_RETRY_DELAY_MS ?? 120_000)),
    maxAttempts: Math.max(1, Number(process.env.POPLOG_REFRESH_QUEUE_MAX_ATTEMPTS ?? 5)),
  };
}

export async function enqueueRefreshJob(input: RefreshQueueJobInput): Promise<PoplogRefreshQueue> {
  const kind = normalizeKind(input.kind);
  const cacheKey = (input.cacheKey?.trim() || buildCacheKey({ ...input, kind })).slice(0, 191);
  const runAfter = input.runAfter ?? new Date();

  return db.poplogRefreshQueue.upsert({
    where: { cacheKey_kind: { cacheKey, kind } },
    update: {
      status: "queued",
      priority: input.priority ?? 100,
      runAfter,
      lockedUntil: null,
      lastError: null,
      mediaType: input.mediaType ?? undefined,
      poplogId: input.poplogId ?? undefined,
      traktId: normalizeTraktId(input.traktId) ?? undefined,
      imdbId: input.imdbId ?? undefined,
      slug: input.slug ?? undefined,
    },
    create: {
      cacheKey,
      kind,
      mediaType: input.mediaType ?? null,
      poplogId: input.poplogId ?? null,
      traktId: normalizeTraktId(input.traktId),
      imdbId: input.imdbId ?? null,
      slug: input.slug ?? null,
      priority: input.priority ?? 100,
      runAfter,
    },
  });
}

export async function claimRefreshJobs(options: RefreshQueueClaimOptions = {}): Promise<PoplogRefreshQueue[]> {
  const config = refreshQueueConfig();
  const limit = Math.max(1, Math.min(options.limit ?? config.maxConcurrency, config.maxConcurrency));
  const now = new Date();
  const lockUntil = new Date(now.getTime() + (options.lockMs ?? config.lockMs));

  const candidates = await db.poplogRefreshQueue.findMany({
    where: {
      status: { in: ["queued", "running"] },
      runAfter: { lte: now },
      OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
      ...(options.kinds?.length ? { kind: { in: options.kinds.map(normalizeKind) } } : {}),
    },
    orderBy: [{ priority: "asc" }, { runAfter: "asc" }, { createdAt: "asc" }],
    take: limit,
  });

  const claimed: PoplogRefreshQueue[] = [];
  for (const job of candidates) {
    const update = await db.poplogRefreshQueue.updateMany({
      where: {
        id: job.id,
        OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        status: { in: ["queued", "running"] },
      },
      data: {
        status: "running",
        lockedUntil: lockUntil,
        attempts: { increment: 1 },
      },
    });
    if (update.count === 1) {
      const row = await db.poplogRefreshQueue.findUnique({ where: { id: job.id } });
      if (row) claimed.push(row);
    }
  }

  return claimed;
}

export async function completeRefreshJob(id: bigint): Promise<PoplogRefreshQueue> {
  return db.poplogRefreshQueue.update({
    where: { id },
    data: {
      status: "completed",
      lockedUntil: null,
      lastError: null,
    },
  });
}

export async function failRefreshJob(id: bigint, error: unknown): Promise<PoplogRefreshQueue> {
  const config = refreshQueueConfig();
  const job = await db.poplogRefreshQueue.findUnique({ where: { id } });
  if (!job) throw new Error("Refresh queue job not found.");

  const exhausted = job.attempts >= config.maxAttempts;
  return db.poplogRefreshQueue.update({
    where: { id },
    data: {
      status: exhausted ? "failed" : "queued",
      lockedUntil: null,
      runAfter: exhausted ? job.runAfter : new Date(Date.now() + config.retryDelayMs),
      lastError: error instanceof Error ? error.message : String(error),
    },
  });
}

export async function getRefreshQueueStats() {
  const now = new Date();
  const staleRunningMs = Math.max(30_000, Number(process.env.POPLOG_WORKER_STALE_RUNNING_MS ?? 5 * 60_000));
  const overdueAlertMs = Math.max(30_000, Number(process.env.POPLOG_WORKER_OVERDUE_ALERT_MS ?? 10 * 60_000));
  const cronExpectedMs = Math.max(60_000, Number(process.env.POPLOG_WORKER_CRON_EXPECTED_MS ?? 10 * 60_000));
  const staleBefore = new Date(now.getTime() - staleRunningMs);
  const overdueBefore = new Date(now.getTime() - overdueAlertMs);

  const [
    byStatus,
    byKind,
    nextJobs,
    staleRunning,
    overdueQueued,
    oldestQueued,
    lastCronLog,
  ] = await Promise.all([
    db.poplogRefreshQueue.groupBy({
      by: ["status"],
      _count: { _all: true },
    }),
    db.poplogRefreshQueue.groupBy({
      by: ["kind", "status"],
      _count: { _all: true },
      orderBy: [{ kind: "asc" }, { status: "asc" }],
    }),
    db.poplogRefreshQueue.findMany({
      where: {
        status: { in: ["queued", "running", "failed"] },
      },
      orderBy: [{ priority: "asc" }, { runAfter: "asc" }, { createdAt: "asc" }],
      take: 25,
    }),
    db.poplogRefreshQueue.count({
      where: {
        status: "running",
        lockedUntil: { lt: now },
        updatedAt: { lt: staleBefore },
      },
    }),
    db.poplogRefreshQueue.count({
      where: {
        status: "queued",
        runAfter: { lt: overdueBefore },
      },
    }),
    db.poplogRefreshQueue.findFirst({
      where: { status: "queued" },
      orderBy: { runAfter: "asc" },
      select: { runAfter: true },
    }),
    db.adminActionLog.findFirst({
      where: {
        entityType: "worker",
        entityId: "refresh-queue",
        action: "worker.cron_tick",
      },
      orderBy: { createdAt: "desc" },
      select: {
        createdAt: true,
        nextJson: true,
        metadata: true,
      },
    }),
  ]);

  const lastCronPayload =
    lastCronLog?.nextJson && typeof lastCronLog.nextJson === "object" && !Array.isArray(lastCronLog.nextJson)
      ? lastCronLog.nextJson as Record<string, unknown>
      : null;
  const lastCronAgeMs = lastCronLog ? now.getTime() - lastCronLog.createdAt.getTime() : null;

  return {
    config: refreshQueueConfig(),
    now: now.toISOString(),
    totals: byStatus.reduce<Record<string, number>>((acc, row) => {
      acc[row.status] = row._count._all;
      return acc;
    }, {}),
    byKind: byKind.map((row) => ({
      kind: row.kind,
      status: row.status,
      count: row._count._all,
    })),
    nextJobs: nextJobs.map(serializeRefreshJob),
    health: {
      staleRunning,
      overdueQueued,
      oldestQueuedRunAfter: oldestQueued?.runAfter.toISOString() ?? null,
      lastCronAt: lastCronLog?.createdAt.toISOString() ?? null,
      lastCronAgeMs,
      lastCronHealthy: lastCronAgeMs !== null && lastCronAgeMs <= cronExpectedMs,
      lastCronProcessed: Number(lastCronPayload?.processed ?? 0),
      lastCronCompleted: Number(lastCronPayload?.completed ?? 0),
      lastCronFailed: Number(lastCronPayload?.failed ?? 0),
      lastCronDurationMs: Number(lastCronPayload?.durationMs ?? 0),
      cronExpectedMs,
      staleRunningMs,
      overdueAlertMs,
    },
  };
}

export function serializeRefreshJob(job: PoplogRefreshQueue) {
  return {
    ...job,
    id: job.id.toString(),
    traktId: job.traktId?.toString() ?? null,
    lockedUntil: job.lockedUntil?.toISOString() ?? null,
    runAfter: job.runAfter.toISOString(),
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}
