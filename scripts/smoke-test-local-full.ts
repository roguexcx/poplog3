/**
 * Smoke test: Fase 9 — Local Full Mode
 *
 * Valida que todos os módulos locais funcionam em conjunto sem Supabase.
 * Define todas as flags como true antes de importar os serviços.
 * Cria dados de smoke, chama cada módulo, verifica resultado e limpa ao final.
 */
import "dotenv/config";

// ── Ativar todas as flags locais antes de qualquer import de serviço ────────────
process.env.POPLOG_LOCAL_AUTH_ENABLED = "true";
process.env.POPLOG_LOCAL_DB_ENABLED = "true";
process.env.POPLOG_LOCAL_LOGS_ENABLED = "true";
process.env.POPLOG_LOCAL_CACHE_ENABLED = "true";
process.env.POPLOG_LOCAL_API_USAGE_ENABLED = "true";
process.env.POPLOG_LOCAL_AVAILABILITY_ENABLED = "true";
process.env.POPLOG_LOCAL_LIBRARY_ENABLED = "true";
process.env.POPLOG_LOCAL_USER_STATE_ENABLED = "true";
process.env.POPLOG_LOCAL_EPISODE_PROGRESS_ENABLED = "true";
process.env.POPLOG_LOCAL_USER_RATINGS_ENABLED = "true";
process.env.POPLOG_LOCAL_FEEDBACK_ENABLED = "true";
process.env.POPLOG_LOCAL_USER_PREFERENCES_ENABLED = "true";
process.env.POPLOG_LOCAL_STREAMING_PREFERENCES_ENABLED = "true";
process.env.POPLOG_LOCAL_CURADORIA_ENABLED = "true";
process.env.POPLOG_LOCAL_CURADORIA_STATE_ENABLED = "true";
process.env.POPLOG_LOCAL_ACOMPANHANDO_ENABLED = "true";
process.env.POPLOG_LOCAL_HERO_ENABLED = "true";
process.env.POPLOG_LOCAL_CONTINUE_WATCHING_ENABLED = "true";
process.env.POPLOG_LOCAL_RECENTLY_WATCHED_ENABLED = "true";
process.env.POPLOG_LOCAL_NEW_EPISODES_ENABLED = "true";
process.env.POPLOG_LOCAL_WATCHLIST_PICKS_ENABLED = "true";
process.env.POPLOG_LOCAL_RADAR_ENABLED = "true";
process.env.POPLOG_LOCAL_AGENDA_ENABLED = "true";

import { db } from "@/server/db/client";
import { getLocalDbFlagState, isLocalAuthEnabled } from "@/server/runtime/local-db-flags";
import { getLocalAuthUser, getLocalUserId } from "@/server/auth/local-user";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserLibrary } from "@/server/library/library-service";
import { getUserTitleStates } from "@/server/state/user-title-state";
import { getUserRatingsBatch } from "@/server/ratings/user-rating-service";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import {
  getLocalContinuityStateRows,
  getLocalUserLibraryTmdbIds,
  getLocalAgendaStateBatch,
} from "@/server/local-services/continuity-local.service";

// ── Helpers ────────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`[smoke:local-full] ✓ ${label}`);
    passed++;
  } else {
    console.error(`[smoke:local-full] ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
}

function assertValue<T>(label: string, value: T | null | undefined): void {
  assert(label, value !== null && value !== undefined, `got ${String(value)}`);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

const SMOKE_SUFFIX = "-full-smoke";
const BASE_ID = process.env.LOCAL_USER_ID?.trim() || "local-user";
const SMOKE_USER = `${BASE_ID}${SMOKE_SUFFIX}`;
const FAKE_TV_ID = 987990001;
const FAKE_MOVIE_ID = 987990002;

async function seed() {
  await db.user.upsert({
    where: { id: SMOKE_USER },
    update: { updatedAt: new Date() },
    create: { id: SMOKE_USER, email: `${SMOKE_USER}@poplog.dev`, name: "Full Smoke User" },
  });

  for (const [tmdbId, mediaType] of [[FAKE_TV_ID, "tv"], [FAKE_MOVIE_ID, "movie"]] as const) {
    await db.poplog3Title.upsert({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
      update: { title: `Full Smoke ${mediaType}` },
      create: {
        tmdbId, mediaType,
        title: `Full Smoke ${mediaType}`,
        posterPath: `/poster-fs-${tmdbId}.jpg`,
      },
    });
  }

  await db.userTitle.upsert({
    where: { userId_tmdbId_mediaType: { userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv" } },
    update: { status: "watching" },
    create: { userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv", status: "watching" },
  });

  await db.userTitleState.upsert({
    where: { userId_tmdbId_mediaType: { userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv" } },
    update: { status: "watching", watchedEpisodes: 3 },
    create: {
      userId: SMOKE_USER, tmdbId: FAKE_TV_ID, mediaType: "tv",
      status: "watching", computedState: "in_progress",
      watchedEpisodes: 3, airedEpisodes: 10, totalEpisodes: 20,
      progressPct: 30, lastEventAt: new Date(), watchedKeys: [],
    },
  });
}

async function cleanup() {
  await db.userTitleState.deleteMany({ where: { userId: SMOKE_USER } });
  await db.userTitle.deleteMany({ where: { userId: SMOKE_USER } });
  await db.userTitle.deleteMany({ where: { userId: SMOKE_USER } });
  await db.userRating.deleteMany({ where: { userId: SMOKE_USER } });
  await db.userTitleFeedback.deleteMany({ where: { userId: SMOKE_USER } });
  await db.user.deleteMany({ where: { id: { endsWith: SMOKE_SUFFIX } } });
}

// ── Testes ────────────────────────────────────────────────────────────────────

async function testAllFlagsEnabled() {
  const flags = getLocalDbFlagState();

  const expected: (keyof ReturnType<typeof getLocalDbFlagState>)[] = [
    "localDb", "logs", "cache", "apiUsage", "availability", "library",
    "userState", "episodeProgress", "userRatings", "feedback",
    "userPreferences", "streamingPreferences", "curadoria", "curadoriaState", "acompanhando",
    "hero", "continueWatching", "recentlyWatched", "newEpisodes",
    "watchlistPicks", "radar", "agenda",
  ];

  for (const key of expected) {
    assert(`flag ${key} habilitada`, flags[key] === true);
  }

  assert("isLocalAuthEnabled() retorna true", isLocalAuthEnabled());
}

async function testLocalAuth() {
  // getCurrentUser() deve usar Prisma, não Supabase
  process.env.LOCAL_USER_ID = SMOKE_USER;
  const user = await getCurrentUser();
  assertValue("getCurrentUser() retorna usuário com local auth ON", user);
  assert("getCurrentUser() retorna id correto", user?.id === SMOKE_USER, `got: ${user?.id}`);
  process.env.LOCAL_USER_ID = BASE_ID;
}

async function testGetLocalAuthUserDirect() {
  const origId = process.env.LOCAL_USER_ID;
  process.env.LOCAL_USER_ID = SMOKE_USER;
  const user = await getLocalAuthUser();
  assertValue("getLocalAuthUser() retorna smoke user", user);
  assert("getLocalAuthUser() id correto", user?.id === SMOKE_USER, `got: ${user?.id}`);
  process.env.LOCAL_USER_ID = origId ?? BASE_ID;
}

async function testLibrary() {
  const library = await getUserLibrary(SMOKE_USER);
  assert("getUserLibrary() retorna array", Array.isArray(library));
  const tv = library.find((i) => i.tmdb_id === FAKE_TV_ID);
  assertValue("getUserLibrary() contém o título de smoke", tv);
}

async function testUserTitleState() {
  const states = await getUserTitleStates(SMOKE_USER);
  assert("getUserTitleStates() retorna array", Array.isArray(states));
  const tv = states.find((s) => s.tmdb_id === FAKE_TV_ID);
  assertValue("getUserTitleStates() contém estado de smoke", tv);
  assert("estado de smoke tem watched_episodes correto", tv?.watched_episodes === 3, `got: ${tv?.watched_episodes}`);
}

async function testUserRatings() {
  // getUserRatingsBatch retorna Map — sem dados seeded, retorna Map vazio
  const ratings = await getUserRatingsBatch(SMOKE_USER, [
    { mediaType: "tv", tmdbId: FAKE_TV_ID },
  ]);
  assert("getUserRatingsBatch() retorna Map", ratings instanceof Map);
}

async function testFeedback() {
  const feedbackMap = await getUserFeedbackMap(SMOKE_USER);
  assert("getUserFeedbackMap() retorna Map", feedbackMap instanceof Map);
  assert("getUserFeedbackMap() não lança sem Supabase", true);
}

async function testContinuityStateRows() {
  const rows = await getLocalContinuityStateRows(SMOKE_USER);
  assert("getLocalContinuityStateRows() retorna array", Array.isArray(rows));
  const tv = rows.find((r) => r.tmdb_id === FAKE_TV_ID);
  assertValue("getLocalContinuityStateRows() contém estado de smoke", tv);
}

async function testLocalUserLibraryTmdbIds() {
  const { tvIds, movieIds } = await getLocalUserLibraryTmdbIds(SMOKE_USER);
  assert("getLocalUserLibraryTmdbIds() retorna tvIds como Set", tvIds instanceof Set);
  assert("getLocalUserLibraryTmdbIds() retorna movieIds como Set", movieIds instanceof Set);
  assert("tvIds contém FAKE_TV_ID", tvIds.has(FAKE_TV_ID), `tvIds: ${[...tvIds].join(",")}`);
}

async function testLocalAgendaStateBatch() {
  const states = await getLocalAgendaStateBatch(SMOKE_USER, [FAKE_TV_ID], [FAKE_MOVIE_ID]);
  assert("getLocalAgendaStateBatch() retorna array", Array.isArray(states));
}

async function testLocalFullModeNoSupabaseRequired() {
  // Verificar que getCurrentUser não depende de Supabase quando flag ON
  const origUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = "";
  process.env.LOCAL_USER_ID = SMOKE_USER;

  try {
    const user = await getCurrentUser();
    assert("getCurrentUser() funciona sem SUPABASE_URL quando local auth ON", user !== null);
    assert("id retornado sem Supabase", user?.id === SMOKE_USER, `got: ${user?.id}`);
  } catch (err) {
    assert("getCurrentUser() sem Supabase não lança exceção", false, String(err));
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_URL = origUrl ?? "";
    process.env.LOCAL_USER_ID = BASE_ID;
  }
}

async function testGetLocalUserId() {
  const id = getLocalUserId();
  assert("getLocalUserId() retorna string não vazia", typeof id === "string" && id.length > 0);
}

// ── Runner ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n[smoke:local-full] Iniciando smoke test — Fase 9 Local Full Mode\n");

  try {
    await seed();

    await testAllFlagsEnabled();
    await testGetLocalUserId();
    await testLocalAuth();
    await testGetLocalAuthUserDirect();
    await testLibrary();
    await testUserTitleState();
    await testUserRatings();
    await testFeedback();
    await testContinuityStateRows();
    await testLocalUserLibraryTmdbIds();
    await testLocalAgendaStateBatch();
    await testLocalFullModeNoSupabaseRequired();
  } finally {
    await cleanup();
    await db.$disconnect();
  }

  console.log(`\n[smoke:local-full] Resultado: ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("[smoke:local-full] Erro fatal:", err);
  process.exitCode = 1;
});
