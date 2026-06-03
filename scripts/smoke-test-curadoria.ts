import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:curadoria] ${label}: ok`);
  return value;
}

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:curadoria] ${label}: ok`);
}

async function main() {
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_USER_PREFERENCES_ENABLED = "false";
  process.env.POPLOG_LOCAL_CURADORIA_ENABLED = "false";
  await assertEqual("preferences flag off", getLocalDbFlagState().userPreferences, false);
  await assertEqual("curadoria flag off", getLocalDbFlagState().curadoria, false);

  process.env.POPLOG_LOCAL_USER_PREFERENCES_ENABLED = "true";
  process.env.POPLOG_LOCAL_CURADORIA_ENABLED = "true";
  await assertEqual("preferences flag on", getLocalDbFlagState().userPreferences, true);
  await assertEqual("curadoria flag on", getLocalDbFlagState().curadoria, true);

  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${localUserId}-curadoria-smoke`;
  const tmdbId = 987660001;
  const contentId = `tmdb-tv-${tmdbId}`;

  const [preferencesService, curadoriaService] = await Promise.all([
    import("@/server/local-services/user-preferences-local.service"),
    import("@/server/local-services/curadoria-local.service"),
  ]);

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "curadoria-smoke@poplog.dev",
      name: "POPLOG Curadoria Smoke User",
    },
  });

  try {
    const createdPreference = await preferencesService.upsertUserPreferences({
      userId: smokeUserId,
      preferredSessionDurationMinutes: 45,
      typicalWatchDays: ["friday", "saturday"],
      typicalWatchTimeStart: 20,
      typicalWatchTimeEnd: 23,
      topGenres: ["Drama", "Sci-Fi"],
      topPlatforms: ["Provider A"],
      avgEpisodesPerSession: 2.5,
      prefersShortContent: false,
      bingeTendencyScore: 0.75,
    });
    await assertEqual("preference created duration", createdPreference.preferred_session_duration_minutes, 45);

    const readPreference = await assertValue(
      "preference read",
      await preferencesService.getUserPreferences(smokeUserId),
    );
    await assertEqual("preference read duration", readPreference.preferred_session_duration_minutes, 45);

    const updatedPreference = await preferencesService.upsertUserPreferences({
      userId: smokeUserId,
      preferredSessionDurationMinutes: 30,
      typicalWatchDays: ["sunday"],
      prefersShortContent: true,
      bingeTendencyScore: 0.25,
    });
    await assertEqual("preference updated duration", updatedPreference.preferred_session_duration_minutes, 30);
    await assertEqual("preference updated short content", updatedPreference.prefers_short_content, true);

    await curadoriaService.logCuradoriaSignal(smokeUserId, contentId, "clicked_hero", {
      surface: "smoke",
    });
    await curadoriaService.logCuradoriaSignal(smokeUserId, contentId, "snoozed", {
      durationHours: 4,
    });

    const signals = await curadoriaService.getCuradoriaSignals({
      userId: smokeUserId,
      contentId,
      limit: 10,
    });
    await assertEqual("signal count", signals.length, 2);
    if (!signals.some((signal) => signal.signal_type === "clicked_hero")) {
      throw new Error("clicked_hero signal missing");
    }
    console.log("[smoke:curadoria] signal list: ok");

    await curadoriaService.logUserActionEvent({
      userId: smokeUserId,
      tmdbId,
      mediaType: "tv",
      eventType: "curadoria_clicked_hero",
      payload: { contentId, source: "smoke" },
    });

    const events = await curadoriaService.getUserActionEvents({
      userId: smokeUserId,
      tmdbId,
      mediaType: "tv",
      eventType: "curadoria_clicked_hero",
      limit: 10,
    });
    await assertEqual("event count", events.length, 1);
    await assertEqual("event type", events[0]?.event_type, "curadoria_clicked_hero");
  } finally {
    await db.userCuradoriaSignal.deleteMany({ where: { userId: smokeUserId } });
    await db.userCuradoriaPreference.deleteMany({ where: { userId: smokeUserId } });
    await db.userEvent.deleteMany({ where: { userId: smokeUserId } });
    await db.user.deleteMany({ where: { id: smokeUserId } });
    console.log("[smoke:curadoria] cleanup: ok");
  }

  console.log("[smoke:curadoria] completed");
}

main().catch((error) => {
  console.error("[smoke:curadoria] failed", error);
  process.exitCode = 1;
});
