import { db } from "@/server/db/client";
import { getLocalDbFlagState } from "@/server/runtime/local-db-flags";

async function assertValue<T>(label: string, value: T | null | undefined): Promise<T> {
  if (value === null || value === undefined) {
    throw new Error(`${label} returned empty`);
  }
  console.log(`[smoke:user-ratings] ${label}: ok`);
  return value;
}

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:user-ratings] ${label}: ok`);
}

async function main() {
  process.env.POPLOG_LOCAL_DB_ENABLED = "false";
  process.env.POPLOG_LOCAL_USER_RATINGS_ENABLED = "false";
  await assertEqual("flag off", getLocalDbFlagState().userRatings, false);

  process.env.POPLOG_LOCAL_USER_RATINGS_ENABLED = "true";
  await assertEqual("flag on", getLocalDbFlagState().userRatings, true);

  const localUserId = process.env.LOCAL_USER_ID?.trim() || "local-user";
  const smokeUserId = `${localUserId}-user-ratings-smoke`;
  const movieId = 987658001;
  const seriesId = 987658002;

  const ratingsService = await import("@/server/ratings/user-rating-service");

  await db.user.upsert({
    where: { id: smokeUserId },
    update: { updatedAt: new Date() },
    create: {
      id: smokeUserId,
      email: "user-ratings-smoke@poplog.dev",
      name: "POPLOG User Ratings Smoke User",
    },
  });

  try {
    const movieRating = await ratingsService.upsertUserRating({
      userId: smokeUserId,
      mediaType: "movie",
      tmdbId: movieId,
      rating: 4.25,
    });
    await assertEqual("movie rating clamped", movieRating.rating, 4.5);

    const readMovie = await assertValue(
      "movie rating read",
      await ratingsService.getUserRating(smokeUserId, "movie", movieId),
    );
    await assertEqual("movie rating value", readMovie.rating, 4.5);

    const updatedMovie = await ratingsService.upsertUserRating({
      userId: smokeUserId,
      mediaType: "movie",
      tmdbId: movieId,
      rating: 3,
      ratingSource: "imported",
    });
    await assertEqual("movie rating updated", updatedMovie.rating, 3);
    await assertEqual("movie rating source", updatedMovie.ratingSource, "imported");

    await ratingsService.upsertUserRating({
      userId: smokeUserId,
      mediaType: "tv",
      tmdbId: seriesId,
      rating: 4,
    });
    await ratingsService.upsertUserRating({
      userId: smokeUserId,
      mediaType: "season",
      tmdbId: seriesId,
      seasonNumber: 1,
      rating: 3.5,
    });
    await ratingsService.upsertUserRating({
      userId: smokeUserId,
      mediaType: "episode",
      tmdbId: seriesId,
      seasonNumber: 1,
      episodeNumber: 2,
      rating: 5,
    });
    console.log("[smoke:user-ratings] tv/season/episode writes: ok");

    const batch = await ratingsService.getUserRatingsBatch(smokeUserId, [
      { mediaType: "movie", tmdbId: movieId },
      { mediaType: "tv", tmdbId: seriesId },
      { mediaType: "season", tmdbId: seriesId, seasonNumber: 1 },
      { mediaType: "episode", tmdbId: seriesId, seasonNumber: 1, episodeNumber: 2 },
    ]);
    await assertEqual("batch size", batch.size, 4);
    await assertEqual("batch movie value", batch.get(`movie:${movieId}::`)?.rating ?? null, 3);
    await assertEqual("batch episode value", batch.get(`episode:${seriesId}:1:2`)?.rating ?? null, 5);

    await ratingsService.deleteUserRating({
      userId: smokeUserId,
      mediaType: "movie",
      tmdbId: movieId,
    });
    const deletedMovie = await ratingsService.getUserRating(smokeUserId, "movie", movieId);
    await assertEqual("movie rating removed", deletedMovie, null);
  } finally {
    await db.userRating.deleteMany({ where: { userId: smokeUserId } });
    await db.user.deleteMany({ where: { id: smokeUserId } });
    console.log("[smoke:user-ratings] cleanup: ok");
  }

  console.log("[smoke:user-ratings] completed");
}

main().catch((error) => {
  console.error("[smoke:user-ratings] failed", error);
  process.exitCode = 1;
});
