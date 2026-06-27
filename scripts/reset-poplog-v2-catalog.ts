import "dotenv/config";
import { spawnSync } from "node:child_process";
import { Prisma, PrismaClient } from "@prisma/client";

import { db as appDb } from "@/server/db/client";
import { ensureMinimumSorteioSeed } from "@/server/sorteio/minimum-pool";

const APPLY = process.argv.includes("--apply");
const RESET_REDIS = process.argv.includes("--redis") || process.env.POPLOG_RESET_REDIS === "true";
const SKIP_MINIMUM_SEED =
  process.argv.includes("--no-minimum-seed") ||
  process.env.POPLOG_RESET_SKIP_MINIMUM_SEED === "true";
const REDIS_PREFIX = process.env.POPLOG_REDIS_PREFIX ?? "poplog";

const db = new PrismaClient();

type Delegate = {
  count?: () => Promise<number>;
  deleteMany?: () => Promise<{ count: number }>;
};

const RESET_MODELS = [
  "adminActionLog",
  "titleOverride",
  "userLibraryIdentity",
  "titleAsset",
  "titleAlias",
  "titleTranslation",
  "titleSourceIdentity",
  "poplogTitleFinancialsCache",
  "poplogSearchCache",
  "poplogPersonCreditsCache",
  "poplogPeopleCache",
  "icsAgendaCache",
  "catalogAvailability",
  "apiUsageDaily",
  "engineApiCallLog",
  "continuitySectionCache",
  "poplog3PremiumApiUsage",
  "userStreamingPreference",
  "streamingProvider",
  "ratingAggregate",
  "userListItem",
  "userList",
  "userEpisode",
  "userTitleState",
  "userTitleFeedback",
  "userRating",
  "userEvent",
  "userCuradoriaState",
  "userCuradoriaSignal",
  "heroSpotlightSession",
  "userTitle",
  "poplog3Episode",
  "titleSeason",
  "poplogRefreshQueue",
  "titleRating",
  "titleExternalId",
  "poplog3Title",
] as const;

const PRESERVED_MODELS = [
  "user",
  "account",
  "session",
  "verificationToken",
  "userCuradoriaPreference",
] as const;

function delegateFor(model: string): Delegate | null {
  const delegate = (db as unknown as Record<string, Delegate | undefined>)[model];
  return delegate?.deleteMany ? delegate : null;
}

async function countModel(model: string): Promise<number | null> {
  const delegate = delegateFor(model);
  if (!delegate?.count) return null;
  try {
    return await delegate.count();
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return null;
    }
    throw error;
  }
}

async function resetModel(model: string): Promise<number | null> {
  const delegate = delegateFor(model);
  if (!delegate?.deleteMany) return null;
  if (!APPLY) return countModel(model);
  try {
    const result = await delegate.deleteMany();
    return result.count;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") {
      return null;
    }
    throw error;
  }
}

function resetRedisByPrefix() {
  if (!RESET_REDIS) return;

  const pattern = `${REDIS_PREFIX}*`;
  const scan = spawnSync("redis-cli", ["--scan", "--pattern", pattern], {
    encoding: "utf8",
    shell: false,
  });

  if (scan.error || scan.status !== 0) {
    console.warn("[source-engine] redis_reset skipped reason=redis_cli_unavailable");
    return;
  }

  const keys = scan.stdout
    .split(/\r?\n/)
    .map((key) => key.trim())
    .filter(Boolean);

  if (!APPLY) {
    console.log(`[source-engine] redis_reset keys_matched=${keys.length} scope=${REDIS_PREFIX} dry_run=true`);
    return;
  }

  let cleared = 0;
  for (let index = 0; index < keys.length; index += 250) {
    const batch = keys.slice(index, index + 250);
    const del = spawnSync("redis-cli", ["del", ...batch], {
      encoding: "utf8",
      shell: false,
    });
    if (del.status === 0) cleared += batch.length;
  }

  console.log(`[source-engine] redis_reset keys_cleared=${cleared} scope=${REDIS_PREFIX}`);
}

async function main() {
  console.log(
    `[source-engine] database_reset started safely=true environment=docker_desktop dry_run=${!APPLY}`,
  );

  for (const model of PRESERVED_MODELS) {
    const count = await countModel(model);
    if (count !== null) {
      console.log(`[source-engine] database_reset preserved model=${model} count=${count}`);
    }
  }

  for (const model of RESET_MODELS) {
    const count = await resetModel(model);
    if (count === null) {
      console.log(`[source-engine] database_reset skipped model=${model} reason=delegate_missing`);
      continue;
    }
    console.log(
      `[source-engine] database_reset table=${model} ${APPLY ? "deleted" : "would_delete"}=${count}`,
    );
  }

  resetRedisByPrefix();

  if (APPLY && !SKIP_MINIMUM_SEED) {
    const seed = await ensureMinimumSorteioSeed({
      minCount: 12,
      reason: "post_catalog_reset",
      force: true,
    });
    console.log(
      `[source-engine] database_reset minimum_sorteio_seed before=${seed.before} after=${seed.after} seeded=${seed.seeded}`,
    );
  } else if (!APPLY) {
    console.log("[source-engine] database_reset minimum_sorteio_seed dry_run=true");
  } else {
    console.log("[source-engine] database_reset minimum_sorteio_seed skipped=true");
  }

  console.log(
    `[source-engine] database_reset catalog_tables_cleared safely=true environment=docker_desktop dry_run=${!APPLY}`,
  );
}

main()
  .catch((error) => {
    console.error("[source-engine] database_reset failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
    if (APPLY && !SKIP_MINIMUM_SEED) {
      await appDb.$disconnect().catch(() => undefined);
    }
  });
