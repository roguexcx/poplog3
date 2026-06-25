import type { PoplogRefreshQueue } from "@prisma/client";

import { db } from "@/server/db/client";
import { enqueueRefreshJob } from "@/server/workers/refresh-queue";

export const SERIES_EPISODES_JOB_KIND = "series-episodes";

export type EnqueueSeriesEpisodeHydrationInput = {
  seriesTmdbId: number;
  imdbId?: string | null;
  traktId?: bigint | number | string | null;
  slug?: string | null;
  priority?: number;
  runAfter?: Date;
};

export type PopularSeriesPrehydrationResult = {
  considered: number;
  alreadyHydrated: number;
  enqueued: number;
  jobs: Array<{
    id: string;
    cacheKey: string;
    imdbId: string | null;
    tmdbId: number;
  }>;
};

export function seriesEpisodesCacheKey(seriesTmdbId: number) {
  return `${SERIES_EPISODES_JOB_KIND}:tv:${seriesTmdbId}`;
}

export async function enqueueSeriesEpisodeHydrationJob(
  input: EnqueueSeriesEpisodeHydrationInput,
): Promise<PoplogRefreshQueue> {
  return enqueueRefreshJob({
    kind: SERIES_EPISODES_JOB_KIND,
    cacheKey: seriesEpisodesCacheKey(input.seriesTmdbId),
    mediaType: "tv",
    poplogId: String(input.seriesTmdbId),
    imdbId: input.imdbId ?? null,
    traktId: input.traktId ?? null,
    slug: input.slug ?? null,
    priority: input.priority ?? 40,
    runAfter: input.runAfter,
  });
}

export async function enqueuePopularSeriesPrehydration(options: {
  limit?: number;
  missingOnly?: boolean;
  priority?: number;
} = {}): Promise<PopularSeriesPrehydrationResult> {
  const limit = Math.max(1, Math.min(options.limit ?? Number(process.env.POPLOG_SERIES_PREHYDRATE_LIMIT ?? 12), 50));
  const missingOnly = options.missingOnly ?? true;
  const priority = options.priority ?? 45;

  const rows = await db.poplog3Title.findMany({
    where: {
      mediaType: "tv",
      posterPath: { not: null },
      OR: [{ imdbId: { not: null } }, { traktId: { not: null } }, { title: { not: null } }],
    },
    orderBy: [{ popularity: "desc" }, { voteCount: "desc" }, { updatedAt: "desc" }],
    take: limit,
    select: {
      tmdbId: true,
      imdbId: true,
      traktId: true,
      slug: true,
    },
  });

  let alreadyHydrated = 0;
  const jobs: PopularSeriesPrehydrationResult["jobs"] = [];

  for (const row of rows) {
    if (missingOnly) {
      const seasonCount = await db.titleSeason.count({
        where: { seriesTmdbId: row.tmdbId, seasonNumber: { gt: 0 } },
      });
      if (seasonCount > 0) {
        alreadyHydrated += 1;
        continue;
      }
    }

    const job = await enqueueSeriesEpisodeHydrationJob({
      seriesTmdbId: row.tmdbId,
      imdbId: row.imdbId,
      traktId: row.traktId,
      slug: row.slug,
      priority,
    });

    jobs.push({
      id: job.id.toString(),
      cacheKey: job.cacheKey,
      imdbId: job.imdbId,
      tmdbId: row.tmdbId,
    });
  }

  return {
    considered: rows.length,
    alreadyHydrated,
    enqueued: jobs.length,
    jobs,
  };
}
