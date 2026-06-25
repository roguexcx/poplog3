import { db } from "@/server/db/client";
import {
  claimRefreshJobs,
  completeRefreshJob,
  enqueueRefreshJob,
  getRefreshQueueStats,
} from "@/server/workers/refresh-queue";

async function main() {
  const kind = "smoke-refresh-queue";
  const cacheKey = `smoke-refresh-queue:${Date.now()}`;

  await db.poplogRefreshQueue.deleteMany({ where: { kind, cacheKey } });

  const created = await enqueueRefreshJob({
    kind,
    cacheKey,
    mediaType: "movie",
    imdbId: "tt0993846",
    priority: 1,
  });

  if (created.status !== "queued") throw new Error("Job was not queued");

  const claimed = await claimRefreshJobs({ limit: 1, kinds: [kind], lockMs: 30_000 });
  const claimedJob = claimed.find((job) => job.id === created.id);
  if (!claimedJob) throw new Error("Queued job was not claimed");
  if (claimedJob.status !== "running") throw new Error("Claimed job was not marked running");

  const completed = await completeRefreshJob(created.id);
  if (completed.status !== "completed") throw new Error("Completed job status mismatch");

  const stats = await getRefreshQueueStats();
  if (!stats.config.maxConcurrency) throw new Error("Queue config missing");

  await db.poplogRefreshQueue.deleteMany({ where: { kind, cacheKey } });
  console.log("[refresh-queue-smoke] ok");
}

main()
  .catch((error) => {
    console.error("[refresh-queue-smoke] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
