import { db } from "@/server/db/client";
import {
  completePremiumApiUsage,
  createEngineLogEntry,
  createPremiumApiUsage,
  deleteCachedTitleRow,
  deleteEngineLogEntry,
  deleteExternalIdsCache,
  deleteIcsAgendaCache,
  deletePremiumApiUsage,
  deleteRatingsCache,
  deleteSeasonCache,
  getCachedEpisodeRow,
  getCachedSeasonRow,
  getCachedTitleRow,
  getExternalIdsCache,
  getCachedRatingsRow,
  invalidateContinuitySectionCache,
  isRatingsCacheFresh,
  isSeasonCacheFresh,
  isTitleCacheFresh,
  listCatalogAvailability,
  listRecentEngineLogEntries,
  replaceCatalogAvailability,
  readContinuitySectionCache,
  readIcsAgendaCache,
  upsertCachedTitleRow,
  upsertExternalIdsCache,
  upsertApiUsageDaily,
  upsertRatingsCache,
  upsertSeasonCache,
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

  const smokeTmdbId = 987654321;
  await assertBoolean("title cache write", await upsertCachedTitleRow({
    tmdbId: smokeTmdbId,
    mediaType: "movie",
    title: "Repository Smoke Movie",
    originalTitle: "Repository Smoke Movie",
    overview: "Local repository smoke test title.",
    posterPath: "poster.jpg",
    backdropPath: "/backdrop.jpg",
    releaseDate: "2026-01-01",
    year: 2026,
    runtime: 100,
    genres: ["Smoke"],
    popularity: 1,
    voteAverage: 7.5,
    voteCount: 10,
    originalLanguage: "en",
    tmdbPayload: {
      credits: {},
      videos: {},
      recommendations: {},
      external_ids: {},
      "watch/providers": {},
    },
  }));
  const titleRow = await nullable("title cache read", getCachedTitleRow("movie", smokeTmdbId));
  if (!titleRow || !isTitleCacheFresh(titleRow.lastSyncedAt)) {
    throw new Error("title cache freshness failed");
  }
  console.log("[smoke] title cache freshness: ok");

  await assertBoolean("external ids write", await upsertExternalIdsCache({
    tmdbId: smokeTmdbId,
    mediaType: "movie",
    imdbId: "tt987654321",
    tvdbId: "tvdb-smoke",
    traktId: "trakt-smoke",
    watchmodeId: 123456,
    motnId: "motn-smoke",
  }));
  await nullable("external ids read", getExternalIdsCache("movie", smokeTmdbId));

  await assertBoolean("ratings cache write", await upsertRatingsCache({
    tmdbId: smokeTmdbId,
    mediaType: "movie",
    imdbRating: 7.1,
    imdbVotes: 1234,
    rottenTomatoesScore: 80,
    metacriticScore: 70,
    tmdbRating: 7.5,
    poplogScore: 82,
    sourcePayload: { source: "smoke" },
  }));
  const ratingsRow = await nullable("ratings cache read", getCachedRatingsRow("movie", smokeTmdbId));
  if (!ratingsRow || !isRatingsCacheFresh(ratingsRow.updatedAt)) {
    throw new Error("ratings cache freshness failed");
  }
  console.log("[smoke] ratings cache freshness: ok");

  const smokeSeriesId = 987654322;
  await assertBoolean("season cache write", await upsertSeasonCache({
    seriesTmdbId: smokeSeriesId,
    seasonNumber: 1,
    tmdbSeasonId: 111,
    name: "Smoke Season",
    overview: "Season repository smoke test.",
    posterPath: "/season.jpg",
    airDate: "2026-01-01",
    episodeCount: 1,
    voteAverage: 8.1,
    tmdbPayload: { source: "smoke" },
    episodes: [
      {
        episodeNumber: 1,
        tmdbEpisodeId: 222,
        name: "Smoke Episode",
        overview: "Episode repository smoke test.",
        stillPath: "/still.jpg",
        airDate: "2026-01-02",
        runtime: 45,
        voteAverage: 8,
        voteCount: 5,
        productionCode: "SMK001",
        episodeType: "standard",
      },
    ],
  }));
  const seasonRow = await nullable("season cache read", getCachedSeasonRow(smokeSeriesId, 1));
  await nullable("episode cache read", getCachedEpisodeRow(smokeSeriesId, 1, 1));
  if (!seasonRow || !isSeasonCacheFresh(seasonRow.lastSyncedAt)) {
    throw new Error("season cache freshness failed");
  }
  console.log("[smoke] season cache freshness: ok");

  await assertBoolean("catalog availability replace", await replaceCatalogAvailability({
    imdbId: "tt987654321",
    providerRegion: "BR",
    rows: [
      {
        imdbId: "tt987654321",
        tmdbId: BigInt(smokeTmdbId),
        mediaType: "movie",
        providerName: "Smoke Stream",
        providerRegion: "BR",
        providerType: "subscription",
        source: "local",
        sourceConfidence: "high",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rawPayloadJson: { source: "smoke" },
      },
    ],
  }));
  const availabilityRows = await listCatalogAvailability({
    imdbId: "tt987654321",
    providerRegion: "BR",
  });
  if (availabilityRows.length !== 1) {
    throw new Error("catalog availability read failed");
  }
  console.log("[smoke] catalog availability read: ok");

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
  await assertBoolean("catalog availability delete", await replaceCatalogAvailability({
    imdbId: "tt987654321",
    providerRegion: "BR",
    rows: [],
  }));
  await assertBoolean("season cache delete", await deleteSeasonCache(smokeSeriesId, 1));
  await assertBoolean("ratings cache delete", await deleteRatingsCache("movie", smokeTmdbId));
  await assertBoolean("external ids delete", await deleteExternalIdsCache("movie", smokeTmdbId));
  await assertBoolean("title cache delete", await deleteCachedTitleRow("movie", smokeTmdbId));

  console.log("[smoke] local repositories completed");
}

async function assertBoolean(label: string, value: boolean): Promise<void> {
  if (!value) throw new Error(`${label} failed`);
  console.log(`[smoke] ${label}: ok`);
}

async function nullable<T>(label: string, promise: Promise<T | null>): Promise<T | null> {
  const value = await promise;
  if (!value) throw new Error(`${label} returned null`);
  console.log(`[smoke] ${label}: ok`);
  return value;
}

main()
  .catch((error) => {
    console.error("[smoke] local repositories failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
