import { db } from "@/server/db/client";

async function assertEqual<T>(label: string, actual: T, expected: T): Promise<void> {
  if (actual !== expected) {
    throw new Error(`${label} expected ${String(expected)}, got ${String(actual)}`);
  }
  console.log(`[smoke:rating-aggregates] ${label}: ok`);
}

async function assertClose(label: string, actual: number | null, expected: number): Promise<void> {
  if (actual === null || Math.abs(actual - expected) > 0.001) {
    throw new Error(`${label} expected ${expected}, got ${String(actual)}`);
  }
  console.log(`[smoke:rating-aggregates] ${label}: ok`);
}

async function main() {
  process.env.POPLOG_LOCAL_USER_RATINGS_ENABLED = "true";

  const userA = "rating-aggregates-smoke-a";
  const userB = "rating-aggregates-smoke-b";
  const movieId = 987659101;
  const seriesId = 987659102;

  const ratingsService = await import("@/server/ratings/user-rating-service");
  const aggregateService = await import("@/server/ratings/rating-aggregate-service");

  await db.ratingAggregate.deleteMany({ where: { tmdbId: { in: [movieId, seriesId] } } });
  await db.userRating.deleteMany({ where: { userId: { in: [userA, userB] } } });
  await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });

  await db.user.createMany({
    data: [
      { id: userA, email: "rating-aggregates-smoke-a@poplog.dev", name: "Rating Aggregates Smoke A" },
      { id: userB, email: "rating-aggregates-smoke-b@poplog.dev", name: "Rating Aggregates Smoke B" },
    ],
  });

  try {
    await ratingsService.upsertUserRating({
      userId: userA,
      mediaType: "movie",
      tmdbId: movieId,
      rating: 4,
    });
    await ratingsService.upsertUserRating({
      userId: userB,
      mediaType: "movie",
      tmdbId: movieId,
      rating: 2,
    });

    const movieAggregate = await aggregateService.getPublicRating("movie", movieId);
    await assertClose("movie average", movieAggregate?.averageRating ?? null, 3);
    await assertClose("movie explicit average", movieAggregate?.explicitAvgRating ?? null, 3);
    await assertEqual("movie rating count", movieAggregate?.ratingCount ?? null, 2);
    await assertEqual("movie explicit count", movieAggregate?.explicitRatingCount ?? null, 2);

    await ratingsService.deleteUserRating({
      userId: userA,
      mediaType: "movie",
      tmdbId: movieId,
    });

    const movieAfterDelete = await aggregateService.getPublicRating("movie", movieId);
    await assertClose("movie average after delete", movieAfterDelete?.averageRating ?? null, 2);
    await assertEqual("movie count after delete", movieAfterDelete?.ratingCount ?? null, 1);

    await ratingsService.upsertUserRating({
      userId: userA,
      mediaType: "episode",
      tmdbId: seriesId,
      seasonNumber: 1,
      episodeNumber: 1,
      rating: 4,
    });

    const seriesFromEpisode = await aggregateService.getPublicRating("tv", seriesId);
    await assertClose("series inferred average", seriesFromEpisode?.averageRating ?? null, 4);
    await assertEqual("series inferred count", seriesFromEpisode?.inferredRatingCount ?? null, 1);
    await assertEqual("series explicit count before title rating", seriesFromEpisode?.explicitRatingCount ?? null, 0);

    await ratingsService.upsertUserRating({
      userId: userB,
      mediaType: "tv",
      tmdbId: seriesId,
      rating: 2,
    });

    const seriesMixed = await aggregateService.getPublicRating("tv", seriesId);
    await assertClose("series mixed average", seriesMixed?.averageRating ?? null, 3);
    await assertClose("series mixed explicit average", seriesMixed?.explicitAvgRating ?? null, 2);
    await assertEqual("series mixed rating count", seriesMixed?.ratingCount ?? null, 2);
    await assertEqual("series mixed inferred count", seriesMixed?.inferredRatingCount ?? null, 1);
  } finally {
    await db.userRating.deleteMany({ where: { userId: { in: [userA, userB] } } });
    await db.ratingAggregate.deleteMany({ where: { tmdbId: { in: [movieId, seriesId] } } });
    await db.user.deleteMany({ where: { id: { in: [userA, userB] } } });
    await db.$disconnect();
    console.log("[smoke:rating-aggregates] cleanup: ok");
  }

  console.log("[smoke:rating-aggregates] completed");
}

main().catch((error) => {
  console.error("[smoke:rating-aggregates] failed", error);
  process.exitCode = 1;
});
