import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";

type GenreObj = { id: number; name: string };
type GenreStatsPayload = { ok: true; genres: Array<{ name: string; count: number; pct: number }> };

const GENRE_STATS_CACHE_TTL_MS = 10 * 60_000;

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

function genreName(genre: unknown): string | null {
  if (!genre || typeof genre !== "object") return null;
  const name = (genre as { name?: unknown }).name;
  return typeof name === "string" && name.trim() ? name : null;
}

const STATUS_WEIGHT: Record<string, number> = {
  watched:   3,
  watching:  2,
  watchlist: 1,
  fridge:    1,
  abandoned: 0,
};
const FAVORITE_BONUS = 2;

async function buildLocalGenreStats(userId: string) {
  const userTitles = await db.userTitle.findMany({
    where: { userId },
    select: { tmdbId: true, mediaType: true, status: true, favorite: true },
  });

  if (userTitles.length === 0) return { ok: true, genres: [] } satisfies GenreStatsPayload;

  // Filtrar títulos irrelevantes (abandoned = peso 0)
  const relevantTitles = userTitles.filter(
    (t) => (STATUS_WEIGHT[t.status] ?? 0) > 0,
  );

  if (relevantTitles.length === 0) return { ok: true, genres: [] } satisfies GenreStatsPayload;

  const titleData = await db.poplog3Title.findMany({
    where: {
      OR: relevantTitles.map((title) => ({
        tmdbId: title.tmdbId,
        mediaType: title.mediaType,
      })),
    },
    select: { tmdbId: true, mediaType: true, genres: true },
  });

  const titleMap = new Map(
    titleData
      .filter((title) => Array.isArray(title.genres))
      .map((title) => [`${title.tmdbId}_${title.mediaType}`, title.genres as unknown[]]),
  );
  const genreCount: Record<string, number> = {};

  for (const userTitle of relevantTitles) {
    const genres = titleMap.get(`${userTitle.tmdbId}_${userTitle.mediaType}`);
    if (!genres) continue;
    const weight = (STATUS_WEIGHT[userTitle.status] ?? 0) + (userTitle.favorite ? FAVORITE_BONUS : 0);
    for (const genre of genres) {
      const name = genreName(genre);
      if (name) genreCount[name] = (genreCount[name] ?? 0) + weight;
    }
  }

  const sorted = Object.entries(genreCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxCount = sorted[0]?.[1] ?? 1;
  return {
    ok: true,
    genres: sorted.map(([name, count]) => ({
      name,
      count,
      pct: Math.round((count / maxCount) * 100),
    })),
  } satisfies GenreStatsPayload;
}

export async function GET() {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  const stageRef = { value: totalStartedAt };

  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    markStage(perf, stageRef, "auth");

    const cached = await readContinuitySectionCache<GenreStatsPayload>("profile_genre_stats", {
      userId: user.id,
      region: "BR",
      language: "pt-BR",
    });
    markStage(perf, stageRef, "cache_read");

    if (cached?.status === "hit") {
      console.log("[profile/genre-stats/perf]", {
        cacheStatus: "persistent_hit",
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({ ...cached.payload, cacheStatus: "persistent_hit" });
    }

    const payload = await buildLocalGenreStats(user.id);
    markStage(perf, stageRef, "local_read");
    await writeContinuitySectionCache({
      sectionKey: "profile_genre_stats",
      userId: user.id,
      region: "BR",
      language: "pt-BR",
      ttlMs: GENRE_STATS_CACHE_TTL_MS,
      payload,
    });
    markStage(perf, stageRef, "cache_write");

    console.log("[profile/genre-stats/perf]", {
      cacheStatus: cached?.status === "stale" ? "persistent_stale_rebuilt" : "persistent_miss",
      genres: payload.genres.length,
      source: "prisma",
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json({ ...payload, cacheStatus: "persistent_miss" });
  } catch (error) {
    console.error("[GENRE_STATS_ERROR]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
