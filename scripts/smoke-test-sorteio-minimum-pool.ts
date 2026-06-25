import "dotenv/config";

import { db } from "@/server/db/client";
import { ensureMinimumSorteioSeed } from "@/server/sorteio/minimum-pool";
import { buildSorteioPool, pickWeightedSorteioItem } from "@/server/sorteio/sorteio-engine";

const USER_ID = "smoke-sorteio-minimum-pool";

function assert(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
  console.log(`[smoke:sorteio-minimum-pool] ${message}: ok`);
}

async function run() {
  await db.userEvent.deleteMany({ where: { userId: USER_ID } });
  await db.userTitleState.deleteMany({ where: { userId: USER_ID } });
  await db.user.deleteMany({ where: { id: USER_ID } });

  await db.user.create({
    data: { id: USER_ID, email: `${USER_ID}@poplog.dev`, name: "Sorteio Minimum Pool Smoke" },
  });

  const seed = await ensureMinimumSorteioSeed({ force: true, reason: "smoke_minimum_pool" });
  assert(seed.after >= seed.minimum, "seed minimo garante catalogo elegivel");

  const pool = await buildSorteioPool(
    USER_ID,
    { mode: "discovery", type: "all", vibe: "all" },
    { externalDiscovery: false, warmAvailability: false },
  );

  assert(pool.meta.poolSource === "local_db", "pool usa banco local sem chamada externa");
  assert(pool.meta.skippedReasons.includes("external_discovery_disabled_for_draw"), "descoberta externa continua bloqueada no draw");
  assert(pool.meta.poolCount >= 8, "pool local tem volume minimo para sorteio");

  const item = pickWeightedSorteioItem(pool.items);
  assert(Boolean(item?.title), "sorteio escolhe item local valido");

  await db.userEvent.deleteMany({ where: { userId: USER_ID } });
  await db.user.deleteMany({ where: { id: USER_ID } });
}

run()
  .catch((error) => {
    console.error("[smoke:sorteio-minimum-pool] FAILED", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
