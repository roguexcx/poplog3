import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:episode-progress] ${label}: ok`);
  return value;
}

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:episode-progress] ${label}: ok`);
}

async function main() {
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_EPISODE_PROGRESS_ENABLED = "false";
  process.env.POPLOG_LOCAL_LIBRARY_ENABLED = "false";
  process.env.POPLOG_LOCAL_USER_STATE_ENABLED = "false";
  await assertEqual("flag off", getLocalDbFlagState().episodeProgress, false);

  process.env.POPLOG_LOCAL_EPISODE_PROGRESS_ENABLED = "true";
  process.env.POPLOG_LOCAL_LIBRARY_ENABLED = "true";
  process.env.POPLOG_LOCAL_USER_STATE_ENABLED = "true";
  await assertEqual("flag on", getLocalDbFlagState().episodeProgress, true);

  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${localUserId}-episode-progress-smoke`;
  const seriesTmdbId = 987657001;
  const today = new Date();
  const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const twoDaysAgo = new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000);
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  const [
    episodeProgressService,
    userTitleStateService,
  ] = await Promise.all([
    import("@/server/episodes/episode-progress-service"),
    import("@/server/state/user-title-state"),
  ]);

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "episode-progress-smoke@poplog.dev",
      name: "POPLOG Episode Progress Smoke User",
    },
  });

  try {
    await db.poplog3Title.upsert({
      where: { tmdbId_mediaType: { tmdbId: seriesTmdbId, mediaType: "tv" } },
      update: {
        title: "Episode Progress Smoke Series",
        numberOfEpisodes: 4,
        numberOfSeasons: 2,
        runtime: 42,
        episodeRunTime: [42],
        tmdbPayload: { status: "Returning Series" },
      },
      create: {
        tmdbId: seriesTmdbId,
        mediaType: "tv",
        title: "Episode Progress Smoke Series",
        year: today.getFullYear(),
        firstAirDate: twoDaysAgo,
        numberOfEpisodes: 4,
        numberOfSeasons: 2,
        runtime: 42,
        episodeRunTime: [42],
        tmdbPayload: { status: "Returning Series" },
        lastSyncedAt: new Date(),
      },
    });

    await db.poplog3Episode.createMany({
      data: [
        {
          seriesTmdbId,
          seasonNumber: 1,
          episodeNumber: 1,
          name: "Smoke Episode 1",
          airDate: twoDaysAgo,
          runtime: 42,
        },
        {
          seriesTmdbId,
          seasonNumber: 1,
          episodeNumber: 2,
          name: "Smoke Episode 2",
          airDate: yesterday,
          runtime: 43,
        },
        {
          seriesTmdbId,
          seasonNumber: 1,
          episodeNumber: 3,
          name: "Smoke Future Episode",
          airDate: tomorrow,
          runtime: 44,
        },
        {
          seriesTmdbId,
          seasonNumber: 2,
          episodeNumber: 1,
          name: "Smoke Episode S2",
          airDate: yesterday,
          runtime: 45,
        },
      ],
    });
    console.log("[smoke:episode-progress] fixtures: ok");

    const watchedProgress = await episodeProgressService.toggleEpisodeWatched({
      userId: smokeUserId,
      seriesTmdbId,
      seasonNumber: 1,
      episodeNumber: 1,
      watched: true,
      runtimeMinutes: 42,
    });
    await assertEqual("toggle watched count", watchedProgress.watchedCount, 1);
    await assertEqual("toggle aired count", watchedProgress.airedEpisodes, 3);
    await assertEqual("toggle next season", watchedProgress.nextEpisode?.seasonNumber ?? null, 1);
    await assertEqual("toggle next episode", watchedProgress.nextEpisode?.episodeNumber ?? null, 2);

    const watchedRows = await episodeProgressService.getWatchedEpisodesForSeries(smokeUserId, seriesTmdbId);
    await assertEqual("watched rows count", watchedRows.length, 1);
    await assertEqual("watched row season", watchedRows[0].season_number, 1);
    await assertEqual("watched row episode", watchedRows[0].episode_number, 1);

    const stateAfterToggle = await assertValue(
      "state after toggle",
      await userTitleStateService.readTitleState(smokeUserId, seriesTmdbId, "tv"),
    );
    await assertEqual("state watched episodes", stateAfterToggle.watched_episodes, 1);
    await assertEqual("state status", stateAfterToggle.status, "watching");

    const unwatchProgress = await episodeProgressService.toggleEpisodeWatched({
      userId: smokeUserId,
      seriesTmdbId,
      seasonNumber: 1,
      episodeNumber: 1,
      watched: false,
    });
    await assertEqual("toggle unwatch count", unwatchProgress.watchedCount, 0);

    const seasonProgress = await episodeProgressService.markSeasonWatched(smokeUserId, seriesTmdbId, 1);
    await assertEqual("mark season watched count", seasonProgress.watchedCount, 2);

    const clearSeasonProgress = await episodeProgressService.clearSeasonProgress(smokeUserId, seriesTmdbId, 1);
    await assertEqual("clear season count", clearSeasonProgress.watchedCount, 0);

    const untilProgress = await episodeProgressService.markEpisodesUntil({
      userId: smokeUserId,
      seriesTmdbId,
      seasonNumber: 2,
      episodeNumber: 1,
    });
    await assertEqual("mark until watched count", untilProgress.watchedCount, 3);

    const watchingRows = await episodeProgressService.getUserWatchingSeries(smokeUserId, 10);
    await assertEqual("watching rows count", watchingRows.length, 1);
    await assertEqual("watching row title", watchingRows[0].title, "Episode Progress Smoke Series");

    await episodeProgressService.clearSeriesProgress(smokeUserId, seriesTmdbId);
    const clearedProgress = await episodeProgressService.computeUserSeriesProgress(smokeUserId, seriesTmdbId);
    await assertEqual("clear series count", clearedProgress.watchedCount, 0);

    const allAiredProgress = await episodeProgressService.markAllAiredEpisodes(smokeUserId, seriesTmdbId);
    await assertEqual("mark all aired count", allAiredProgress.watchedCount, 3);
  } finally {
    await db.userEpisode.deleteMany({ where: { userId: smokeUserId, seriesTmdbId } });
    await db.userTitleState.deleteMany({ where: { userId: smokeUserId, tmdbId: seriesTmdbId, mediaType: "tv" } });
    await db.userTitle.deleteMany({ where: { userId: smokeUserId, tmdbId: seriesTmdbId, mediaType: "tv" } });
    await db.userEvent.deleteMany({ where: { userId: smokeUserId, tmdbId: seriesTmdbId, mediaType: "tv" } });
    await db.poplog3Episode.deleteMany({ where: { seriesTmdbId } });
    await db.poplog3Title.deleteMany({ where: { tmdbId: seriesTmdbId, mediaType: "tv" } });
    await db.user.deleteMany({ where: { id: smokeUserId } });
    console.log("[smoke:episode-progress] cleanup: ok");
  }

  console.log("[smoke:episode-progress] completed");
}

main().catch((error) => {
  console.error("[smoke:episode-progress] failed", error);
  process.exitCode = 1;
});
