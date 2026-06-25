import "dotenv/config";

import { db } from "@/server/db/client";
import { ensureMinimumSorteioSeed } from "@/server/sorteio/minimum-pool";
import { enqueuePopularSeriesPrehydration } from "@/server/workers/series-prehydration";

async function main() {
  const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.split("=")[1]) : undefined;
  const includeHydrated = process.argv.includes("--include-hydrated");

  await ensureMinimumSorteioSeed({
    minCount: 12,
    reason: "series_prehydration_seed_guard",
  });

  const result = await enqueuePopularSeriesPrehydration({
    limit: Number.isFinite(limit) ? limit : undefined,
    missingOnly: !includeHydrated,
  });

  console.log("[series:prehydrate:popular]", result);
}

main()
  .catch((error) => {
    console.error("[series:prehydrate:popular] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
