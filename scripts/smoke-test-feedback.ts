import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:feedback] ${label}: ok`);
  return value;
}

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:feedback] ${label}: ok`);
}

async function main() {
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_FEEDBACK_ENABLED = "false";
  await assertEqual("flag off", getLocalDbFlagState().feedback, false);

  process.env.POPLOG_LOCAL_FEEDBACK_ENABLED = "true";
  await assertEqual("flag on", getLocalDbFlagState().feedback, true);

  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${localUserId}-feedback-smoke`;
  const tmdbId = 987659001;

  const [
    feedbackEngine,
    feedbackHelpers,
  ] = await Promise.all([
    import("@/server/personalization/title-feedback-engine"),
    import("@/lib/personalization/feedback"),
  ]);

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "feedback-smoke@poplog.dev",
      name: "POPLOG Feedback Smoke User",
    },
  });

  try {
    await feedbackEngine.applyTitleFeedback({
      userId: smokeUserId,
      tmdbId,
      mediaType: "movie",
      command: "liked",
      source: "feedback-smoke",
      surface: "title_page",
    });
    let state = await assertValue(
      "state after liked",
      await db.userTitleState.findUnique({
        where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId, mediaType: "movie" } },
      }),
    );
    await assertEqual("liked materialized", state.liked, true);

    await feedbackEngine.applyTitleFeedback({
      userId: smokeUserId,
      tmdbId,
      mediaType: "movie",
      command: "disliked",
      source: "feedback-smoke",
    });
    state = await assertValue(
      "state after disliked",
      await db.userTitleState.findUnique({
        where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId, mediaType: "movie" } },
      }),
    );
    await assertEqual("disliked materialized", state.liked, false);

    const afterDislikedRows = await db.userTitleFeedback.findMany({
      where: { userId: smokeUserId, tmdbId, mediaType: "movie" },
    });
    await assertEqual(
      "liked conflict inactive",
      afterDislikedRows.find((row) => row.feedbackType === "liked")?.active ?? null,
      false,
    );
    await assertEqual(
      "disliked active",
      afterDislikedRows.find((row) => row.feedbackType === "disliked")?.active ?? null,
      true,
    );

    await feedbackEngine.applyTitleFeedback({
      userId: smokeUserId,
      tmdbId,
      mediaType: "movie",
      command: "clear_like",
    });
    state = await assertValue(
      "state after clear_like",
      await db.userTitleState.findUnique({
        where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId, mediaType: "movie" } },
      }),
    );
    await assertEqual("clear_like materialized", state.liked, null);
    const afterClearRows = await db.userTitleFeedback.findMany({
      where: { userId: smokeUserId, tmdbId, mediaType: "movie", active: true },
    });
    if (afterClearRows.some((row) => row.feedbackType === "liked" || row.feedbackType === "disliked")) {
      throw new Error("clear_like left liked/disliked active");
    }
    console.log("[smoke:feedback] clear_like rows inactive: ok");

    await feedbackEngine.applyTitleFeedback({
      userId: smokeUserId,
      tmdbId,
      mediaType: "movie",
      command: "not_interested",
      surface: "for_you",
      reason: "feedback smoke",
    });
    await feedbackEngine.applyTitleFeedback({
      userId: smokeUserId,
      tmdbId,
      mediaType: "movie",
      command: "hidden",
      surface: "for_you",
    });
    await feedbackEngine.applyTitleFeedback({
      userId: smokeUserId,
      tmdbId,
      mediaType: "movie",
      command: "dismissed",
      surface: "radar",
      sectionKey: "feedback-smoke",
      scope: "section",
    });
    state = await assertValue(
      "state after negative feedback",
      await db.userTitleState.findUnique({
        where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId, mediaType: "movie" } },
      }),
    );
    await assertEqual("negative materialized", state.hasNegativeFeedback, true);
    await assertEqual("hidden materialized", state.isHidden, true);

    await feedbackEngine.applyTitleFeedback({
      userId: smokeUserId,
      tmdbId,
      mediaType: "movie",
      command: "favorite",
    });
    state = await assertValue(
      "state after favorite",
      await db.userTitleState.findUnique({
        where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId, mediaType: "movie" } },
      }),
    );
    await assertEqual("favorite materialized", state.favorite, true);

    await feedbackEngine.applyTitleFeedback({
      userId: smokeUserId,
      tmdbId,
      mediaType: "movie",
      command: "unfavorite",
    });
    state = await assertValue(
      "state after unfavorite",
      await db.userTitleState.findUnique({
        where: { userId_tmdbId_mediaType: { userId: smokeUserId, tmdbId, mediaType: "movie" } },
      }),
    );
    await assertEqual("unfavorite materialized", state.favorite, false);

    const map = await feedbackHelpers.getTitleFeedbackMap(smokeUserId, tmdbId, "movie");
    const feedbackState = feedbackHelpers.getTitleFeedbackState(map, tmdbId, "movie");
    if (!feedbackState.activeFeedbackTypes.includes("not_interested")) {
      throw new Error("feedback map missing not_interested");
    }
    if (!feedbackState.activeFeedbackTypes.includes("hidden")) {
      throw new Error("feedback map missing hidden");
    }
    if (!feedbackState.activeFeedbackTypes.includes("dismissed_from_section")) {
      throw new Error("feedback map missing dismissed_from_section");
    }
    console.log("[smoke:feedback] feedback map read: ok");

    const events = await db.userEvent.findMany({
      where: { userId: smokeUserId, tmdbId, mediaType: "movie", eventType: "feedback_applied" },
    });
    if (events.length === 0) throw new Error("feedback event not logged");
    console.log("[smoke:feedback] user event logged: ok");
  } finally {
    await db.userTitleFeedback.deleteMany({ where: { userId: smokeUserId } });
    await db.userTitleState.deleteMany({ where: { userId: smokeUserId } });
    await db.userTitle.deleteMany({ where: { userId: smokeUserId } });
    await db.userEvent.deleteMany({ where: { userId: smokeUserId } });
    await db.user.deleteMany({ where: { id: smokeUserId } });
    console.log("[smoke:feedback] cleanup: ok");
  }

  console.log("[smoke:feedback] completed");
}

main().catch((error) => {
  console.error("[smoke:feedback] failed", error);
  process.exitCode = 1;
});
