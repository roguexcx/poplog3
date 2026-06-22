import assert from "node:assert/strict";

import { db } from "@/server/db/client";
import { upsertSeason } from "@/server/cache/season-cache";
import { upsertTitleState } from "@/server/state/user-title-state";

const userId = "canonical-episode-sync-smoke-user";
const seriesTmdbId = 987657091;

async function main() {
  const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000);
  const yesterday = new Date(Date.now() - 86_400_000);

  await db.user.upsert({
    where: { id: userId },
    update: { updatedAt: new Date() },
    create: {
      id: userId,
      email: "canonical-episode-sync-smoke@poplog.dev",
      name: "Canonical Episode Sync Smoke",
    },
  });

  try {
    await db.poplog3Title.create({
      data: {
        tmdbId: seriesTmdbId,
        mediaType: "tv",
        title: "Canonical Episode Sync Smoke",
        numberOfEpisodes: 1,
        numberOfSeasons: 1,
        lastAirDate: threeDaysAgo,
      },
    });
    await db.poplog3Episode.create({
      data: {
        seriesTmdbId,
        seasonNumber: 1,
        episodeNumber: 1,
        name: "Episódio anterior",
        airDate: threeDaysAgo,
        runtime: 50,
      },
    });
    await db.userTitle.create({
      data: {
        userId,
        tmdbId: seriesTmdbId,
        mediaType: "tv",
        status: "watched",
        finishedAt: threeDaysAgo,
      },
    });
    await db.userEpisode.create({
      data: {
        userId,
        seriesTmdbId,
        seasonNumber: 1,
        episodeNumber: 1,
        runtimeMinutes: 50,
      },
    });
    await upsertTitleState({
      userId,
      tmdbId: seriesTmdbId,
      mediaType: "tv",
      libraryEntry: { status: "watched" },
    });

    await upsertSeason({
      seriesTmdbId,
      seasonNumber: 1,
      tmdbSeasonId: 8001,
      name: "Temporada 1",
      overview: "Temporada canônica",
      posterPath: "https://example.com/season.jpg",
      airDate: threeDaysAgo.toISOString(),
      episodeCount: 2,
      voteAverage: 8.5,
      tmdbPayload: { source: "smoke" },
      episodes: [
        {
          episodeNumber: 1,
          tmdbEpisodeId: 8101,
          name: "Episódio anterior",
          overview: "Sinopse anterior",
          stillPath: "https://example.com/episode-1.jpg",
          stillUrl: "https://example.com/episode-1.jpg",
          stillSource: "trakt",
          stillWidth: 1280,
          stillHeight: 720,
          stillLanguage: "pt-BR",
          airDate: threeDaysAgo.toISOString(),
          runtime: 50,
          voteAverage: 8,
          voteCount: 100,
          productionCode: null,
          episodeType: "season_premiere",
          titleLanguage: "pt-BR",
          overviewLanguage: "pt-BR",
          originalTitle: "Previous Episode",
          originalOverview: "Previous overview",
          sourcePriority: ["trakt"],
          imageCandidates: [{ source: "trakt", url: "https://example.com/episode-1.jpg" }],
          textCandidates: [{ source: "trakt", language: "pt-BR", title: "Episódio anterior" }],
          externalIds: { trakt: 9101, tmdb: 8101, imdb: "tt0008101", tvdb: 7101 },
        },
        {
          episodeNumber: 2,
          tmdbEpisodeId: 8102,
          name: "Episódio novo",
          overview: "Sinopse nova em português",
          stillPath: "https://example.com/episode-2.jpg",
          stillUrl: "https://example.com/episode-2.jpg",
          stillSource: "trakt",
          stillWidth: 1280,
          stillHeight: 720,
          stillLanguage: "pt-BR",
          airDate: yesterday.toISOString(),
          runtime: 54,
          voteAverage: 9,
          voteCount: 200,
          productionCode: "S01E02",
          episodeType: "standard",
          titleLanguage: "pt-BR",
          overviewLanguage: "pt-BR",
          originalTitle: "New Episode",
          originalOverview: "New overview",
          sourcePriority: ["trakt"],
          imageCandidates: [{ source: "trakt", url: "https://example.com/episode-2.jpg" }],
          textCandidates: [{ source: "trakt", language: "pt-BR", title: "Episódio novo" }],
          externalIds: { trakt: 9102, tmdb: 8102, imdb: "tt0008102", tvdb: 7102 },
        },
      ],
    });

    const [title, episode, library, state] = await Promise.all([
      db.poplog3Title.findUniqueOrThrow({
        where: { tmdbId_mediaType: { tmdbId: seriesTmdbId, mediaType: "tv" } },
      }),
      db.poplog3Episode.findUniqueOrThrow({
        where: {
          seriesTmdbId_seasonNumber_episodeNumber: {
            seriesTmdbId,
            seasonNumber: 1,
            episodeNumber: 2,
          },
        },
      }),
      db.userTitle.findUniqueOrThrow({
        where: { userId_tmdbId_mediaType: { userId, tmdbId: seriesTmdbId, mediaType: "tv" } },
      }),
      db.userTitleState.findUniqueOrThrow({
        where: { userId_tmdbId_mediaType: { userId, tmdbId: seriesTmdbId, mediaType: "tv" } },
      }),
    ]);

    assert.equal(title.lastAirDate?.toISOString().slice(0, 10), yesterday.toISOString().slice(0, 10));
    assert.equal(title.numberOfEpisodes, 2);
    assert.equal(episode.name, "Episódio novo");
    assert.equal(episode.overviewLanguage, "pt-BR");
    assert.equal(episode.stillUrl, "https://example.com/episode-2.jpg");
    assert.deepEqual(episode.externalIdsJson, {
      trakt: 9102,
      tmdb: 8102,
      imdb: "tt0008102",
      tvdb: 7102,
    });
    assert.equal(library.status, "watching");
    assert.equal(library.finishedAt, null);
    assert.equal(state.status, "watching");
    assert.equal(state.computedState, "in_progress");
    assert.equal(state.watchedEpisodes, 1);
    assert.equal(state.airedEpisodes, 2);
    assert.equal(state.progressPct, 50);
    assert.equal(state.nextSeason, 1);
    assert.equal(state.nextEpisode, 2);

    // Local catalog counts must never be hidden behind the external Trakt
    // debounce. Simulate an already-saved episode becoming visible to the state
    // engine without going through upsertSeason.
    await db.userEpisode.create({
      data: {
        userId,
        seriesTmdbId,
        seasonNumber: 1,
        episodeNumber: 2,
        runtimeMinutes: 54,
      },
    });
    await upsertTitleState({
      userId,
      tmdbId: seriesTmdbId,
      mediaType: "tv",
      libraryEntry: { status: "watched" },
    });
    await db.userTitle.update({
      where: { userId_tmdbId_mediaType: { userId, tmdbId: seriesTmdbId, mediaType: "tv" } },
      data: { status: "watched", finishedAt: new Date() },
    });
    await db.poplog3Episode.create({
      data: {
        seriesTmdbId,
        seasonNumber: 1,
        episodeNumber: 3,
        name: "Episódio local recém-lançado",
        airDate: yesterday,
        runtime: 55,
      },
    });

    const { getLocalContinuityStateRows } = await import(
      "@/server/local-services/continuity-local.service"
    );
    const refreshedState = (await getLocalContinuityStateRows(userId)).find(
      (row) => row.tmdb_id === seriesTmdbId,
    );
    assert.equal(refreshedState?.watched_episodes, 2);
    assert.equal(refreshedState?.aired_episodes, 3);
    assert.equal(refreshedState?.computed_state, "in_progress");
    assert.equal(refreshedState?.next_episode, 3);
    const reopenedLibrary = await db.userTitle.findUniqueOrThrow({
      where: { userId_tmdbId_mediaType: { userId, tmdbId: seriesTmdbId, mediaType: "tv" } },
    });
    assert.equal(reopenedLibrary.status, "watching");
    assert.equal(reopenedLibrary.finishedAt, null);

    console.log("[smoke:canonical-episode-sync] ok");
  } finally {
    await db.userEpisode.deleteMany({ where: { userId, seriesTmdbId } });
    await db.userTitleState.deleteMany({ where: { userId, tmdbId: seriesTmdbId, mediaType: "tv" } });
    await db.userTitle.deleteMany({ where: { userId, tmdbId: seriesTmdbId, mediaType: "tv" } });
    await db.userEvent.deleteMany({ where: { userId, tmdbId: seriesTmdbId, mediaType: "tv" } });
    await db.poplog3Episode.deleteMany({ where: { seriesTmdbId } });
    await db.titleSeason.deleteMany({ where: { seriesTmdbId } });
    await db.poplog3Title.deleteMany({ where: { tmdbId: seriesTmdbId, mediaType: "tv" } });
    await db.user.deleteMany({ where: { id: userId } });
    await db.$disconnect();
  }
}

main().catch((error) => {
  console.error("[smoke:canonical-episode-sync] failed", error);
  process.exitCode = 1;
});
