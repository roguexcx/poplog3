import "dotenv/config";

import assert from "node:assert/strict";

import { getTitleAvailabilityWithDebug } from "@/server/availability";
import { db } from "@/server/db/client";

const imdbId = "tt0000001";
const mediaType = "movie" as const;
const region = "BR";
const language = "pt-BR";
const providerName = "Prime Video";

async function main() {
  const now = Date.now();
  const expiresAt = new Date(now - 60_000);
  const staleUntil = new Date(now + 60 * 60_000);

  await db.catalogAvailability.deleteMany({
    where: { imdbId, providerName, providerRegion: region, providerLanguage: language },
  });
  await db.catalogAvailability.create({
    data: {
      imdbId,
      mediaType,
      providerName,
      providerRegion: region,
      providerLanguage: language,
      providerType: "subscription",
      providerUrl: "https://example.com/poplog-stale",
      providerLogoUrl: null,
      source: "justwatch",
      sourceConfidence: "high",
      checkedAt: new Date(now - 2 * 60_000),
      expiresAt,
      staleUntil,
      rawPayloadJson: { smoke: "availability-stale" },
    },
  });

  const { summary, debug } = await getTitleAvailabilityWithDebug({
    imdbId,
    mediaType,
    region,
    language,
    cacheOnly: true,
  });

  assert.equal(summary.state, "available", "dado stale ainda retorna disponivel");
  assert.equal(debug.cache.hit, true, "cache hit registrado");
  assert.equal(debug.cache.stale, true, "cache stale registrado");
  const totalProviders =
    summary.providers.flatrate.length +
    summary.providers.free.length +
    summary.providers.ads.length +
    summary.providers.rent.length +
    summary.providers.buy.length;
  assert.ok(totalProviders > 0, "provider stale retornado imediatamente");

  await new Promise((resolve) => setTimeout(resolve, 300));
  const queued = await db.poplogRefreshQueue.findFirst({
    where: {
      kind: "availability",
      cacheKey: `availability:${mediaType}:${imdbId}:${region}:${language}`,
      status: { in: ["queued", "running", "completed", "failed"] },
    },
    orderBy: { updatedAt: "desc" },
  });
  assert.ok(queued, "refresh de availability stale enfileirado");

  await db.catalogAvailability.deleteMany({
    where: { imdbId, providerName, providerRegion: region, providerLanguage: language },
  });
  await db.poplogRefreshQueue.deleteMany({
    where: { kind: "availability", cacheKey: `availability:${mediaType}:${imdbId}:${region}:${language}` },
  });

  console.log("[smoke:availability-stale] ok", {
    state: summary.state,
    cache: debug.cache,
    queuedJob: queued.id.toString(),
  });
}

main()
  .catch((error) => {
    console.error("[smoke:availability-stale] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
