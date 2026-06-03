import { db } from "@/server/db/client";
import {
  completePremiumApiUsage,
  clearSeriesProgress,
  computeUserSeriesProgress,
  createCuradoriaSignal,
  createEngineLogEntry,
  createPremiumApiUsage,
  createUserEvent,
  deleteCachedTitleRow,
  deleteCuradoriaSignalsForContent,
  deleteEngineLogEntry,
  deleteExternalIdsCache,
  deleteIcsAgendaCache,
  deletePremiumApiUsage,
  deleteRatingsCache,
  deleteSeasonCache,
  deleteUserEventsForTitle,
  deleteUserRating,
  deleteUserTitleFeedbackRows,
  deleteUserTitleState,
  buildTitleFeedbackState,
  getCachedEpisodeRow,
  getCachedSeasonRow,
  getCachedTitleRow,
  getExternalIdsCache,
  getCachedRatingsRow,
  getTitleFeedbackRows,
  getUserCuradoriaPreference,
  getUserLibraryItems,
  getUserRating,
  getUserTitle,
  getWatchedEpisodesForSeries,
  invalidateContinuitySectionCache,
  isRatingsCacheFresh,
  isSeasonCacheFresh,
  isTitleCacheFresh,
  listCatalogAvailability,
  listCuradoriaSignals,
  listRecentEngineLogEntries,
  listUserEvents,
  readUserTitleState,
  replaceCatalogAvailability,
  readContinuitySectionCache,
  readIcsAgendaCache,
  removeUserTitle,
  saveUserTitleFeedback,
  syncFeedbackFlagsToTitleState,
  upsertCachedTitleRow,
  upsertUserCuradoriaPreference,
  upsertExternalIdsCache,
  upsertApiUsageDaily,
  upsertRatingsCache,
  upsertSeasonCache,
  upsertUserRating,
  upsertUserTitle,
  upsertUserTitleState,
  upsertWatchedEpisode,
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

  const smokeUserId = `${userId}-repo-smoke`;
  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "repo-smoke@poplog.dev",
      name: "POPLOG Repository Smoke User",
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

  const libraryWatchlistId = 987654331;
  const libraryWatchedId = 987654332;
  const libraryWatchingSeriesId = 987654333;

  await assertOk("library watchlist upsert", await upsertUserTitle({
    userId: smokeUserId,
    tmdbId: libraryWatchlistId,
    mediaType: "movie",
    status: "watchlist",
    notes: "repository smoke watchlist",
  }));
  await assertOk("library watched upsert", await upsertUserTitle({
    userId: smokeUserId,
    tmdbId: libraryWatchedId,
    mediaType: "movie",
    status: "watched",
    favorite: true,
    rating: 5,
  }));
  await assertOk("library watching upsert", await upsertUserTitle({
    userId: smokeUserId,
    tmdbId: libraryWatchingSeriesId,
    mediaType: "tv",
    status: "watching",
  }));
  await assertOk("library title read", await getUserTitle({
    userId: smokeUserId,
    tmdbId: libraryWatchlistId,
    mediaType: "movie",
  }));
  const watchlistItems = await assertOk("library list by status", await getUserLibraryItems({
    userId: smokeUserId,
    status: "watchlist",
  }));
  if (watchlistItems.length !== 1) {
    throw new Error("library status filter failed");
  }

  await assertOk("user title state upsert", await upsertUserTitleState({
    userId: smokeUserId,
    tmdbId: libraryWatchingSeriesId,
    mediaType: "tv",
    status: "watching",
    computedState: "in_progress",
    watchedEpisodes: 1,
    airedEpisodes: 2,
    totalEpisodes: 2,
    progressPct: 50,
    nextSeason: 1,
    nextEpisode: 2,
    nextEpisodeAirDate: "2024-01-08",
    watchedKeys: ["S01E01"],
    editorialAffinity: 1.25,
    editorialPenalty: 0.25,
    editorialScore: 1,
    isBoosted: true,
  }));
  await assertOk("user title state read", await readUserTitleState({
    userId: smokeUserId,
    tmdbId: libraryWatchingSeriesId,
    mediaType: "tv",
  }));

  await assertBoolean("episode progress catalog write", await upsertSeasonCache({
    seriesTmdbId: libraryWatchingSeriesId,
    seasonNumber: 1,
    tmdbSeasonId: 3331,
    name: "Smoke Progress Season",
    overview: "Progress repository smoke test.",
    posterPath: "/progress-season.jpg",
    airDate: "2024-01-01",
    episodeCount: 2,
    voteAverage: 7.9,
    tmdbPayload: { source: "smoke-progress" },
    episodes: [
      {
        episodeNumber: 1,
        tmdbEpisodeId: 33311,
        name: "Progress One",
        overview: "Watched episode.",
        stillPath: "/progress-one.jpg",
        airDate: "2024-01-01",
        runtime: 42,
        voteAverage: 8,
        voteCount: 10,
        productionCode: "PRG001",
        episodeType: "standard",
      },
      {
        episodeNumber: 2,
        tmdbEpisodeId: 33312,
        name: "Progress Two",
        overview: "Next episode.",
        stillPath: "/progress-two.jpg",
        airDate: "2024-01-08",
        runtime: 43,
        voteAverage: 8,
        voteCount: 9,
        productionCode: "PRG002",
        episodeType: "standard",
      },
    ],
  }));
  await assertOk("episode progress write", await upsertWatchedEpisode({
    userId: smokeUserId,
    seriesTmdbId: libraryWatchingSeriesId,
    seasonNumber: 1,
    episodeNumber: 1,
    runtimeMinutes: 42,
  }));
  const watchedEpisodes = await assertOk("episode progress read", await getWatchedEpisodesForSeries({
    userId: smokeUserId,
    seriesTmdbId: libraryWatchingSeriesId,
  }));
  if (watchedEpisodes.length !== 1) {
    throw new Error("episode progress read count failed");
  }
  const progress = await assertOk("episode progress compute", await computeUserSeriesProgress({
    userId: smokeUserId,
    seriesTmdbId: libraryWatchingSeriesId,
  }));
  if (progress.watchedCount !== 1 || progress.airedEpisodes < 2 || progress.nextEpisode?.episodeNumber !== 2) {
    throw new Error("episode progress compute failed");
  }

  await assertOk("user rating upsert", await upsertUserRating({
    userId: smokeUserId,
    mediaType: "movie",
    tmdbId: libraryWatchedId,
    rating: 4.5,
  }));
  const personalRating = await assertOk("user rating read", await getUserRating({
    userId: smokeUserId,
    mediaType: "movie",
    tmdbId: libraryWatchedId,
  }));
  if (!personalRating || Number(personalRating.rating) !== 4.5) {
    throw new Error("user rating read failed");
  }

  await assertOk("user preferences upsert", await upsertUserCuradoriaPreference({
    userId: smokeUserId,
    preferredSessionDurationMinutes: 50,
    typicalWatchDays: ["friday", "saturday"],
    typicalWatchTimeStart: 20,
    typicalWatchTimeEnd: 23,
    topGenres: ["Drama", "Sci-Fi"],
    topPlatforms: ["Netflix"],
    avgEpisodesPerSession: 2,
    prefersShortContent: false,
    bingeTendencyScore: 0.75,
  }));
  await assertOk("user preferences read", await getUserCuradoriaPreference(smokeUserId));

  const feedbackLikedId = 987654334;
  const feedbackDislikedId = 987654335;
  const feedbackNegativeId = 987654336;
  const curadoriaContentId = `tmdb-tv-${libraryWatchingSeriesId}`;

  await assertOk("feedback liked write", await saveUserTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackLikedId,
    mediaType: "movie",
    feedbackType: "liked",
    source: "repository-smoke",
  }));
  const likedRows = await assertOk("feedback liked read", await getTitleFeedbackRows({
    userId: smokeUserId,
    tmdbId: feedbackLikedId,
    mediaType: "movie",
    activeOnly: true,
  }));
  if (!buildTitleFeedbackState(likedRows).activeFeedbackTypes.includes("liked")) {
    throw new Error("feedback liked state failed");
  }

  await assertOk("feedback disliked write", await saveUserTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackDislikedId,
    mediaType: "movie",
    feedbackType: "disliked",
    reason: "repository smoke disliked",
    source: "repository-smoke",
  }));
  const dislikedRows = await assertOk("feedback disliked read", await getTitleFeedbackRows({
    userId: smokeUserId,
    tmdbId: feedbackDislikedId,
    mediaType: "movie",
    activeOnly: true,
  }));
  if (!buildTitleFeedbackState(dislikedRows).activeFeedbackTypes.includes("disliked")) {
    throw new Error("feedback disliked state failed");
  }

  await assertOk("feedback not interested write", await saveUserTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
    feedbackType: "not_interested",
    reason: "repository smoke not interested",
    source: "repository-smoke",
  }));
  await assertOk("feedback hidden write", await saveUserTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
    feedbackType: "hidden",
    source: "repository-smoke",
  }));
  await assertOk("feedback dismissed write", await saveUserTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
    feedbackType: "dismissed",
    surface: "acompanhando",
    scope: "section",
    sectionKey: "repository-smoke",
    source: "repository-smoke",
  }));
  const negativeRows = await assertOk("feedback negative read", await getTitleFeedbackRows({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
    activeOnly: true,
  }));
  const negativeState = buildTitleFeedbackState(negativeRows);
  if (
    !negativeState.notInterested ||
    !negativeState.activeFeedbackTypes.includes("hidden") ||
    !negativeState.activeFeedbackTypes.includes("dismissed_from_section")
  ) {
    throw new Error("feedback negative state failed");
  }

  await assertOk("feedback state flags sync", await syncFeedbackFlagsToTitleState({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
    hasNegativeFeedback: true,
    isHidden: true,
    lastFeedbackType: "hidden",
  }));
  await assertOk("feedback state flags read", await readUserTitleState({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
  }));

  const userEvent = await assertOk("user event write", await createUserEvent({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
    eventType: "feedback_applied",
    payload: { source: "repository-smoke", command: "hidden" },
  }));
  const userEvents = await assertOk("user event read", await listUserEvents({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
    eventType: "feedback_applied",
  }));
  if (!userEvents.some((event) => event.id === userEvent.id)) {
    throw new Error("user event read failed");
  }

  const curadoriaSignal = await assertOk("curadoria signal write", await createCuradoriaSignal({
    userId: smokeUserId,
    contentId: curadoriaContentId,
    signalType: "clicked_hero",
    signalValue: { source: "repository-smoke" },
  }));
  const curadoriaSignals = await assertOk("curadoria signal read", await listCuradoriaSignals({
    userId: smokeUserId,
    contentId: curadoriaContentId,
    signalType: "clicked_hero",
  }));
  if (!curadoriaSignals.some((signal) => signal.id === curadoriaSignal.id)) {
    throw new Error("curadoria signal read failed");
  }

  await assertOk("curadoria signals delete", await deleteCuradoriaSignalsForContent({
    userId: smokeUserId,
    contentId: curadoriaContentId,
  }));
  await assertOk("user events delete", await deleteUserEventsForTitle({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
    eventType: "feedback_applied",
  }));
  await assertOk("feedback liked delete", await deleteUserTitleFeedbackRows({
    userId: smokeUserId,
    tmdbId: feedbackLikedId,
    mediaType: "movie",
  }));
  await assertOk("feedback disliked delete", await deleteUserTitleFeedbackRows({
    userId: smokeUserId,
    tmdbId: feedbackDislikedId,
    mediaType: "movie",
  }));
  await assertOk("feedback negative delete", await deleteUserTitleFeedbackRows({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
  }));
  await assertOk("feedback state flags delete", await deleteUserTitleState({
    userId: smokeUserId,
    tmdbId: feedbackNegativeId,
    mediaType: "tv",
  }));

  await assertOk("user rating delete", await deleteUserRating({
    userId: smokeUserId,
    mediaType: "movie",
    tmdbId: libraryWatchedId,
  }));
  await assertOk("episode progress clear", await clearSeriesProgress({
    userId: smokeUserId,
    seriesTmdbId: libraryWatchingSeriesId,
  }));
  await assertOk("user title state delete", await deleteUserTitleState({
    userId: smokeUserId,
    tmdbId: libraryWatchingSeriesId,
    mediaType: "tv",
  }));
  await assertOk("library watchlist delete", await removeUserTitle({
    userId: smokeUserId,
    tmdbId: libraryWatchlistId,
    mediaType: "movie",
  }));
  await assertOk("library watched delete", await removeUserTitle({
    userId: smokeUserId,
    tmdbId: libraryWatchedId,
    mediaType: "movie",
  }));
  await assertOk("library watching delete", await removeUserTitle({
    userId: smokeUserId,
    tmdbId: libraryWatchingSeriesId,
    mediaType: "tv",
  }));
  await assertBoolean("episode progress catalog delete", await deleteSeasonCache(libraryWatchingSeriesId, 1));
  await db.user.delete({ where: { id: smokeUserId } });
  console.log("[smoke] user repositories cleanup: ok");

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
