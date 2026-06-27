import type { PoplogRefreshQueue } from "@prisma/client";

import { getTitleAvailability } from "@/server/availability";
import { db } from "@/server/db/client";
import { buildRadarGeneralPayload } from "@/server/radar-trakt/radar-trakt-engine";
import { getRadarCachedPayload, radarCacheKey } from "@/server/radar-trakt/radar-cache.service";
import { cacheKnownTitleAssets } from "@/server/source-engine/asset-worker";
import { hydrateSeriesEpisodesFromSources } from "@/server/source-engine/series-episode-hydrator";
import { getTitlePageData } from "@/server/titles/get-title-page-data";
import {
  claimRefreshJobs,
  completeRefreshJob,
  failRefreshJob,
  refreshQueueConfig,
  serializeRefreshJob,
  type RefreshQueueClaimOptions,
} from "@/server/workers/refresh-queue";
import { SERIES_EPISODES_JOB_KIND } from "@/server/workers/series-prehydration";

type SerializedJob = ReturnType<typeof serializeRefreshJob>;
const RADAR_WINDOW_DAYS = 62;

export type RefreshWorkerRunResult = {
  ok: true;
  idle: boolean;
  processed: number;
  completed: SerializedJob[];
  failed: SerializedJob[];
  durationMs: number;
  source: string;
  startedAt: string;
  finishedAt: string;
};

function parseAvailabilityCacheKey(cacheKey: string): {
  mediaType: "movie" | "tv";
  imdbId: string;
  region: string;
  language: string;
} | null {
  const [kind, mediaType, imdbId, region, language] = cacheKey.split(":");
  const parsedMediaType = mediaType === "movie" ? "movie" : mediaType === "tv" ? "tv" : null;
  const parsedImdbId = imdbId ?? "";
  if (kind !== "availability") return null;
  if (!parsedMediaType) return null;
  if (!/^tt\d+$/i.test(parsedImdbId)) return null;
  return {
    mediaType: parsedMediaType,
    imdbId: parsedImdbId,
    region: region || "BR",
    language: language || "pt-BR",
  };
}

function parseSeriesEpisodesJob(job: PoplogRefreshQueue): {
  seriesTmdbId: number;
  imdbId: string | null;
  traktId: string | number | null;
} | null {
  const parsedPoplogId = Number(job.poplogId);
  const parsedFromCacheKey = Number(job.cacheKey.split(":").at(-1));
  const seriesTmdbId = Number.isFinite(parsedPoplogId) && parsedPoplogId > 0
    ? Math.floor(parsedPoplogId)
    : Number.isFinite(parsedFromCacheKey) && parsedFromCacheKey > 0
      ? Math.floor(parsedFromCacheKey)
      : null;

  if (!seriesTmdbId) return null;
  return {
    seriesTmdbId,
    imdbId: job.imdbId ?? null,
    traktId: job.traktId?.toString() ?? null,
  };
}

function parseLocaleParts(cacheKey: string): { region: string; language: string } {
  const parts = cacheKey.split(":");
  return {
    region: parts.at(-2) || "BR",
    language: parts.at(-1) || "pt-BR",
  };
}

export async function processRefreshJob(job: PoplogRefreshQueue) {
  if (job.kind === "availability") {
    const parsed = parseAvailabilityCacheKey(job.cacheKey);
    if (!parsed) throw new Error(`Invalid availability cacheKey: ${job.cacheKey}`);
    await getTitleAvailability({
      mediaType: parsed.mediaType,
      imdbId: parsed.imdbId,
      region: parsed.region,
      language: parsed.language,
      cacheOnly: false,
      bypassProviderCache: true,
      bypassNegativeCache: true,
      suppressAutoWarm: true,
    });
    return;
  }

  if (job.kind === "title") {
    if (!job.imdbId || (job.mediaType !== "movie" && job.mediaType !== "tv")) {
      throw new Error(`Invalid title job: ${job.cacheKey}`);
    }
    const parsed = parseLocaleParts(job.cacheKey);
    await getTitlePageData({
      mediaType: job.mediaType,
      id: job.imdbId,
      sourceHint: "imdb",
      country: parsed.region,
      language: parsed.language,
      force: true,
      debugSource: true,
    });
    return;
  }

  if (job.kind === "assets") {
    if (!job.imdbId) throw new Error(`Invalid assets job: ${job.cacheKey}`);
    const locale = parseLocaleParts(job.cacheKey);
    await cacheKnownTitleAssets({
      imdbId: job.imdbId,
      language: locale.language,
      region: locale.region,
    });
    return;
  }

  if (job.kind === "radar") {
    const locale = parseLocaleParts(job.cacheKey);
    const key = radarCacheKey(locale.region, locale.language, RADAR_WINDOW_DAYS);
    await getRadarCachedPayload(key, locale.region, locale.language, () =>
      buildRadarGeneralPayload({ region: locale.region, language: locale.language }),
    );
    return;
  }

  if (job.kind === SERIES_EPISODES_JOB_KIND) {
    const parsed = parseSeriesEpisodesJob(job);
    if (!parsed) throw new Error(`Invalid series episodes job: ${job.cacheKey}`);
    await hydrateSeriesEpisodesFromSources({
      seriesTmdbId: parsed.seriesTmdbId,
      imdbId: parsed.imdbId,
      traktId: parsed.traktId,
      force: false,
    });
    return;
  }

  throw new Error(`Unsupported job kind: ${job.kind}`);
}

async function recordCronHeartbeat(result: RefreshWorkerRunResult) {
  await db.adminActionLog.create({
    data: {
      actorUserId: "system-cron",
      entityType: "worker",
      entityId: "refresh-queue",
      action: "worker.cron_tick",
      nextJson: {
        idle: result.idle,
        processed: result.processed,
        completed: result.completed.length,
        failed: result.failed.length,
        durationMs: result.durationMs,
      },
      metadata: {
        source: result.source,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
      },
    },
  }).catch((error) => {
    console.warn("[refresh-worker] heartbeat log skipped", error instanceof Error ? error.message : String(error));
  });
}

export async function runRefreshQueueBatch(options: RefreshQueueClaimOptions & {
  source?: string;
  recordHeartbeat?: boolean;
} = {}): Promise<RefreshWorkerRunResult> {
  const started = Date.now();
  const startedAt = new Date(started);
  const config = refreshQueueConfig();
  const jobs = await claimRefreshJobs({
    limit: options.limit ?? config.maxConcurrency,
    lockMs: options.lockMs ?? config.lockMs,
    kinds: options.kinds,
  });
  const completed: SerializedJob[] = [];
  const failed: SerializedJob[] = [];

  await Promise.allSettled(
    jobs.map(async (job) => {
      try {
        await processRefreshJob(job);
        completed.push(serializeRefreshJob(await completeRefreshJob(job.id)));
      } catch (error) {
        failed.push(serializeRefreshJob(await failRefreshJob(job.id, error)));
      }
    }),
  );

  const finished = Date.now();
  const result: RefreshWorkerRunResult = {
    ok: true,
    idle: jobs.length === 0,
    processed: jobs.length,
    completed,
    failed,
    durationMs: finished - started,
    source: options.source ?? "manual",
    startedAt: startedAt.toISOString(),
    finishedAt: new Date(finished).toISOString(),
  };

  if (options.recordHeartbeat) await recordCronHeartbeat(result);
  return result;
}
