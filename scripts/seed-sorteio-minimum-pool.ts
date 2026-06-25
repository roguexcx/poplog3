import "dotenv/config";

import { db } from "@/server/db/client";
import { ensureMinimumSorteioSeed } from "@/server/sorteio/minimum-pool";

async function main() {
  const force = process.argv.includes("--force");
  const minArg = process.argv.find((arg) => arg.startsWith("--min="));
  const minCount = minArg ? Number(minArg.split("=")[1]) : undefined;

  const result = await ensureMinimumSorteioSeed({
    force,
    minCount: Number.isFinite(minCount) ? minCount : undefined,
    reason: force ? "manual_force_seed" : "manual_seed",
  });

  console.log("[sorteio:min-seed]", result);
}

main()
  .catch((error) => {
    console.error("[sorteio:min-seed] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
