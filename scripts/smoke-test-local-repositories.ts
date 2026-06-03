import { db } from "@/server/db/client";
import {
  completePremiumApiUsage,
  createEngineLogEntry,
  createPremiumApiUsage,
  deleteEngineLogEntry,
  deleteIcsAgendaCache,
  deletePremiumApiUsage,
  invalidateContinuitySectionCache,
  listRecentEngineLogEntries,
  readContinuitySectionCache,
  readIcsAgendaCache,
  upsertApiUsageDaily,
  writeContinuitySectionCache,
  writeIcsAgendaCache,
} from "@/server/repositories";

async function assertOk<T>(
  label: string,
  result: { ok: true; data: T } | { ok: false; error: string },
): Promise<T> {
  if (!result.ok) {
    throw new Error(`${label} failed: ${result.error}`);
  }
  console.log(`[smoke] ${label}: ok`);
  return result.data;
}

async function main() {
  const userId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  await db.user.upsert({
    where: { id: userId },
    update: { updatedAt: new Date() },
    create: {
      id: userId,
      email: "local@poplog.dev",
      name: "POPLOG Local User",
    },
  });

  const engineLog = await assertOk(
    "engine log write",
    await createEngineLogEntry({
      api: "tmdb",
      op: "repository-smoke",
      origin: "admin",
      mediaType: "movie",
      tmdbId: 550,
      endpoint: "/movie/550",
      cacheStatus: "miss",
      durationMs: 12,
      success: true,
      httpStatus: 200,
    }),
  );

  await assertOk(
    "engine log read",
    await listRecentEngineLogEntries({ limit: 5, api: "tmdb" }),
  );

  await assertOk(
    "api usage daily upsert",
    await upsertApiUsageDaily({
      day: new Date().toISOString().slice(0, 10),
      api: "tmdb",
      totalCalls: 1,
      cacheHits: 0,
      errors: 0,
      avgMs: 12,
      maxMs: 12,
      p95Ms: 12,
    }),
  );

  const premiumUsage = await assertOk(
    "premium api usage write",
    await createPremiumApiUsage({
      api: "omdb",
      periodDay: new Date().toISOString().slice(0, 10),
      periodMonth: new Date().toISOString().slice(0, 7),
      endpoint: "/",
      tmdbId: 550,
      mediaType: "movie",
      region: "BR",
      userId,
      action: "repository-smoke",
      reason: "smoke-test",
      dailyUsed: 1,
      dailyLimit: 100,
      monthlyUsed: 1,
      monthlyLimit: 1000,
    }),
  );

  if (premiumUsage?.id) {
    await assertOk(
      "premium api usage complete",
      await completePremiumApiUsage({ id: premiumUsage.id, status: "success" }),
    );
  }

  const icsId = "smoke";
  await assertOk(
    "ics cache write",
    await writeIcsAgendaCache({
      id: icsId,
      payload: { ok: true, source: "smoke" },
    }),
  );
  await assertOk(
    "ics cache read",
    await readIcsAgendaCache<{ ok: boolean; source: string }>({
      id: icsId,
      ttlHours: 24,
    }),
  );

  const sectionKey = "smoke-section";
  await assertOk(
    "continuity cache write",
    await writeContinuitySectionCache({
      sectionKey,
      userId,
      region: "BR",
      language: "pt-BR",
      payload: { ok: true, source: "smoke" },
      ttlMs: 60_000,
    }),
  );
  await assertOk(
    "continuity cache read",
    await readContinuitySectionCache<{ ok: boolean; source: string }>({
      sectionKey,
      userId,
      region: "BR",
      language: "pt-BR",
    }),
  );
  await assertOk(
    "continuity cache invalidate",
    await invalidateContinuitySectionCache({ userId, sectionKey }),
  );

  await assertOk("ics cache delete", await deleteIcsAgendaCache(icsId));
  if (premiumUsage?.id) {
    await assertOk("premium api usage delete", await deletePremiumApiUsage(premiumUsage.id));
  }
  if (engineLog?.id) {
    await assertOk("engine log delete", await deleteEngineLogEntry(engineLog.id));
  }

  console.log("[smoke] local repositories completed");
}

main()
  .catch((error) => {
    console.error("[smoke] local repositories failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
