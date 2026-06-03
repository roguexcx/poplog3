import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:acompanhando] ${label}: ok`);
  return value;
}

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:acompanhando] ${label}: ok`);
}

async function assertContains(label: string, obj: Record<string, unknown>, keys: string[]): Promise<void> {
  for (const key of keys) {
    if (!(key in obj)) {
      throw new Error(`${label}: missing field '${key}'`);
    }
  }
  console.log(`[smoke:acompanhando] ${label}: ok`);
}

async function main() {
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_ACOMPANHANDO_ENABLED = "false";
  await assertEqual("flag off", getLocalDbFlagState().acompanhando, false);

  process.env.POPLOG_LOCAL_ACOMPANHANDO_ENABLED = "true";
  await assertEqual("flag on", getLocalDbFlagState().acompanhando, true);

  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${localUserId}-acompanhando-smoke`;
  const fakeTmdbId = 987661201;
  const contentId = `tmdb-tv-${fakeTmdbId}`;

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "acompanhando-smoke@poplog.dev",
      name: "POPLOG Acompanhando Smoke User",
    },
  });

  try {
    // Create series in title cache
    await db.poplog3Title.upsert({
      where: { tmdbId_mediaType: { tmdbId: fakeTmdbId, mediaType: "tv" } },
      update: { title: "Acompanhando Smoke Series", updatedAt: new Date() },
      create: {
        tmdbId: fakeTmdbId,
        mediaType: "tv",
        title: "Acompanhando Smoke Series",
        originalTitle: "Acompanhando Smoke Series Original",
        posterPath: "/poster-smoke.jpg",
        backdropPath: "/backdrop-smoke.jpg",
        year: 2026,
        runtime: null,
        episodeRunTime: [42],
        voteAverage: 8.2,
        numberOfSeasons: 2,
        numberOfEpisodes: 20,
        genres: [{ id: 18, name: "Drama" }, { id: 10765, name: "Sci-Fi & Fantasy" }],
        tmdbPayload: {
          status: "Returning Series",
          seasons: [
            { season_number: 1, air_date: "2025-01-01", name: "Season 1", poster_path: null, overview: null },
            { season_number: 2, air_date: "2026-01-01", name: "Season 2", poster_path: null, overview: null },
          ],
        },
      },
    });

    // Create episodes in catalog
    await db.poplog3Episode.createMany({
      data: [
        { seriesTmdbId: fakeTmdbId, seasonNumber: 1, episodeNumber: 1, name: "Pilot", airDate: new Date("2025-01-01"), runtime: 42, stillPath: "/still-s1e1.jpg" },
        { seriesTmdbId: fakeTmdbId, seasonNumber: 1, episodeNumber: 2, name: "Episode 2", airDate: new Date("2025-01-08"), runtime: 44, stillPath: "/still-s1e2.jpg" },
        { seriesTmdbId: fakeTmdbId, seasonNumber: 2, episodeNumber: 1, name: "Season 2 Premiere", airDate: new Date("2026-01-01"), runtime: 50, stillPath: "/still-s2e1.jpg" },
      ],
      skipDuplicates: true,
    });

    // Add series to user library
    await db.userTitle.upsert({
      where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId: fakeTmdbId, mediaType: "tv" } },
      update: { status: "watching", updatedAt: new Date() },
      create: {
        userId: smokeUserId,
        tmdbId: fakeTmdbId,
        mediaType: "tv",
        status: "watching",
      },
    });

    // Mark S1E1 as watched
    await db.userEpisode.upsert({
      where: { userId_seriesTmdbId_seasonNumber_episodeNumber: { userId: smokeUserId, seriesTmdbId: fakeTmdbId, seasonNumber: 1, episodeNumber: 1 } },
      update: { watchedAt: new Date("2025-01-02") },
      create: {
        userId: smokeUserId,
        seriesTmdbId: fakeTmdbId,
        seasonNumber: 1,
        episodeNumber: 1,
        watchedAt: new Date("2025-01-02"),
        runtimeMinutes: 42,
      },
    });

    // Create availability
    await db.catalogAvailability.create({
      data: {
        tmdbId: BigInt(fakeTmdbId),
        mediaType: "tv",
        providerName: "Smoke Stream",
        providerRegion: "BR",
        providerType: "subscription",
        source: "tmdb",
        sourceConfidence: "high",
        checkedAt: new Date("2026-01-01"),
        expiresAt: new Date("2027-01-01"),
      },
    }).catch(() => { /* may already exist */ });

    // Create curadoria state overlay
    const curadoriaStateService = await import("@/server/local-services/curadoria-state-local.service");
    await curadoriaStateService.upsertCuradoriaState({
      userId: smokeUserId,
      contentId,
      contentType: "serie",
      title: "Acompanhando Smoke Series",
      status: "watching",
      snoozedUntil: "2026-02-01T00:00:00.000Z",
      snoozeCount: 1,
      newEpisodeAvailable: true,
      newEpisodeAvailableSince: "2026-01-01T00:00:00.000Z",
      streamingPlatform: "Smoke Stream",
    });

    // --- Validate data assembly (same queries the local GET uses) ---

    const userTitleRows = await db.userTitle.findMany({
      where: { userId: smokeUserId, status: { in: ["watching", "watchlist", "abandoned", "fridge"] } },
      orderBy: { createdAt: "desc" },
      take: 120,
    });
    await assertEqual("userTitle count", userTitleRows.length, 1);
    await assertEqual("userTitle status", userTitleRows[0]!.status, "watching");

    const uniqueTmdbIds = [...new Set(userTitleRows.map((r) => r.tmdbId))];
    const seriesIds = [...new Set(userTitleRows.filter((r) => r.mediaType === "tv").map((r) => r.tmdbId))];
    const mediaTypes = [...new Set(userTitleRows.map((r) => r.mediaType))];
    const contentIds = userTitleRows.map((r) => `tmdb-${r.mediaType}-${r.tmdbId}`);

    const titleRows = await db.poplog3Title.findMany({
      where: { tmdbId: { in: uniqueTmdbIds } },
      select: { tmdbId: true, mediaType: true, title: true, genres: true, tmdbPayload: true, numberOfSeasons: true },
    });
    await assertEqual("titleMeta count", titleRows.length, 1);
    await assertEqual("titleMeta title", titleRows[0]!.title, "Acompanhando Smoke Series");
    await assertValue("titleMeta tmdbPayload", titleRows[0]!.tmdbPayload);

    const watchedRows = await db.userEpisode.findMany({
      where: { userId: smokeUserId, seriesTmdbId: { in: seriesIds } },
      select: { seriesTmdbId: true, seasonNumber: true, episodeNumber: true, watchedAt: true, runtimeMinutes: true },
    });
    await assertEqual("watchedEpisodes count", watchedRows.length, 1);
    await assertEqual("watchedEpisode S1E1", `${watchedRows[0]!.seasonNumber}:${watchedRows[0]!.episodeNumber}`, "1:1");

    const episodeRows = await db.poplog3Episode.findMany({
      where: { seriesTmdbId: { in: seriesIds } },
      select: { seriesTmdbId: true, seasonNumber: true, episodeNumber: true, name: true, airDate: true, runtime: true, stillPath: true },
    });
    await assertEqual("episodeCatalog count", episodeRows.length, 3);

    const availRows = await db.catalogAvailability.findMany({
      where: { tmdbId: { in: uniqueTmdbIds.map((id) => BigInt(id)) }, mediaType: { in: mediaTypes }, providerRegion: { in: ["BR", "US"] } },
      select: { tmdbId: true, mediaType: true, providerName: true, providerType: true, providerRegion: true, checkedAt: true },
    });
    await assertEqual("availability count >= 1", availRows.length >= 1, true);
    await assertEqual("availability providerName", availRows[0]!.providerName, "Smoke Stream");

    const overlay = await curadoriaStateService.getCuradoriaState(smokeUserId, contentId);
    await assertValue("overlay", overlay);
    await assertEqual("overlay snooze_count", overlay!.snooze_count, 1);
    await assertEqual("overlay new_episode_available", overlay!.new_episode_available, true);

    // Build one item manually and validate shape
    const ut = userTitleRows[0]!;
    const titleRow = titleRows[0]!;
    const tmdbPayload = typeof titleRow.tmdbPayload === "object" && titleRow.tmdbPayload !== null && !Array.isArray(titleRow.tmdbPayload)
      ? (titleRow.tmdbPayload as Record<string, unknown>)
      : null;

    const watchedSet = new Set(watchedRows.map((ep) => `${ep.seasonNumber}:${ep.episodeNumber}`));
    const sortedEps = [...episodeRows].sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    const nextEp = sortedEps.find((ep) => !watchedSet.has(`${ep.seasonNumber}:${ep.episodeNumber}`)) ?? null;

    const item = {
      id: ut.id,
      user_id: ut.userId,
      content_id: contentIds[0],
      content_type: "serie",
      title: titleRow.title ?? "Sem título",
      status: "watching",
      current_season: nextEp?.seasonNumber ?? null,
      current_episode: nextEp ? Math.max(nextEp.episodeNumber - 1, 0) : null,
      total_seasons: titleRow.numberOfSeasons ?? null,
      series_status: tmdbPayload?.status ?? null,
      new_episode_available: overlay?.new_episode_available ?? false,
      streaming_platform: availRows[0]?.providerName ?? null,
      snoozed_until: overlay?.snoozed_until ?? null,
      genres: Array.isArray(titleRow.genres) ? titleRow.genres : [],
    };

    await assertContains("item shape", item as Record<string, unknown>, [
      "id", "user_id", "content_id", "content_type", "title", "status",
      "current_season", "current_episode", "total_seasons", "series_status",
      "new_episode_available", "streaming_platform", "snoozed_until", "genres",
    ]);
    await assertEqual("item content_id", item.content_id, contentId);
    await assertEqual("item status", item.status, "watching");
    await assertEqual("item total_seasons", item.total_seasons, 2);
    await assertEqual("item series_status", item.series_status, "Returning Series");
    await assertEqual("item next season", item.current_season, 1);
    await assertEqual("item next episode (0-indexed)", item.current_episode, 1);
    await assertEqual("item new_episode_available", item.new_episode_available, true);
    await assertEqual("item streaming_platform", item.streaming_platform, "Smoke Stream");
    await assertEqual("item snoozed_until truthy", typeof item.snoozed_until === "string", true);
  } finally {
    await db.userCuradoriaState.deleteMany({ where: { userId: smokeUserId } });
    await db.userEpisode.deleteMany({ where: { userId: smokeUserId } });
    await db.userTitle.deleteMany({ where: { userId: smokeUserId } });
    await db.catalogAvailability.deleteMany({ where: { tmdbId: BigInt(fakeTmdbId) } });
    await db.poplog3Episode.deleteMany({ where: { seriesTmdbId: fakeTmdbId } });
    await db.poplog3Title.deleteMany({ where: { tmdbId: fakeTmdbId } });
    await db.user.deleteMany({ where: { id: smokeUserId } });
    console.log("[smoke:acompanhando] cleanup: ok");
  }

  console.log("[smoke:acompanhando] completed");
}

main().catch((error) => {
  console.error("[smoke:acompanhando] failed", error);
  process.exitCode = 1;
});
