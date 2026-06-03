import { db } from "@/server/db/client";
import {
  apiUsageLocalService,
  catalogAvailabilityLocalService,
  continuitySectionCacheLocalService,
  curadoriaLocalService,
  engineLoggerLocalService,
  episodeProgressLocalService,
  externalIdsCacheLocalService,
  feedbackLocalService,
  icsAgendaCacheLocalService,
  libraryLocalService,
  ratingsCacheLocalService,
  seasonCacheLocalService,
  titleCacheLocalService,
  userPreferencesLocalService,
  userRatingsLocalService,
  userTitleStateLocalService,
} from "@/server/local-services";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:services] ${label}: ok`);
  return value;
}

async function assertBoolean(label: string, value: boolean): Promise<void> {
  if (!value) throw new Error(`${label} failed`);
  console.log(`[smoke:services] ${label}: ok`);
}

async function assertRepoOk<T>(
  label: string,
  result: { ok: true; data: T } | { ok: false; error: string },
): Promise<T> {
  if (!result.ok) throw new Error(`${label} failed: ${result.error}`);
  console.log(`[smoke:services] ${label}: ok`);
  return result.data;
}

async function main() {
  const smokeTmdbId = 987655001;
  const smokeSeriesId = 987655002;
  const smokeImdbId = "tt987655001";
  const continuityUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${continuityUserId}-local-services-smoke`;

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "local-services-smoke@poplog.dev",
      name: "POPLOG Local Services Smoke User",
    },
  });

  await assertBoolean("title cache write", (await titleCacheLocalService.upsertCachedTitle({
    tmdb_id: smokeTmdbId,
    media_type: "movie",
    title: "Local Service Smoke Movie",
    original_title: "Local Service Smoke Movie",
    overview: "Smoke test for local title adapter.",
    poster_path: "/poster.jpg",
    backdrop_path: "/backdrop.jpg",
    release_date: "2026-01-01",
    first_air_date: null,
    last_air_date: null,
    year: 2026,
    runtime: 101,
    episode_run_time: null,
    genres: ["Smoke"],
    popularity: 1,
    vote_average: 7.7,
    vote_count: 15,
    number_of_episodes: null,
    number_of_seasons: null,
    original_language: "en",
    last_synced_at: new Date().toISOString(),
  }, {
    credits: {},
    videos: {},
    recommendations: {},
    external_ids: {},
    "watch/providers": {},
  })).ok);
  const title = await assertValue("title cache read", await titleCacheLocalService.getCachedTitle("movie", smokeTmdbId));
  if (!titleCacheLocalService.isTitleCacheFresh(title.last_synced_at)) {
    throw new Error("title cache freshness failed");
  }

  await seasonCacheLocalService.upsertSeason({
    seriesTmdbId: smokeSeriesId,
    seasonNumber: 1,
    tmdbSeasonId: 655001,
    name: "Local Service Smoke Season",
    overview: "Smoke test for local season adapter.",
    posterPath: "/season.jpg",
    airDate: "2026-01-01",
    episodeCount: 1,
    voteAverage: 8.2,
    tmdbPayload: { source: "local-service-smoke" },
    episodes: [
      {
        episodeNumber: 1,
        tmdbEpisodeId: 655002,
        name: "Local Service Smoke Episode",
        overview: "Smoke episode.",
        stillPath: "/still.jpg",
        airDate: "2026-01-02",
        runtime: 44,
        voteAverage: 8,
        voteCount: 7,
        productionCode: "LSS001",
        episodeType: "standard",
      },
    ],
  });
  console.log("[smoke:services] season cache write: ok");
  await assertValue("season cache read", await seasonCacheLocalService.getCachedSeason(smokeSeriesId, 1));
  await assertValue("episode cache read", await seasonCacheLocalService.getCachedEpisode(smokeSeriesId, 1, 1));

  await ratingsCacheLocalService.upsertRatings({
    tmdbId: smokeTmdbId,
    mediaType: "movie",
    imdbRating: 7.2,
    imdbVotes: 222,
    rottenTomatoesScore: 81,
    metacriticScore: 70,
    tmdbRating: 7.7,
    poplogScore: 83,
    sourcePayload: { source: "local-service-smoke" },
  });
  console.log("[smoke:services] ratings cache write: ok");
  const ratings = await assertValue("ratings cache read", await ratingsCacheLocalService.getCachedRatings("movie", smokeTmdbId));
  if (!ratingsCacheLocalService.isRatingsCacheFresh(ratings.updated_at)) {
    throw new Error("ratings cache freshness failed");
  }

  await externalIdsCacheLocalService.upsertExternalIds({
    tmdbId: smokeTmdbId,
    mediaType: "movie",
    imdbId: smokeImdbId,
    tvdbId: "tvdb-local-service-smoke",
    traktId: "trakt-local-service-smoke",
    watchmodeId: 655001,
    motnId: "motn-local-service-smoke",
  });
  console.log("[smoke:services] external ids write: ok");
  await assertValue("external ids read", await externalIdsCacheLocalService.getExternalIds("movie", smokeTmdbId));

  await assertBoolean("catalog availability write", await catalogAvailabilityLocalService.replaceAvailability({
    imdbId: smokeImdbId,
    providerRegion: "BR",
    rows: [
      {
        imdbId: smokeImdbId,
        tmdbId: BigInt(smokeTmdbId),
        mediaType: "movie",
        providerName: "Local Service Stream",
        providerRegion: "BR",
        providerType: "subscription",
        source: "local",
        sourceConfidence: "high",
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        rawPayloadJson: { source: "local-service-smoke" },
      },
    ],
  }));
  const availabilityRows = await catalogAvailabilityLocalService.listAvailability({
    imdbId: smokeImdbId,
    providerRegion: "BR",
  });
  if (availabilityRows.length !== 1) throw new Error("catalog availability read failed");
  console.log("[smoke:services] catalog availability read: ok");

  await assertBoolean("ics cache write", await icsAgendaCacheLocalService.writeCache({
    cacheVersion: "local-services-smoke",
    ok: true,
  }, { id: "local-services-smoke" }));
  await assertValue("ics cache read", await icsAgendaCacheLocalService.readCache({
    id: "local-services-smoke",
    cacheVersion: "local-services-smoke",
  }));

  await continuitySectionCacheLocalService.writeContinuitySectionCache({
    sectionKey: "local-services-smoke",
    userId: continuityUserId,
    region: "BR",
    language: "pt-BR",
    payload: { ok: true },
    ttlMs: 60_000,
  });
  console.log("[smoke:services] continuity cache write: ok");
  await assertValue("continuity cache read", await continuitySectionCacheLocalService.readContinuitySectionCache("local-services-smoke", {
    userId: continuityUserId,
    region: "BR",
    language: "pt-BR",
  }));
  await assertBoolean("continuity cache invalidate", await continuitySectionCacheLocalService.invalidateContinuitySectionCacheLocal({
    userId: continuityUserId,
    sectionKey: "local-services-smoke",
  }));

  await engineLoggerLocalService.persistEngineLogEntry({
    id: 0,
    ts: Date.now(),
    api: "tmdb",
    op: "local-service-smoke",
    origin: "admin",
    mediaType: "movie",
    tmdbId: smokeTmdbId,
    endpoint: "/movie/local-service-smoke",
    cacheStatus: "miss",
    durationMs: 11,
    success: true,
    httpStatus: 200,
  });
  console.log("[smoke:services] engine log write: ok");
  await assertValue("engine log snapshot", await engineLoggerLocalService.getPersistentSnapshot(10));

  await assertRepoOk("api usage write", await apiUsageLocalService.upsertDailyApiUsage({
    day: new Date().toISOString().slice(0, 10),
    api: "tmdb",
    totalCalls: 1,
    cacheHits: 0,
    errors: 0,
    avgMs: 11,
    maxMs: 11,
    p95Ms: 11,
  }));
  const premiumUsage = await assertRepoOk("premium usage reserve", await apiUsageLocalService.reservePremiumUsage({
    api: "omdb",
    periodDay: new Date().toISOString().slice(0, 10),
    periodMonth: new Date().toISOString().slice(0, 7),
    endpoint: "/",
    tmdbId: smokeTmdbId,
    mediaType: "movie",
    action: "local-service-smoke",
    reason: "smoke-test",
  }));
  if (premiumUsage?.id) {
    await assertRepoOk("premium usage complete", await apiUsageLocalService.completePremiumUsage({
      id: premiumUsage.id,
      status: "success",
    }));
  }

  const watchlistId = 987655011;
  const watchingId = smokeSeriesId;
  const watchedId = smokeTmdbId;
  const feedbackId = 987655012;
  const curadoriaContentId = curadoriaLocalService.toContentId("tv", watchingId);

  await assertValue("library watchlist write", await libraryLocalService.upsertUserTitleStatus({
    userId: smokeUserId,
    tmdbId: watchlistId,
    mediaType: "movie",
    status: "watchlist",
  }));
  await assertValue("library watching write", await libraryLocalService.upsertUserTitleStatus({
    userId: smokeUserId,
    tmdbId: watchingId,
    mediaType: "tv",
    status: "watching",
  }));
  await assertValue("library watched write", await libraryLocalService.upsertUserTitleStatus({
    userId: smokeUserId,
    tmdbId: watchedId,
    mediaType: "movie",
    status: "watched",
    favorite: true,
  }));
  await assertValue("library title read", await libraryLocalService.getUserTitleStatus(smokeUserId, watchlistId, "movie"));
  const watchlist = await libraryLocalService.getUserLibrary(smokeUserId, "watchlist");
  if (watchlist.length !== 1) throw new Error("library watchlist service read failed");
  console.log("[smoke:services] library list read: ok");

  await userTitleStateLocalService.upsertTitleState({
    userId: smokeUserId,
    tmdbId: watchingId,
    mediaType: "tv",
    libraryEntry: { status: "watching", favorite: false, liked: null },
    seriesProgress: {
      watchedCount: 0,
      airedEpisodes: 1,
      totalEpisodes: 1,
      nextEpisode: { seasonNumber: 1, episodeNumber: 1, airDate: "2026-01-02" },
      lastWatchedAt: null,
      watchedKeys: [],
    },
    event: { type: "status_changed", payload: { source: "local-services-smoke" } },
  });
  console.log("[smoke:services] user title state write: ok");
  await assertValue("user title state read", await userTitleStateLocalService.readTitleState(smokeUserId, watchingId, "tv"));

  await assertValue("episode progress toggle", await episodeProgressLocalService.toggleEpisodeWatched({
    userId: smokeUserId,
    seriesTmdbId: watchingId,
    seasonNumber: 1,
    episodeNumber: 1,
    watched: true,
    runtimeMinutes: 44,
  }));
  const watchedEpisodes = await episodeProgressLocalService.getWatchedEpisodesForSeries(smokeUserId, watchingId);
  if (watchedEpisodes.length !== 1) throw new Error("episode progress local read failed");
  console.log("[smoke:services] episode progress read: ok");
  const progress = await episodeProgressLocalService.computeUserSeriesProgress(smokeUserId, watchingId);
  if (progress.watchedCount !== 1) throw new Error("episode progress local compute failed");
  console.log("[smoke:services] episode progress compute: ok");

  await assertValue("user rating write", await userRatingsLocalService.upsertUserRating({
    userId: smokeUserId,
    mediaType: "movie",
    tmdbId: watchedId,
    rating: 4.5,
  }));
  const userRating = await assertValue("user rating read", await userRatingsLocalService.getUserRating(smokeUserId, "movie", watchedId));
  if (userRating.rating !== 4.5) throw new Error("user rating local value failed");

  await assertValue("user preferences write", await userPreferencesLocalService.upsertUserPreferences({
    userId: smokeUserId,
    preferredSessionDurationMinutes: 55,
    typicalWatchDays: ["friday"],
    topGenres: ["Drama"],
    topPlatforms: ["Netflix"],
  }));
  await assertValue("user preferences read", await userPreferencesLocalService.getUserPreferences(smokeUserId));

  await assertValue("feedback liked apply", await feedbackLocalService.applyTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackId,
    mediaType: "movie",
    command: "liked",
    source: "local-services-smoke",
  }));
  await assertValue("feedback disliked apply", await feedbackLocalService.applyTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackId,
    mediaType: "movie",
    command: "disliked",
    source: "local-services-smoke",
  }));
  await assertValue("feedback not interested apply", await feedbackLocalService.applyTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackId,
    mediaType: "movie",
    command: "not_interested",
    source: "local-services-smoke",
  }));
  await assertValue("feedback hidden apply", await feedbackLocalService.applyTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackId,
    mediaType: "movie",
    command: "hidden",
    source: "local-services-smoke",
  }));
  await assertValue("feedback dismissed apply", await feedbackLocalService.applyTitleFeedback({
    userId: smokeUserId,
    tmdbId: feedbackId,
    mediaType: "movie",
    command: "dismissed",
    surface: "acompanhando",
    scope: "section",
    sectionKey: "local-services-smoke",
    source: "local-services-smoke",
  }));
  const feedbackMap = await feedbackLocalService.getTitleFeedbackMap(smokeUserId, feedbackId, "movie");
  if (!feedbackMap.get(`movie:${feedbackId}`)?.length) throw new Error("feedback local map failed");
  console.log("[smoke:services] feedback read: ok");

  await curadoriaLocalService.logUserActionEvent({
    userId: smokeUserId,
    tmdbId: feedbackId,
    mediaType: "movie",
    eventType: "feedback_applied",
    payload: { source: "local-services-smoke" },
  });
  console.log("[smoke:services] user event write: ok");
  await assertValue("curadoria signal write", await curadoriaLocalService.logCuradoriaSignal(
    smokeUserId,
    curadoriaContentId,
    "clicked_hero",
    { source: "local-services-smoke" },
  ));
  const curadoriaSignals = await curadoriaLocalService.getCuradoriaSignals({
    userId: smokeUserId,
    contentId: curadoriaContentId,
    signalType: "clicked_hero",
  });
  if (curadoriaSignals.length !== 1) throw new Error("curadoria signal local read failed");
  console.log("[smoke:services] curadoria signal read: ok");

  await userRatingsLocalService.deleteUserRating({
    userId: smokeUserId,
    mediaType: "movie",
    tmdbId: watchedId,
  });
  console.log("[smoke:services] user rating delete: ok");
  await episodeProgressLocalService.clearSeriesProgress(smokeUserId, watchingId);
  console.log("[smoke:services] episode progress clear: ok");
  await curadoriaLocalService.clearCuradoriaSignals({ userId: smokeUserId, contentId: curadoriaContentId });
  console.log("[smoke:services] curadoria signals delete: ok");
  await libraryLocalService.removeUserTitle(smokeUserId, watchlistId, "movie");
  await libraryLocalService.removeUserTitle(smokeUserId, watchingId, "tv");
  await libraryLocalService.removeUserTitle(smokeUserId, watchedId, "movie");
  console.log("[smoke:services] library cleanup: ok");
  await db.userTitleFeedback.deleteMany({ where: { userId: smokeUserId } });
  await db.userTitleState.deleteMany({ where: { userId: smokeUserId } });
  await db.userEvent.deleteMany({ where: { userId: smokeUserId } });
  await db.userCuradoriaPreference.deleteMany({ where: { userId: smokeUserId } });
  await db.user.delete({ where: { id: smokeUserId } });
  console.log("[smoke:services] user services cleanup: ok");

  await assertBoolean("ics cache delete", await icsAgendaCacheLocalService.deleteCache("local-services-smoke"));
  if (premiumUsage?.id) {
    await assertRepoOk("premium usage delete", await apiUsageLocalService.deletePremiumUsage(premiumUsage.id));
  }
  await assertRepoOk("engine logs clear", await engineLoggerLocalService.clearPersistentEntries().then((ok) => ok ? { ok: true as const, data: null } : { ok: false as const, error: "clear failed" }));
  await assertBoolean("catalog availability delete", await catalogAvailabilityLocalService.replaceAvailability({
    imdbId: smokeImdbId,
    providerRegion: "BR",
    rows: [],
  }));
  await assertBoolean("ratings cache delete", await ratingsCacheLocalService.deleteCachedRatings("movie", smokeTmdbId));
  await assertBoolean("external ids delete", await externalIdsCacheLocalService.deleteExternalIds("movie", smokeTmdbId));
  await assertBoolean("season cache delete", await seasonCacheLocalService.deleteCachedSeason(smokeSeriesId, 1));
  await assertBoolean("title cache delete", await titleCacheLocalService.deleteCachedTitle("movie", smokeTmdbId));

  console.log("[smoke:services] local services completed");
}

main().catch((error) => {
  console.error("[smoke:services] local services failed", error);
  process.exitCode = 1;
});
