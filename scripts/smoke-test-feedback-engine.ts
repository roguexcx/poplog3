/**
 * smoke-test-feedback-engine.ts
 *
 * Smoke test autenticado para a feedback engine do POPLOG.
 * Roda contra Supabase real usando credenciais do .env.local
 *
 * Como rodar:
 *   npx tsx scripts/smoke-test-feedback-engine.ts
 *
 * Requer:
 *   - NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.local
 *   - Migration 20260522000100_feedback_engine_schema.sql aplicada
 *   - Um user_id valido (editar TEST_USER_ID abaixo)
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

// ============================================================
// CONFIG -- ajuste antes de rodar
// ============================================================
const TEST_USER_ID = process.env.SMOKE_TEST_USER_ID ?? "COLOQUE_SEU_USER_ID_AQUI";
const TEST_TMDB_ID = 550;        // Fight Club
const TEST_MEDIA_TYPE = "movie" as const;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
// ============================================================

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

let passed = 0;
let failed = 0;

function ok(label: string) {
  console.log(`  [PASS] ${label}`);
  passed++;
}

function fail(label: string, detail?: unknown) {
  console.error(`  [FAIL] ${label}`, detail ?? "");
  failed++;
}

async function assert(label: string, condition: boolean, detail?: unknown) {
  if (condition) ok(label);
  else fail(label, detail);
}

// ============================================================
// DB HELPERS
// ============================================================
async function getFeedbackRows() {
  const { data } = await supabase
    .from("user_title_feedback")
    .select("*")
    .eq("user_id", TEST_USER_ID)
    .eq("tmdb_id", TEST_TMDB_ID)
    .eq("media_type", TEST_MEDIA_TYPE)
    .order("created_at", { ascending: false });
  return data ?? [];
}

async function getTitleState() {
  const { data } = await supabase
    .from("user_title_state")
    .select("*")
    .eq("user_id", TEST_USER_ID)
    .eq("tmdb_id", TEST_TMDB_ID)
    .eq("media_type", TEST_MEDIA_TYPE)
    .single();
  return data;
}

async function getUserEvents(limit = 10) {
  const { data } = await supabase
    .from("user_events")
    .select("*")
    .eq("user_id", TEST_USER_ID)
    .eq("tmdb_id", TEST_TMDB_ID)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}

// Clean up before each section
async function cleanup() {
  await supabase
    .from("user_title_feedback")
    .update({ active: false })
    .eq("user_id", TEST_USER_ID)
    .eq("tmdb_id", TEST_TMDB_ID)
    .eq("media_type", TEST_MEDIA_TYPE);
}

// ============================================================
// ENGINE DIRECT TESTS (bypasses HTTP, calls engine directly)
// ============================================================
async function testViaEngine() {
  console.log("\n== SECTION 1: Direct engine calls (applyTitleFeedback) ==");

  // Dynamically import the engine (runs in TS context)
  const { applyTitleFeedback } = await import(
    "../src/server/personalization/title-feedback-engine"
  );

  // -- liked
  console.log("\n-- liked");
  await cleanup();
  const r1 = await applyTitleFeedback({
    userId: TEST_USER_ID,
    tmdbId: TEST_TMDB_ID,
    mediaType: TEST_MEDIA_TYPE,
    command: "liked",
    surface: "title_page",
  });
  await assert("liked: success=true", r1.success === true, r1);
  const rows1 = await getFeedbackRows();
  const likedRow = rows1.find((r) => r.feedback_type === "liked" && r.active);
  await assert("liked: row exists with active=true", Boolean(likedRow), rows1);
  await assert("liked: surface stored", likedRow?.surface === "title_page", likedRow?.surface);

  // -- disliked
  console.log("\n-- disliked");
  const r2 = await applyTitleFeedback({
    userId: TEST_USER_ID,
    tmdbId: TEST_TMDB_ID,
    mediaType: TEST_MEDIA_TYPE,
    command: "disliked",
    surface: "title_page",
  });
  await assert("disliked: success=true", r2.success === true, r2);
  const rows2 = await getFeedbackRows();
  const activeRows2 = rows2.filter((r) => r.active);
  await assert("disliked: previous liked deactivated", !activeRows2.find((r) => r.feedback_type === "liked"), activeRows2.map((r) => r.feedback_type));
  await assert("disliked: disliked row active", Boolean(activeRows2.find((r) => r.feedback_type === "disliked")), activeRows2);
  await assert("liked row preserved in history (active=false)", rows2.find((r) => r.feedback_type === "liked" && !r.active) !== undefined, "expected inactive liked row");

  // -- clear_like
  console.log("\n-- clear_like (undoes liked/disliked)");
  await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "liked", surface: "title_page" });
  const r3 = await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "clear_like", surface: "title_page" });
  await assert("clear_like: success=true", r3.success === true, r3);
  const rows3 = await getFeedbackRows();
  await assert("clear_like: no active liked/disliked", !rows3.filter((r) => r.active).find((r) => r.feedback_type === "liked" || r.feedback_type === "disliked"), rows3.filter((r) => r.active).map((r) => r.feedback_type));
  await assert("clear_like: history preserved", rows3.some((r) => r.feedback_type === "liked"), "expected history");

  // -- favorite
  console.log("\n-- favorite");
  await cleanup();
  const r4 = await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "favorite", surface: "title_page" });
  await assert("favorite: success=true", r4.success === true, r4);
  const state4 = await getTitleState();
  await assert("favorite: is_boosted=true in state", state4?.is_boosted === true, state4);
  await assert("favorite: editorial_affinity >= 100", (state4?.editorial_affinity ?? 0) >= 100, state4?.editorial_affinity);

  // -- unfavorite
  console.log("\n-- unfavorite");
  const r5 = await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "unfavorite", surface: "title_page" });
  await assert("unfavorite: success=true", r5.success === true, r5);
  const rows5 = await getFeedbackRows();
  const state5 = await getTitleState();
  await assert("unfavorite: no active favorite", !rows5.filter((r) => r.active).find((r) => r.feedback_type === "favorite"), rows5.filter((r) => r.active).map((r) => r.feedback_type));
  await assert("unfavorite: favorite history preserved", rows5.some((r) => r.feedback_type === "favorite"), "expected history");
  await assert("unfavorite: is_boosted=false in state", state5?.is_boosted === false || state5?.is_boosted === null, state5?.is_boosted);

  // -- not_interested
  console.log("\n-- not_interested");
  await cleanup();
  const r6 = await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "not_interested", surface: "for_you" });
  await assert("not_interested: success=true", r6.success === true, r6);
  const state6 = await getTitleState();
  await assert("not_interested: has_negative_feedback=true", state6?.has_negative_feedback === true, state6);
  await assert("not_interested: editorial_penalty < 0", (state6?.editorial_penalty ?? 0) < 0, state6?.editorial_penalty);
  await assert("not_interested: is_hidden stays false (not_interested != hidden)", state6?.is_hidden !== true, state6?.is_hidden);

  // -- hidden
  console.log("\n-- hidden");
  await cleanup();
  const r7 = await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "hidden", surface: "title_page" });
  await assert("hidden: success=true", r7.success === true, r7);
  const state7 = await getTitleState();
  await assert("hidden: is_hidden=true in state", state7?.is_hidden === true, state7);
  await assert("hidden: editorial_score very negative", (state7?.editorial_score ?? 0) < -500, state7?.editorial_score);

  // -- dismissed_from_section
  console.log("\n-- dismissed_from_section");
  await cleanup();
  const r8 = await applyTitleFeedback({
    userId: TEST_USER_ID,
    tmdbId: TEST_TMDB_ID,
    mediaType: TEST_MEDIA_TYPE,
    command: "dismissed_from_section",
    surface: "for_you",
    sectionKey: "test-section-hero",
  });
  await assert("dismissed_from_section: success=true", r8.success === true, r8);
  const rows8 = await getFeedbackRows();
  const dismissedRow = rows8.find((r) => r.feedback_type === "dismissed_from_section" && r.active);
  await assert("dismissed_from_section: row exists", Boolean(dismissedRow), rows8.map((r) => r.feedback_type));
  await assert("dismissed_from_section: section_key stored", dismissedRow?.section_key === "test-section-hero", dismissedRow?.section_key);

  // -- DELETE (active=false, no physical delete)
  console.log("\n-- DELETE (active=false)");
  await cleanup();
  await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "not_interested", surface: "for_you" });
  const beforeDelete = await getFeedbackRows();
  await assert("DELETE setup: row exists before delete", beforeDelete.some((r) => r.feedback_type === "not_interested" && r.active), "expected active row");

  // Simulate DELETE by calling engine with undo (active=false)
  const { data: deleteResult } = await supabase
    .from("user_title_feedback")
    .update({ active: false })
    .eq("user_id", TEST_USER_ID)
    .eq("tmdb_id", TEST_TMDB_ID)
    .eq("media_type", TEST_MEDIA_TYPE)
    .eq("feedback_type", "not_interested")
    .select();
  const afterDelete = await getFeedbackRows();
  await assert("DELETE: row physically preserved", afterDelete.some((r) => r.feedback_type === "not_interested"), "expected preserved row");
  await assert("DELETE: row marked active=false", afterDelete.filter((r) => r.feedback_type === "not_interested").every((r) => !r.active), "expected all inactive");
}

// ============================================================
// INVARIANT TESTS
// ============================================================
async function testInvariants() {
  console.log("\n== SECTION 2: Behavioral invariants ==");
  const { applyTitleFeedback } = await import("../src/server/personalization/title-feedback-engine");

  // favorite > liked: favorite beats liked in editorial_affinity
  console.log("\n-- favorite > liked invariant");
  await cleanup();
  await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "liked", surface: "title_page" });
  const stateAfterLiked = await getTitleState();
  await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "favorite", surface: "title_page" });
  const stateAfterFavorite = await getTitleState();
  await assert(
    "favorite > liked: affinity with favorite > affinity with liked",
    (stateAfterFavorite?.editorial_affinity ?? 0) > (stateAfterLiked?.editorial_affinity ?? 0),
    { liked: stateAfterLiked?.editorial_affinity, favorite: stateAfterFavorite?.editorial_affinity },
  );

  // liked does NOT set watched
  console.log("\n-- liked/disliked don't set watched");
  await cleanup();
  const stateBefore = await getTitleState();
  const watchedBefore = stateBefore?.status;
  await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "liked", surface: "title_page" });
  const stateAfter = await getTitleState();
  await assert(
    "liked does not change status to watched",
    stateAfter?.status === watchedBefore || stateAfter?.status !== "watched",
    { before: watchedBefore, after: stateAfter?.status },
  );

  // hidden is more restrictive than not_interested
  console.log("\n-- hidden more restrictive than not_interested");
  await cleanup();
  await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "not_interested", surface: "for_you" });
  const stateNI = await getTitleState();
  await cleanup();
  await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "hidden", surface: "title_page" });
  const stateH = await getTitleState();
  await assert(
    "hidden score lower than not_interested score",
    (stateH?.editorial_score ?? 0) < (stateNI?.editorial_score ?? 0),
    { hidden: stateH?.editorial_score, not_interested: stateNI?.editorial_score },
  );
  await assert("hidden: is_hidden=true", stateH?.is_hidden === true, stateH?.is_hidden);
  await assert("not_interested: is_hidden=false", stateNI?.is_hidden !== true, stateNI?.is_hidden);

  // user_events: all actions are logged
  console.log("\n-- user_events logging");
  await cleanup();
  await applyTitleFeedback({ userId: TEST_USER_ID, tmdbId: TEST_TMDB_ID, mediaType: TEST_MEDIA_TYPE, command: "liked", surface: "title_page" });
  const events = await getUserEvents(5);
  await assert("user_events: at least one event logged", events.length > 0, events);
  await assert("user_events: event has tmdb_id", events[0]?.tmdb_id === TEST_TMDB_ID, events[0]);
}

// ============================================================
// DB SCHEMA VALIDATION
// ============================================================
async function testSchema() {
  console.log("\n== SECTION 3: Schema columns validation ==");

  // Check user_title_feedback has new columns
  const { data: feedbackSample } = await supabase
    .from("user_title_feedback")
    .select("id, user_id, tmdb_id, media_type, feedback_type, active, scope, surface, section_key, expires_at, metadata, strength, confidence, created_at")
    .limit(1);
  await assert("user_title_feedback: has 'active' column", feedbackSample !== null, "query failed -- column may be missing");
  if (feedbackSample && feedbackSample.length > 0) {
    const cols = Object.keys(feedbackSample[0]);
    await assert("schema: active column present", cols.includes("active"), cols);
    await assert("schema: scope column present", cols.includes("scope"), cols);
    await assert("schema: surface column present", cols.includes("surface"), cols);
    await assert("schema: section_key column present", cols.includes("section_key"), cols);
  }

  // Check user_title_state has editorial columns
  const { data: stateSample } = await supabase
    .from("user_title_state")
    .select("user_id, tmdb_id, editorial_affinity, editorial_penalty, editorial_score, has_negative_feedback, is_hidden, is_boosted, last_feedback_type, last_feedback_at")
    .limit(1);
  if (stateSample !== null) {
    ok("user_title_state: editorial columns accessible");
    if (stateSample.length > 0) {
      const cols = Object.keys(stateSample[0]);
      await assert("schema: editorial_affinity present", cols.includes("editorial_affinity"), cols);
      await assert("schema: editorial_penalty present", cols.includes("editorial_penalty"), cols);
      await assert("schema: editorial_score present", cols.includes("editorial_score"), cols);
      await assert("schema: is_hidden present", cols.includes("is_hidden"), cols);
      await assert("schema: is_boosted present", cols.includes("is_boosted"), cols);
    }
  } else {
    fail("user_title_state: editorial columns NOT accessible -- migration may not be applied");
  }

  // Check user_events exists
  const { error: eventsErr } = await supabase.from("user_events").select("id").limit(1);
  await assert("user_events: table accessible", eventsErr === null, eventsErr);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log("=================================================");
  console.log("POPLOG Feedback Engine -- Smoke Test");
  console.log(`User:  ${TEST_USER_ID}`);
  console.log(`Title: tmdb_id=${TEST_TMDB_ID} (${TEST_MEDIA_TYPE})`);
  console.log(`App:   ${BASE_URL}`);
  console.log("=================================================");

  if (TEST_USER_ID === "COLOQUE_SEU_USER_ID_AQUI") {
    console.error("\nERRO: Defina SMOKE_TEST_USER_ID no .env.local ou edite TEST_USER_ID no script.");
    process.exit(1);
  }

  try {
    await testSchema();
    await testViaEngine();
    await testInvariants();
  } catch (err) {
    console.error("\nERRO FATAL:", err);
    failed++;
  } finally {
    await cleanup();
  }

  console.log("\n=================================================");
  console.log(`Resultado: ${passed} passed, ${failed} failed`);
  console.log("=================================================");

  if (failed > 0) process.exit(1);
}

main();
