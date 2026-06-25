import { db } from "@/server/db/client";
import { refreshQueueConfig } from "@/server/workers/refresh-queue";
import { runRefreshQueueBatch } from "@/server/workers/refresh-queue-runner";

async function main() {
  const once = process.argv.includes("--once");
  const pollMs = Math.max(5_000, Number(process.env.POPLOG_REFRESH_WORKER_POLL_MS ?? 30_000));

  do {
    const result = await runRefreshQueueBatch({
      source: once ? "script-once" : "script-loop",
      recordHeartbeat: true,
      limit: refreshQueueConfig().maxConcurrency,
    });
    if (result.idle) {
      console.log("[refresh-worker] idle", {
        durationMs: result.durationMs,
      });
    } else {
      console.log("[refresh-worker] tick", {
        processed: result.processed,
        completed: result.completed.length,
        failed: result.failed.length,
        durationMs: result.durationMs,
      });
      for (const job of result.completed) console.log("[refresh-worker] completed", job);
      for (const job of result.failed) console.warn("[refresh-worker] failed", job);
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  } while (true);
}

main()
  .catch((error) => {
    console.error("[refresh-worker] fatal", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
