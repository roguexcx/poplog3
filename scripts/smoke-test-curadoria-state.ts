import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:curadoria-state] ${label}: ok`);
  return value;
}

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:curadoria-state] ${label}: ok`);
}

async function main() {
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_CURADORIA_STATE_ENABLED = "false";
  await assertEqual("flag off", getLocalDbFlagState().curadoriaState, false);

  process.env.POPLOG_LOCAL_CURADORIA_STATE_ENABLED = "true";
  await assertEqual("flag on", getLocalDbFlagState().curadoriaState, true);

  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${localUserId}-curadoria-state-smoke`;
  const contentId = "tmdb-tv-987661001";

  const service = await import("@/server/local-services/curadoria-state-local.service");

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "curadoria-state-smoke@poplog.dev",
      name: "POPLOG Curadoria State Smoke User",
    },
  });

  try {
    const created = await service.upsertCuradoriaState({
      userId: smokeUserId,
      contentId,
      contentType: "serie",
      title: "Curadoria State Smoke Series",
      posterPath: "/poster.jpg",
      backdropPath: "/backdrop.jpg",
      status: "watching",
      runtime: 44,
      tmdbRating: 8.1,
      userRating: 5,
      addedToWatchlistAt: "2026-01-01T00:00:00.000Z",
      startedAt: "2026-01-02T00:00:00.000Z",
      genres: ["Drama", "Sci-Fi"],
      year: 2026,
      priorityScore: 12.5,
      dominantColor: "#112233",
      rediscoveryEligible: true,
      newEpisodeAvailable: true,
      newEpisodeAvailableSince: "2026-01-03T00:00:00.000Z",
      streamingPlatform: "Smoke Stream",
      streamingAvailableSince: "2026-01-04T00:00:00.000Z",
      availableOnVod: true,
      vodAvailableSince: "2026-01-05T00:00:00.000Z",
    });
    await assertEqual("created content id", created.content_id, contentId);
    await assertEqual("created score", created.priority_score, 12.5);
    await assertEqual("created rediscovery", created.rediscovery_eligible, true);

    const read = await assertValue(
      "read state",
      await service.getCuradoriaState(smokeUserId, contentId),
    );
    await assertEqual("read title", read.title, "Curadoria State Smoke Series");
    await assertEqual("read new episode", read.new_episode_available, true);

    const updated = await service.updateCuradoriaStateOverlay({
      userId: smokeUserId,
      contentId,
      patch: {
        priorityScore: 21.75,
        snoozedUntil: "2026-01-06T00:00:00.000Z",
        snoozeCount: 2,
        heroShownCount: 3,
        heroLastShownAt: "2026-01-07T00:00:00.000Z",
        dominantColor: "#445566",
        rediscoveryEligible: false,
        newEpisodeAvailable: false,
        streamingPlatform: "Updated Stream",
        availableOnVod: false,
      },
    });
    await assertEqual("updated score", updated.priority_score, 21.75);
    await assertEqual("updated snooze count", updated.snooze_count, 2);
    await assertEqual("updated hero shown count", updated.hero_shown_count, 3);
    await assertEqual("updated dominant color", updated.dominant_color, "#445566");
    await assertEqual("updated rediscovery", updated.rediscovery_eligible, false);
    await assertEqual("updated vod", updated.available_on_vod, false);

    const list = await service.getCuradoriaStates({
      userId: smokeUserId,
      contentIds: [contentId],
      limit: 10,
    });
    await assertEqual("list count", list.length, 1);
    await assertEqual("list content id", list[0]?.content_id, contentId);

    await service.removeCuradoriaState(smokeUserId, contentId);
    const removed = await service.getCuradoriaState(smokeUserId, contentId);
    await assertEqual("removed state", removed, null);
  } finally {
    await db.userCuradoriaState.deleteMany({ where: { userId: smokeUserId } });
    await db.user.deleteMany({ where: { id: smokeUserId } });
    console.log("[smoke:curadoria-state] cleanup: ok");
  }

  console.log("[smoke:curadoria-state] completed");
}

main().catch((error) => {
  console.error("[smoke:curadoria-state] failed", error);
  process.exitCode = 1;
});
