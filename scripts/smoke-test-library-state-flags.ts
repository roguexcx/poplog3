import { db } from "@/server/db/client";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:library-state] ${label}: ok`);
  return value;
}

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:library-state] ${label}: ok`);
}

async function main() {
  process.env.POPLOG_LOCAL_LIBRARY_ENABLED = "true";
  process.env.POPLOG_LOCAL_USER_STATE_ENABLED = "true";

  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${localUserId}-library-state-flags-smoke`;
  const smokeMovieId = 987656001;
  const smokeSeriesId = 987656002;

  const [
    libraryService,
    userTitleStateService,
    titleCacheLocalService,
  ] = await Promise.all([
    import("@/server/library/library-service"),
    import("@/server/state/user-title-state"),
    import("@/server/local-services/title-cache-local.service"),
  ]);

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "library-state-flags-smoke@poplog.dev",
      name: "POPLOG Library State Flags Smoke User",
    },
  });

  try {
    await titleCacheLocalService.upsertCachedTitle({
      tmdb_id: smokeMovieId,
      media_type: "movie",
      title: "Library Flag Smoke Movie",
      original_title: "Library Flag Smoke Movie",
      poster_path: "/library-flag-smoke.jpg",
      backdrop_path: "/library-flag-smoke-backdrop.jpg",
      release_date: "2026-02-01",
      year: 2026,
      runtime: 97,
      episode_run_time: null,
      vote_average: 7.1,
      popularity: 3,
      number_of_episodes: null,
      number_of_seasons: null,
      last_synced_at: new Date().toISOString(),
    });
    await titleCacheLocalService.upsertCachedTitle({
      tmdb_id: smokeSeriesId,
      media_type: "tv",
      title: "Library Flag Smoke Series",
      original_title: "Library Flag Smoke Series",
      poster_path: "/library-flag-smoke-series.jpg",
      backdrop_path: "/library-flag-smoke-series-backdrop.jpg",
      first_air_date: "2026-02-02",
      year: 2026,
      runtime: 42,
      episode_run_time: [42],
      vote_average: 7.4,
      popularity: 4,
      number_of_episodes: 3,
      number_of_seasons: 1,
      last_synced_at: new Date().toISOString(),
    });
    console.log("[smoke:library-state] title cache fixtures: ok");

    const created = await assertValue("library title create", await libraryService.upsertUserTitleStatus({
      userId: smokeUserId,
      tmdbId: smokeMovieId,
      mediaType: "movie",
      status: "watchlist",
    }));
    await assertEqual("created status", created.status, "watchlist");

    const library = await libraryService.getUserLibrary(smokeUserId, "watchlist");
    await assertEqual("library read count", library.length, 1);
    await assertEqual("library payload tmdb_id", library[0].tmdb_id, smokeMovieId);
    await assertEqual("library payload title", library[0].title?.title ?? null, "Library Flag Smoke Movie");

    const status = await assertValue(
      "library title status read",
      await libraryService.getUserTitleStatus(smokeUserId, smokeMovieId, "movie"),
    );
    await assertEqual("status read value", status.status, "watchlist");

    const updated = await assertValue("library title update", await libraryService.upsertUserTitleStatus({
      userId: smokeUserId,
      tmdbId: smokeMovieId,
      mediaType: "movie",
      status: "watched",
      favorite: true,
    }));
    await assertEqual("updated status", updated.status, "watched");
    await assertEqual("updated favorite", updated.favorite, true);

    await userTitleStateService.upsertTitleState({
      userId: smokeUserId,
      tmdbId: smokeSeriesId,
      mediaType: "tv",
      libraryEntry: { status: "watching", favorite: false, liked: null },
      seriesProgress: {
        watchedCount: 1,
        airedEpisodes: 2,
        totalEpisodes: 3,
        nextEpisode: { seasonNumber: 1, episodeNumber: 2, airDate: "2026-02-09" },
        lastWatchedAt: new Date().toISOString(),
        watchedKeys: ["1:1"],
      },
      event: { type: "status_changed", payload: { source: "library-state-flags-smoke" } },
    });
    console.log("[smoke:library-state] user title state upsert: ok");

    const state = await assertValue(
      "user title state read",
      await userTitleStateService.readTitleState(smokeUserId, smokeSeriesId, "tv"),
    );
    await assertEqual("state watched episodes", state.watched_episodes, 1);
    await assertEqual("state computed", state.computed_state, "in_progress");

    const states = await userTitleStateService.getUserTitleStates(smokeUserId, {
      mediaType: "tv",
      limit: 5,
    });
    await assertEqual("user title states list count", states.length, 1);

    await userTitleStateService.refreshTitleStateAvailability(smokeUserId, smokeSeriesId, "tv", {
      providerName: "Local Flag Stream",
      providerType: "subscription",
      providerLogo: "/provider.png",
    });
    const stateWithAvailability = await assertValue(
      "user title state availability read",
      await userTitleStateService.readTitleState(smokeUserId, smokeSeriesId, "tv"),
    );
    await assertEqual("state availability provider", stateWithAvailability.best_provider_name, "Local Flag Stream");

    const knownIds = await userTitleStateService.getUserKnownTitleIds(smokeUserId);
    if (!knownIds.has(`${smokeSeriesId}:tv`)) {
      throw new Error("known title ids did not include local state");
    }
    console.log("[smoke:library-state] known title ids read: ok");

    const stateBackedLibrary = await libraryService.getUserLibraryState(smokeUserId, "watched");
    await assertEqual("state-backed library empty status", stateBackedLibrary?.length ?? 0, 1);

    await libraryService.removeUserTitle(smokeUserId, smokeMovieId, "movie");
    const removed = await libraryService.getUserTitleStatus(smokeUserId, smokeMovieId, "movie");
    await assertEqual("library title removed", removed, null);
  } finally {
    await db.userTitle.deleteMany({ where: { userId: smokeUserId } });
    await db.userTitleState.deleteMany({ where: { userId: smokeUserId } });
    await db.userEvent.deleteMany({ where: { userId: smokeUserId } });
    await db.user.deleteMany({ where: { id: smokeUserId } });
    await titleCacheLocalService.deleteCachedTitle("movie", smokeMovieId);
    await titleCacheLocalService.deleteCachedTitle("tv", smokeSeriesId);
    console.log("[smoke:library-state] cleanup: ok");
  }

  console.log("[smoke:library-state] completed");
}

main().catch((error) => {
  console.error("[smoke:library-state] failed", error);
  process.exitCode = 1;
});
