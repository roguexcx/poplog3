import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:hero] ${label}: ok`);
  return value;
}

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:hero] ${label}: ok`);
}

async function assertGte(label: string, actual: number, min: number): Promise<void> {
  if (actual < min) {
    throw new Error(`${label} expected >= ${min}, got ${actual}`);
  }
  console.log(`[smoke:hero] ${label}: ok (${actual})`);
}

async function main() {
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_HERO_ENABLED = "false";
  await assertEqual("flag off", getLocalDbFlagState().hero, false);

  process.env.POPLOG_LOCAL_HERO_ENABLED = "true";
  await assertEqual("flag on", getLocalDbFlagState().hero, true);

  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${localUserId}-hero-smoke`;
  const fakeTvId = 987661301;
  const fakeMovieId = 987661302;
  const tvContentId = `tv-${fakeTvId}`;
  const movieContentId = `movie-${fakeMovieId}`;

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "hero-smoke@poplog.dev",
      name: "POPLOG Hero Smoke User",
    },
  });

  try {
    // Create series in title cache
    await db.poplog3Title.upsert({
      where: { tmdbId_mediaType: { tmdbId: fakeTvId, mediaType: "tv" } },
      update: { title: "Hero Smoke Series", updatedAt: new Date() },
      create: {
        tmdbId: fakeTvId,
        mediaType: "tv",
        title: "Hero Smoke Series",
        originalTitle: "Hero Smoke Series EN",
        posterPath: "/poster-hero.jpg",
        backdropPath: "/backdrop-hero.jpg",
        year: 2025,
        runtime: null,
        episodeRunTime: [45],
        voteAverage: 8.5,
        numberOfSeasons: 1,
        numberOfEpisodes: 10,
        genres: [{ id: 18, name: "Drama" }],
        tmdbPayload: {
          status: "Returning Series",
          images: { backdrops: [] },
        },
      },
    });

    // Create movie in title cache
    await db.poplog3Title.upsert({
      where: { tmdbId_mediaType: { tmdbId: fakeMovieId, mediaType: "movie" } },
      update: { title: "Hero Smoke Movie", updatedAt: new Date() },
      create: {
        tmdbId: fakeMovieId,
        mediaType: "movie",
        title: "Hero Smoke Movie",
        posterPath: "/poster-movie.jpg",
        backdropPath: "/backdrop-movie.jpg",
        year: 2026,
        runtime: 95,
        voteAverage: 7.8,
        genres: [{ id: 28, name: "Action" }],
        tmdbPayload: { status: "Released" },
      },
    });

    // Create episodes for the series
    await db.poplog3Episode.createMany({
      data: [
        { seriesTmdbId: fakeTvId, seasonNumber: 1, episodeNumber: 1, name: "Pilot", airDate: new Date("2025-01-01"), runtime: 45, stillPath: "/still.jpg" },
        { seriesTmdbId: fakeTvId, seasonNumber: 1, episodeNumber: 2, name: "Ep2", airDate: new Date("2025-01-08"), runtime: 44 },
        { seriesTmdbId: fakeTvId, seasonNumber: 1, episodeNumber: 3, name: "Ep3", airDate: new Date("2025-01-15"), runtime: 46 },
      ],
      skipDuplicates: true,
    });

    // Add series to user library
    await db.userTitle.upsert({
      where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId: fakeTvId, mediaType: "tv" } },
      update: { status: "watching", updatedAt: new Date() },
      create: { userId: smokeUserId, tmdbId: fakeTvId, mediaType: "tv", status: "watching" },
    });

    // Add movie to watchlist
    await db.userTitle.upsert({
      where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId: fakeMovieId, mediaType: "movie" } },
      update: { status: "watchlist", updatedAt: new Date() },
      create: { userId: smokeUserId, tmdbId: fakeMovieId, mediaType: "movie", status: "watchlist" },
    });

    // Mark S1E1 watched
    await db.userEpisode.upsert({
      where: { userId_seriesTmdbId_seasonNumber_episodeNumber: { userId: smokeUserId, seriesTmdbId: fakeTvId, seasonNumber: 1, episodeNumber: 1 } },
      update: { watchedAt: new Date("2025-01-02") },
      create: { userId: smokeUserId, seriesTmdbId: fakeTvId, seasonNumber: 1, episodeNumber: 1, watchedAt: new Date("2025-01-02"), runtimeMinutes: 45 },
    });

    // Create user_title_state for series (needed by getLocalUserLibraryFromState)
    await db.userTitleState.upsert({
      where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId: fakeTvId, mediaType: "tv" } },
      update: {
        status: "watching",
        watchedEpisodes: 1,
        airedEpisodes: 3,
        totalEpisodes: 10,
        nextSeason: 1,
        nextEpisode: 2,
        lastWatchedAt: new Date("2025-01-02"),
        lastEventAt: new Date("2025-01-02"),
        bestProviderName: "Hero Stream",
        bestProviderType: "subscription",
        updatedAt: new Date(),
      },
      create: {
        userId: smokeUserId,
        tmdbId: fakeTvId,
        mediaType: "tv",
        status: "watching",
        favorite: false,
        watchedEpisodes: 1,
        airedEpisodes: 3,
        totalEpisodes: 10,
        progressPct: 33,
        nextSeason: 1,
        nextEpisode: 2,
        lastWatchedAt: new Date("2025-01-02"),
        lastEventAt: new Date("2025-01-02"),
        bestProviderName: "Hero Stream",
        bestProviderType: "subscription",
        watchedKeys: ["S01E01"],
      },
    });

    // Create user_title_state for movie
    await db.userTitleState.upsert({
      where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId: fakeMovieId, mediaType: "movie" } },
      update: { status: "watchlist", updatedAt: new Date() },
      create: {
        userId: smokeUserId,
        tmdbId: fakeMovieId,
        mediaType: "movie",
        status: "watchlist",
        favorite: false,
        watchedEpisodes: 0,
        airedEpisodes: 0,
        progressPct: 0,
        lastEventAt: new Date(),
        watchedKeys: [],
      },
    });

    // Create availability
    await db.catalogAvailability.create({
      data: {
        tmdbId: BigInt(fakeTvId),
        mediaType: "tv",
        providerName: "Hero Stream",
        providerRegion: "BR",
        providerType: "subscription",
        source: "tmdb",
        sourceConfidence: "high",
        checkedAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    }).catch(() => { /* may exist */ });

    // --- Test 1: getLocalUserLibraryFromState ---
    const { getLocalDbFlagState: _f, isLocalHeroEnabled } = await import("@/server/runtime/local-db-flags");
    await assertEqual("hero flag active", isLocalHeroEnabled(), true);

    // Simulate getLocalUserLibraryFromState query
    const stateRows = await db.userTitleState.findMany({
      where: { userId: smokeUserId, status: { in: ["watching", "watchlist"] } },
      orderBy: { lastEventAt: "desc" },
      take: 150,
      select: {
        tmdbId: true, mediaType: true, status: true, favorite: true, liked: true,
        watchedEpisodes: true, airedEpisodes: true, totalEpisodes: true,
        nextSeason: true, nextEpisode: true, nextEpisodeAirDate: true,
        lastWatchedAt: true, lastEventAt: true, createdAt: true,
        bestProviderName: true, bestProviderType: true, bestProviderLogo: true,
      },
    });
    await assertEqual("state rows count", stateRows.length, 2);

    const tvState = stateRows.find((r) => r.mediaType === "tv");
    const movieState = stateRows.find((r) => r.mediaType === "movie");
    await assertValue("tv state", tvState);
    await assertEqual("tv watchedEpisodes", tvState!.watchedEpisodes, 1);
    await assertEqual("tv bestProviderName", tvState!.bestProviderName, "Hero Stream");
    await assertValue("movie state", movieState);

    // --- Test 2: getLocalTitleMap equivalent ---
    const tvTitles = await db.poplog3Title.findMany({
      where: { mediaType: "tv", tmdbId: { in: [fakeTvId] } },
      select: { tmdbId: true, title: true, tmdbPayload: true, genres: true, numberOfEpisodes: true },
    });
    await assertEqual("tv title count", tvTitles.length, 1);
    await assertEqual("tv title name", tvTitles[0]!.title, "Hero Smoke Series");
    await assertValue("tv tmdbPayload", tvTitles[0]!.tmdbPayload);

    // --- Test 3: getLocalAvailabilityMap equivalent ---
    const availRows = await db.catalogAvailability.findMany({
      where: { tmdbId: { in: [BigInt(fakeTvId)] }, mediaType: "tv", providerRegion: "BR" },
      select: { tmdbId: true, providerName: true, providerType: true },
    });
    await assertGte("availability rows", availRows.length, 1);
    await assertEqual("provider name", availRows[0]!.providerName, "Hero Stream");
    await assertEqual("provider type", availRows[0]!.providerType, "subscription");

    // --- Test 4: recordLocalHeroImpressions equivalent ---
    const heroSessionsBefore = await db.heroSpotlightSession.count({ where: { userId: smokeUserId } });
    await db.heroSpotlightSession.createMany({
      data: [
        { userId: smokeUserId, contentId: tvContentId, shownAt: new Date(), position: 1, scoreAtTime: 150.5 },
        { userId: smokeUserId, contentId: movieContentId, shownAt: new Date(), position: 2, scoreAtTime: 95.0 },
      ],
    });
    const heroSessionsAfter = await db.heroSpotlightSession.count({ where: { userId: smokeUserId } });
    await assertEqual("sessions created", heroSessionsAfter - heroSessionsBefore, 2);

    // --- Test 5: getLocalHeroImpressionStats equivalent ---
    const since = new Date(Date.now() - 30 * 86_400_000);
    const impressionRows = await db.heroSpotlightSession.findMany({
      where: { userId: smokeUserId, contentId: { in: [tvContentId, movieContentId] }, shownAt: { gte: since } },
      select: { contentId: true, shownAt: true },
      orderBy: { shownAt: "desc" },
    });
    await assertEqual("impression rows", impressionRows.length, 2);
    await assertEqual("tv impression key", impressionRows.some((r) => r.contentId === tvContentId), true);
    await assertEqual("movie impression key", impressionRows.some((r) => r.contentId === movieContentId), true);

    // --- Test 6: cooldown — same title shown twice, stats show it ---
    const now = Date.now();
    const tvStats = impressionRows.filter((r) => r.contentId === tvContentId);
    const ageHours = Math.max(0, (now - tvStats[0]!.shownAt.getTime()) / 3_600_000);
    await assertEqual("tv last seen within 1h", ageHours < 1, true);

    // Second impression (cooldown test)
    await db.heroSpotlightSession.create({
      data: { userId: smokeUserId, contentId: tvContentId, shownAt: new Date(), position: 1, scoreAtTime: 140 },
    });
    const tvImpressionsNow = await db.heroSpotlightSession.count({
      where: { userId: smokeUserId, contentId: tvContentId, shownAt: { gte: since } },
    });
    await assertEqual("tv times seen (cooldown check)", tvImpressionsNow, 2);

    console.log("[smoke:hero] all assertions passed");
  } finally {
    await db.heroSpotlightSession.deleteMany({ where: { userId: smokeUserId } });
    await db.userTitleState.deleteMany({ where: { userId: smokeUserId } });
    await db.userEpisode.deleteMany({ where: { userId: smokeUserId } });
    await db.userTitle.deleteMany({ where: { userId: smokeUserId } });
    await db.catalogAvailability.deleteMany({ where: { tmdbId: { in: [BigInt(fakeTvId), BigInt(fakeMovieId)] } } });
    await db.poplog3Episode.deleteMany({ where: { seriesTmdbId: fakeTvId } });
    await db.poplog3Title.deleteMany({ where: { tmdbId: { in: [fakeTvId, fakeMovieId] } } });
    await db.user.deleteMany({ where: { id: smokeUserId } });
    console.log("[smoke:hero] cleanup: ok");
  }

  console.log("[smoke:hero] completed");
}

main().catch((error) => {
  console.error("[smoke:hero] failed", error);
  process.exitCode = 1;
});
