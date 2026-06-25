import { NextRequest } from "next/server";

import { db } from "@/server/db/client";
import { enqueueRefreshJob } from "@/server/workers/refresh-queue";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  const secret = process.env.POPLOG_CRON_SECRET?.trim() || "poplog-cron-smoke";
  process.env.POPLOG_CRON_SECRET = secret;

  const { GET } = await import("@/app/api/cron/refresh-workers/route");
  const unauthorized = await GET(new NextRequest("http://localhost/api/cron/refresh-workers?limit=1"));
  assert(unauthorized.status === 401, "cron endpoint must reject missing secret");

  const job = await enqueueRefreshJob({
    kind: "cron-smoke",
    cacheKey: `cron-smoke:any:${Date.now()}`,
    priority: -10_000,
  });

  const response = await GET(
    new NextRequest("http://localhost/api/cron/refresh-workers?limit=1", {
      headers: { authorization: `Bearer ${secret}` },
    }),
  );
  assert(response.ok, `cron endpoint failed with HTTP ${response.status}`);
  const payload = await response.json() as {
    ok?: boolean;
    processed?: number;
    failed?: Array<{ id: string }>;
  };

  assert(payload.ok === true, "cron payload ok mismatch");
  assert((payload.processed ?? 0) >= 1, "cron did not process the smoke job");
  assert(payload.failed?.some((item) => item.id === job.id.toString()), "smoke job was not routed through failure handling");

  const heartbeat = await db.adminActionLog.findFirst({
    where: {
      entityType: "worker",
      entityId: "refresh-queue",
      action: "worker.cron_tick",
    },
    orderBy: { createdAt: "desc" },
  });
  assert(heartbeat, "cron heartbeat was not recorded");

  await db.poplogRefreshQueue.deleteMany({ where: { id: job.id } });
  console.log("[worker-cron-smoke] ok", {
    processed: payload.processed,
    heartbeatAt: heartbeat.createdAt.toISOString(),
  });
}

main()
  .catch((error) => {
    console.error("[worker-cron-smoke] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
