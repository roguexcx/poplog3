/**
 * Smoke test: Fase 7N — Continuidade local
 *
 * Cria dados fake, chama os helpers locais e valida shape dos payloads.
 * Limpa tudo ao final.
 */
import "dotenv/config";
import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";
import {
  getLocalContinuityStateRows,
  getLocalTitlesBatch,
  getLocalSeasonsBatch,
  getLocalEpisodesBatch,
  getLocalUserEpisodesBatch,
  getLocalTitleRatingsBatch,
} from "@/server/local-services/continuity-local.service";

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`[smoke:continuity] ✓ ${label}`);
    passed++;
  } else {
    console.error(`[smoke:continuity] ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertValue<T>(label: string, value: T | null | undefined): void {
  assert(label, value !== null && value !== undefined, `got ${String(value)}`);
}

// ── Fake data ─────────────────────────────────────────────────────────────────

const BASE_ID = process.env.LOCAL_USER_ID?.trim() || "local-user";
const SMOKE_USER = `${BASE_ID}-continuity-smoke`;
const FAKE_TV_ID = 987770001;
const FAKE_MOVIE_ID = 987770002;
const TODAY = new Date().toISOString().slice(0, 10);
const RECENT = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10);

async function seed() {
  await db.user.upsert({
    where: { id: SMOKE_USER },
    update: { updatedAt: new Date() },
    create: { id: SMOKE_USER, email: "continuity-smoke@poplog.dev", name: "Continuity Smoke" },
  });

  // TV series in poplog3_titles
  await db.poplog3Title.upsert({
    where: { tmdbId_mediaType: { tmdbId: FAKE_TV_ID, mediaType: "tv" } },
    update: { title: "Continuity Smoke TV" },
    create: {
      tmdbId: FAKE_TV_ID, mediaType: "tv",
      title: "Continuity Smoke TV", originalTitle: "Continuity Smoke TV EN",
      posterPath: "/poster.jpg", backdropPath: "/backdrop.jpg",
      firstAirDate: new Date("2023-01-01"), lastAirDate: new Date(RECENT),
      runtime: null, episodeRunTime: [45],
      numberOfSeasons: 2, numberOfEpisodes: 20,
      voteAverage: 8.2, voteCount: 5000,
      genres: [{ id: 18, name: "Drama" }],
    },
  });

  // Movie in poplog3_titles
  await db.poplog3Title.upsert({
    where: { tmdbId_mediaType: { tmdbId: FAKE_MOVIE_ID, mediaType: "movie" } },
    update: { title: "Continuity Smoke Movie" },
    create: {
      tmdbId: FAKE_MOVIE_ID, mediaType: "movie",
      title: "Continuity Smoke Movie", originalTitle: "Continuity Smoke Movie EN",
      posterPath: "/poster-m.jpg", backdropPath: "/backdrop-m.jpg",
      releaseDate: new Date("2023-06-01"),
      runtime: 110,
      voteAverage: 7.5, voteCount: 3000,
      genres: [{ id: 28, name: "Action" }],
    },
  });

  // Season 1 with 10 episodes
  await db.titleSeason.upsert({
    where: { seriesTmdbId_seasonNumber: { seriesTmdbId: FAKE_TV_ID, seasonNumber: 1 } },
    update: { episodeCount: 10 },
    create: { seriesTmdbId: FAKE_TV_ID, seasonNumber: 1, episodeCount: 10, airDate: new Date("2023-01-01") },
  });

  // Season 2 with 10 episodes
  await db.titleSeason.upsert({
    where: { seriesTmdbId_seasonNumber: { seriesTmdbId: FAKE_TV_ID, seasonNumber: 2 } },
    update: { episodeCount: 10 },
    create: { seriesTmdbId: FAKE_TV_ID, seasonNumber: 2, episodeCount: 10, airDate: new Date(RECENT) },
  });

  // Episodes S01E01–S01E10 and S02E01
  for (let ep = 1; ep <= 10; ep++) {
    await db.poplog3Episode.upsert({
      where: { seriesTmdbId_seasonNumber_episodeNumber: { seriesTmdbId: FAKE_TV_ID, seasonNumber: 1, episodeNumber: ep } },
      update: {},
      create: {
        seriesTmdbId: FAKE_TV_ID, seasonNumber: 1, episodeNumber: ep,
        name: `Episódio S01E${String(ep).padStart(2, "0")}`,
        stillPath: `/still-s01e${ep}.jpg`, airDate: new Date("2023-01-01"), runtime: 45,
      },
    });
  }
  await db.poplog3Episode.upsert({
    where: { seriesTmdbId_seasonNumber_episodeNumber: { seriesTmdbId: FAKE_TV_ID, seasonNumber: 2, episodeNumber: 1 } },
    update: {},
    create: {
      seriesTmdbId: FAKE_TV_ID, seasonNumber: 2, episodeNumber: 1,
      name: "Episódio S02E01", stillPath: "/still-s02e01.jpg", airDate: new Date(RECENT), runtime: 48,
    },
  });

  // User episodes: watched S01E01–S01E09 (9 watched, waiting S01E10)
  for (let ep = 1; ep <= 9; ep++) {
    await db.userEpisode.upsert({
      where: { userId_seriesTmdbId_seasonNumber_episodeNumber: { userId: SMOKE_USER, seriesTmdbId: FAKE_TV_ID, seasonNumber: 1, episodeNumber: ep } },
      update: {},
      create: { userId: SMOKE_USER, seriesTmdbId: FAKE_TV_ID, seasonNumber: 1, episodeNumber: ep, watchedAt: new Date(Date.now() - (10 - ep) * 86_400_000) },
    });
  }

  // User title state: watching, in_progress, next = S01E10
  await db.userTitleState.upsert({
    where: { userId_tmdbId_mediaType: { userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv" } },
    update: {},
    create: {
      userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv",
      status: "watching", computedState: "in_progress",
      watchedEpisodes: 9, airedEpisodes: 10,
      progressPct: 90, nextSeason: 1, nextEpisode: 10,
      nextEpisodeAirDate: new Date(RECENT),
      lastWatchedAt: new Date(Date.now() - 86_400_000),
      watchedKeys: ["S01E01","S01E02","S01E03","S01E04","S01E05","S01E06","S01E07","S01E08","S01E09"],
      bestProviderName: "Netflix", bestProviderType: "subscription",
      lastEventAt: new Date(),
    },
  });

  // Watchlist movie state
  await db.userTitleState.upsert({
    where: { userId_tmdbId_mediaType: { userId: SMOKE_USER, tmdbId: FAKE_MOVIE_ID, mediaType: "movie" } },
    update: {},
    create: {
      userId: SMOKE_USER, tmdbId: FAKE_MOVIE_ID, mediaType: "movie",
      status: "watchlist", computedState: "watchlist",
      watchedEpisodes: 0, airedEpisodes: 0, progressPct: 0,
      watchedKeys: [], bestProviderName: "Prime Video", bestProviderType: "subscription",
      lastEventAt: new Date(Date.now() - 15 * 86_400_000),
    },
  });

  // Title rating for the TV series
  await db.titleRating.upsert({
    where: { tmdbId_mediaType: { tmdbId: FAKE_TV_ID, mediaType: "tv" } },
    update: {},
    create: {
      tmdbId: FAKE_TV_ID, mediaType: "tv",
      imdbRating: 8.2, imdbVotes: 50000,
      rottenTomatoesScore: 88, metacriticScore: 75,
      sourcePayload: { Awards: "Won 3 Primetime Emmy Awards." },
    },
  });
}

async function cleanup() {
  await db.userEpisode.deleteMany({ where: { userId: SMOKE_USER } });
  await db.userTitleState.deleteMany({ where: { userId: SMOKE_USER } });
  await db.userTitle.deleteMany({ where: { userId: SMOKE_USER } });
  await db.poplog3Episode.deleteMany({ where: { seriesTmdbId: { in: [FAKE_TV_ID] } } });
  await db.titleSeason.deleteMany({ where: { seriesTmdbId: FAKE_TV_ID } });
  await db.poplog3Title.deleteMany({ where: { tmdbId: { in: [FAKE_TV_ID, FAKE_MOVIE_ID] } } });
  await db.titleRating.deleteMany({ where: { tmdbId: { in: [FAKE_TV_ID, FAKE_MOVIE_ID] } } });
  await db.user.deleteMany({ where: { id: SMOKE_USER } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Flag checks
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_CONTINUE_WATCHING_ENABLED = "false";
  assert("continueWatching flag off", getLocalDbFlagState().continueWatching === false);

  process.env.POPLOG_LOCAL_CONTINUE_WATCHING_ENABLED = "true";
  assert("continueWatching flag on", getLocalDbFlagState().continueWatching === true);

  process.env.POPLOG_LOCAL_RECENTLY_WATCHED_ENABLED = "true";
  assert("recentlyWatched flag on", getLocalDbFlagState().recentlyWatched === true);

  process.env.POPLOG_LOCAL_NEW_EPISODES_ENABLED = "true";
  assert("newEpisodes flag on", getLocalDbFlagState().newEpisodes === true);

  process.env.POPLOG_LOCAL_WATCHLIST_PICKS_ENABLED = "true";
  assert("watchlistPicks flag on", getLocalDbFlagState().watchlistPicks === true);

  // 2. Seed fake data
  console.log("\n[smoke:continuity] seeding fake data...");
  await seed();
  console.log("[smoke:continuity] seed ok");

  try {
    // 3. State rows
    const states = await getLocalContinuityStateRows(SMOKE_USER);
    assert("getLocalContinuityStateRows returns rows", states.length >= 1);

    const tvState = states.find((s) => s.tmdb_id === FAKE_TV_ID && s.media_type === "tv");
    assertValue("tv state exists", tvState);
    assert("tv state.status=watching", tvState?.status === "watching");
    assert("tv state.computed_state=in_progress", tvState?.computed_state === "in_progress");
    assert("tv state.watched_episodes=9", tvState?.watched_episodes === 9);
    assert("tv state.next_season=1", tvState?.next_season === 1);
    assert("tv state.next_episode=10", tvState?.next_episode === 10);
    assert("tv state.best_provider_name=Netflix", tvState?.best_provider_name === "Netflix");
    assert("tv state.last_event_at is string", typeof tvState?.last_event_at === "string");

    const movieState = states.find((s) => s.tmdb_id === FAKE_MOVIE_ID && s.media_type === "movie");
    assertValue("movie state exists", movieState);
    assert("movie state.status=watchlist", movieState?.status === "watchlist");

    // 4. Titles batch
    const titles = await getLocalTitlesBatch([FAKE_TV_ID, FAKE_MOVIE_ID]);
    assert("getLocalTitlesBatch returns 2", titles.length === 2);

    const tvTitle = titles.find((t) => t.tmdb_id === FAKE_TV_ID);
    assertValue("tv title exists", tvTitle);
    assert("tv title has poster_path", typeof tvTitle?.poster_path === "string");
    assert("tv title episode_run_time is array", Array.isArray(tvTitle?.episode_run_time));
    assert("tv title last_air_date is string", typeof tvTitle?.last_air_date === "string");

    const movieTitle = titles.find((t) => t.tmdb_id === FAKE_MOVIE_ID);
    assertValue("movie title exists", movieTitle);
    assert("movie title has runtime", movieTitle?.runtime === 110);

    // 5. Seasons batch
    const seasons = await getLocalSeasonsBatch([FAKE_TV_ID]);
    assert("getLocalSeasonsBatch returns 2 seasons", seasons.length === 2);

    const s1 = seasons.find((s) => s.season_number === 1);
    assertValue("season 1 exists", s1);
    assert("season 1 episode_count=10", s1?.episode_count === 10);

    // 6. Episodes batch
    const episodes = await getLocalEpisodesBatch([FAKE_TV_ID]);
    assert("getLocalEpisodesBatch returns 11 episodes", episodes.length === 11);

    const ep10 = episodes.find((e) => e.season_number === 1 && e.episode_number === 10);
    assertValue("S01E10 exists", ep10);
    assert("S01E10 has name", typeof ep10?.name === "string");
    assert("S01E10 has still_path", typeof ep10?.still_path === "string");
    assert("S01E10 has runtime", ep10?.runtime === 45);

    // continue watching: filter like the route does
    const continueStates = states.filter(
      (s) =>
        s.media_type === "tv" &&
        s.status === "watching" &&
        s.computed_state === "in_progress" &&
        (s.watched_episodes ?? 0) > 0 &&
        (s.next_season ?? 0) > 0 &&
        (s.next_episode ?? 0) > 0,
    );
    assert("continue watching: 1 eligible state", continueStates.length === 1);

    // 7. User episodes batch
    const userEps = await getLocalUserEpisodesBatch(SMOKE_USER, [FAKE_TV_ID]);
    assert("getLocalUserEpisodesBatch returns 9 episodes", userEps.length === 9);
    assert("user episode has series_tmdb_id", userEps[0]?.series_tmdb_id === FAKE_TV_ID);
    assert("user episode has watched_at", typeof userEps[0]?.watched_at === "string");

    // recently watched: last episode is S01E09
    const latestEp = userEps[0]; // ordered by watched_at desc
    assert("recently watched last ep has season", latestEp?.season_number === 1);
    assert("recently watched last ep has episode", latestEp?.episode_number === 9);

    // 8. Title ratings
    const ratings = await getLocalTitleRatingsBatch([FAKE_TV_ID]);
    assert("getLocalTitleRatingsBatch returns 1 rating", ratings.length === 1);

    const tvRating = ratings[0];
    assertValue("tv rating exists", tvRating);
    assert("tv rating imdb_rating=8.2", tvRating?.imdb_rating === 8.2);
    assert("tv rating rotten_tomatoes_score=88", tvRating?.rotten_tomatoes_score === 88);
    assert("tv rating source_payload is object", typeof tvRating?.source_payload === "object" && tvRating.source_payload !== null);
    assert("tv rating has Awards in source_payload", typeof (tvRating?.source_payload as Record<string, unknown>)?.Awards === "string");

    // watchlist picks: movie in watchlist
    const watchlistStates = states.filter((s) => s.status === "watchlist");
    assert("watchlist: 1 item in watchlist", watchlistStates.length >= 1);
    assert("watchlist: movie is in watchlist", watchlistStates.some((s) => s.tmdb_id === FAKE_MOVIE_ID));

    // new episodes: series with recent air date
    const newEpStates = states.filter((s) => s.media_type === "tv" && (s.status === "watching" || s.status === "watchlist"));
    assert("new episodes: 1 tv state eligible", newEpStates.length >= 1);
    assert("new episodes: has next_episode_air_date", typeof tvState?.next_episode_air_date === "string");

    console.log(`\n[smoke:continuity] passed=${passed} failed=${failed}`);
  } finally {
    console.log("\n[smoke:continuity] cleaning up...");
    await cleanup();
    console.log("[smoke:continuity] cleanup done");
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[smoke:continuity] fatal:", err);
  process.exit(1);
});
