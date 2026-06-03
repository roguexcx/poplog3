/**
 * Smoke test: Fase 7O — Radar/Agenda local
 *
 * Cria dados fake, chama os helpers locais e valida shape dos payloads.
 * Limpa tudo ao final.
 */
import "dotenv/config";
import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";
import {
  getLocalUserLibraryTmdbIds,
  getLocalUserLibraryIds,
  getLocalTitleAvailabilityBatch,
  getLocalAgendaStateBatch,
} from "@/server/local-services/continuity-local.service";

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`[smoke:radar-agenda] ✓ ${label}`);
    passed++;
  } else {
    console.error(`[smoke:radar-agenda] ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertValue<T>(label: string, value: T | null | undefined): void {
  assert(label, value !== null && value !== undefined, `got ${String(value)}`);
}

// ── Fake data ─────────────────────────────────────────────────────────────────

const BASE_ID = process.env.LOCAL_USER_ID?.trim() || "local-user";
const SMOKE_USER = `${BASE_ID}-radar-smoke`;
const FAKE_TV_ID = 987880001;
const FAKE_MOVIE_ID = 987880002;
const TODAY = new Date().toISOString().slice(0, 10);

async function seed() {
  await db.user.upsert({
    where: { id: SMOKE_USER },
    update: { updatedAt: new Date() },
    create: { id: SMOKE_USER, email: "radar-smoke@poplog.dev", name: "Radar Smoke" },
  });

  // Titles
  await db.poplog3Title.upsert({
    where: { tmdbId_mediaType: { tmdbId: FAKE_TV_ID, mediaType: "tv" } },
    update: { title: "Radar Smoke TV" },
    create: {
      tmdbId: FAKE_TV_ID, mediaType: "tv", title: "Radar Smoke TV",
      posterPath: "/poster-r.jpg", backdropPath: "/backdrop-r.jpg",
      firstAirDate: new Date("2024-01-01"), lastAirDate: new Date(TODAY),
      episodeRunTime: [45], numberOfSeasons: 1, numberOfEpisodes: 10,
    },
  });
  await db.poplog3Title.upsert({
    where: { tmdbId_mediaType: { tmdbId: FAKE_MOVIE_ID, mediaType: "movie" } },
    update: { title: "Radar Smoke Movie" },
    create: {
      tmdbId: FAKE_MOVIE_ID, mediaType: "movie", title: "Radar Smoke Movie",
      posterPath: "/poster-rm.jpg", backdropPath: "/backdrop-rm.jpg",
      releaseDate: new Date("2024-06-01"), runtime: 95,
    },
  });

  // Episodes with air dates
  await db.poplog3Episode.upsert({
    where: { seriesTmdbId_seasonNumber_episodeNumber: { seriesTmdbId: FAKE_TV_ID, seasonNumber: 1, episodeNumber: 1 } },
    update: {},
    create: { seriesTmdbId: FAKE_TV_ID, seasonNumber: 1, episodeNumber: 1, name: "Piloto", airDate: new Date(TODAY), runtime: 45 },
  });

  // User library entries (user_titles + user_title_state)
  await db.userTitle.upsert({
    where: { userId_tmdbId_mediaType: { userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv" } },
    update: {},
    create: { userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv", status: "watching" },
  });
  await db.userTitle.upsert({
    where: { userId_tmdbId_mediaType: { userId: SMOKE_USER, tmdbId: FAKE_MOVIE_ID, mediaType: "movie" } },
    update: {},
    create: { userId: SMOKE_USER, tmdbId: FAKE_MOVIE_ID, mediaType: "movie", status: "watchlist" },
  });

  // User title state (for radar personal filter)
  await db.userTitleState.upsert({
    where: { userId_tmdbId_mediaType: { userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv" } },
    update: {},
    create: {
      userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv",
      status: "watching", computedState: "in_progress",
      watchedEpisodes: 0, airedEpisodes: 1, progressPct: 0,
      watchedKeys: [], bestProviderName: "Netflix", bestProviderType: "subscription",
      lastEventAt: new Date(),
    },
  });
  await db.userTitleState.upsert({
    where: { userId_tmdbId_mediaType: { userId: SMOKE_USER, tmdbId: FAKE_MOVIE_ID, mediaType: "movie" } },
    update: {},
    create: {
      userId: SMOKE_USER, tmdbId: FAKE_MOVIE_ID, mediaType: "movie",
      status: "watchlist", computedState: "watchlist",
      watchedEpisodes: 0, airedEpisodes: 0, progressPct: 0,
      watchedKeys: [], bestProviderName: "Prime Video", bestProviderType: "subscription",
      lastEventAt: new Date(Date.now() - 10 * 86_400_000),
    },
  });

  // Availability (for agenda enrichment)
  // Using poplog3_title_availability — needs a provider entry; we use a simple insert
  await db.poplog3TitleAvailability.deleteMany({ where: { tmdbId: { in: [FAKE_TV_ID, FAKE_MOVIE_ID] } } });
  await db.poplog3TitleAvailability.create({
    data: {
      tmdbId: FAKE_TV_ID, mediaType: "tv", country: "BR",
      providerName: "Netflix", availabilityType: "streaming",
      source: "tmdb", tmdbProviderId: 8,
    },
  });
  await db.poplog3TitleAvailability.create({
    data: {
      tmdbId: FAKE_MOVIE_ID, mediaType: "movie", country: "BR",
      providerName: "Prime Video", availabilityType: "streaming",
      source: "tmdb", tmdbProviderId: 9,
    },
  });
}

async function cleanup() {
  await db.poplog3TitleAvailability.deleteMany({ where: { tmdbId: { in: [FAKE_TV_ID, FAKE_MOVIE_ID] } } });
  await db.userTitleState.deleteMany({ where: { userId: SMOKE_USER } });
  await db.userTitle.deleteMany({ where: { userId: SMOKE_USER } });
  await db.poplog3Episode.deleteMany({ where: { seriesTmdbId: FAKE_TV_ID } });
  await db.poplog3Title.deleteMany({ where: { tmdbId: { in: [FAKE_TV_ID, FAKE_MOVIE_ID] } } });
  await db.user.deleteMany({ where: { id: SMOKE_USER } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Flags
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_RADAR_ENABLED = "false";
  assert("radar flag off", getLocalDbFlagState().radar === false);

  process.env.POPLOG_LOCAL_RADAR_ENABLED = "true";
  assert("radar flag on", getLocalDbFlagState().radar === true);

  process.env.POPLOG_LOCAL_AGENDA_ENABLED = "false";
  assert("agenda flag off", getLocalDbFlagState().agenda === false);

  process.env.POPLOG_LOCAL_AGENDA_ENABLED = "true";
  assert("agenda flag on", getLocalDbFlagState().agenda === true);

  // 2. Seed
  console.log("\n[smoke:radar-agenda] seeding...");
  await seed();
  console.log("[smoke:radar-agenda] seed ok");

  try {
    // 3. Radar: library tmdb_ids
    const { tvIds, movieIds } = await getLocalUserLibraryTmdbIds(SMOKE_USER);
    assert("getLocalUserLibraryTmdbIds: has tv", tvIds.size >= 1);
    assert("getLocalUserLibraryTmdbIds: has movie", movieIds.size >= 1);
    assert("getLocalUserLibraryTmdbIds: tv contains FAKE_TV_ID", tvIds.has(FAKE_TV_ID));
    assert("getLocalUserLibraryTmdbIds: movie contains FAKE_MOVIE_ID", movieIds.has(FAKE_MOVIE_ID));

    // 4. Agenda: library ids map
    const libraryIds = await getLocalUserLibraryIds(SMOKE_USER);
    assertValue("getLocalUserLibraryIds: has entries", Object.keys(libraryIds).length > 0);
    assert("libraryIds has tv entry", `tv-${FAKE_TV_ID}` in libraryIds);
    assert("libraryIds tv status=watching", libraryIds[`tv-${FAKE_TV_ID}`] === "watching");
    assert("libraryIds has movie entry", `movie-${FAKE_MOVIE_ID}` in libraryIds);
    assert("libraryIds movie status=watchlist", libraryIds[`movie-${FAKE_MOVIE_ID}`] === "watchlist");

    // 5. Agenda: availability batch
    const availability = await getLocalTitleAvailabilityBatch([FAKE_MOVIE_ID], [FAKE_TV_ID], "BR");
    assert("getLocalTitleAvailabilityBatch returns 2 rows", availability.length === 2);

    const tvAvail = availability.find((a) => a.tmdb_id === FAKE_TV_ID);
    assertValue("tv availability exists", tvAvail);
    assert("tv availability provider=Netflix", tvAvail?.provider_name === "Netflix");
    assert("tv availability type=streaming", tvAvail?.availability_type === "streaming");
    assert("tv availability tmdb_provider_id=8", tvAvail?.tmdb_provider_id === 8);

    const movieAvail = availability.find((a) => a.tmdb_id === FAKE_MOVIE_ID);
    assertValue("movie availability exists", movieAvail);
    assert("movie availability provider=Prime Video", movieAvail?.provider_name === "Prime Video");

    // 6. Agenda: user state batch
    const states = await getLocalAgendaStateBatch(SMOKE_USER, [FAKE_MOVIE_ID], [FAKE_TV_ID]);
    assert("getLocalAgendaStateBatch returns 2 rows", states.length === 2);

    const tvState = states.find((s) => s.tmdb_id === FAKE_TV_ID);
    assertValue("tv state exists", tvState);
    assert("tv state.status=watching", tvState?.status === "watching");
    assert("tv state.best_provider_name=Netflix", tvState?.best_provider_name === "Netflix");

    const movieState = states.find((s) => s.tmdb_id === FAKE_MOVIE_ID);
    assertValue("movie state exists", movieState);
    assert("movie state.status=watchlist", movieState?.status === "watchlist");
    assert("movie state.best_provider_name=Prime Video", movieState?.best_provider_name === "Prime Video");

    // 7. Payload shapes match contracts
    assert("libraryIds values are strings", Object.values(libraryIds).every((v) => typeof v === "string"));
    assert("availability has all required fields", availability.every(
      (a) => typeof a.tmdb_id === "number" && typeof a.provider_name === "string" && typeof a.availability_type === "string",
    ));
    assert("states have all required fields", states.every(
      (s) => typeof s.tmdb_id === "number" && "status" in s && "best_provider_name" in s,
    ));

    console.log(`\n[smoke:radar-agenda] passed=${passed} failed=${failed}`);
  } finally {
    console.log("\n[smoke:radar-agenda] cleaning up...");
    await cleanup();
    console.log("[smoke:radar-agenda] cleanup done");
  }

  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("[smoke:radar-agenda] fatal:", err);
  process.exit(1);
});
