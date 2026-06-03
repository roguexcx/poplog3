/**
 * Backfill: preenche duration_sort_minutes para filmes em user_title_state
 *
 * Lê filmes sem duration_sort_minutes da tabela local (Prisma),
 * faz sync TMDB para obter runtime, e chama upsertTitleState para atualizar.
 *
 * Uso:
 *   npx tsx scripts/backfill-movie-duration.ts
 *
 * Requer: DATABASE_URL no .env (ou .env.local)
 */

import { config } from "dotenv";

config({ path: ".env.local" });
config({ path: ".env" });

const MOVIE_STATUSES = ["watchlist", "watching", "watched", "abandoned", "fridge"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function readPositiveNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 ? Math.round(value) : null;
}

async function getMovieDurationSummary(db: Awaited<typeof import("@/server/db/client")>["db"]) {
  const stateRows = await db.userTitleState.findMany({
    where: { mediaType: "movie", status: { in: MOVIE_STATUSES } },
    select: { tmdbId: true, durationSortMinutes: true },
  });

  const tmdbIds = [...new Set(stateRows.map((r) => r.tmdbId))];

  const titleRows = await db.poplog3Title.findMany({
    where: { tmdbId: { in: tmdbIds }, mediaType: "movie" },
    select: { tmdbId: true, runtime: true, tmdbPayload: true },
  });

  const runtimeById = new Map(
    titleRows.map((row) => {
      const payloadRuntime =
        row.tmdbPayload &&
        typeof row.tmdbPayload === "object" &&
        "runtime" in row.tmdbPayload
          ? readPositiveNumber((row.tmdbPayload as Record<string, unknown>)["runtime"])
          : null;
      return [row.tmdbId, readPositiveNumber(row.runtime) ?? payloadRuntime];
    }),
  );

  return {
    total_movies: stateRows.length,
    with_runtime: stateRows.filter((r) => runtimeById.get(r.tmdbId)).length,
    with_duration_sort: stateRows.filter((r) => readPositiveNumber(r.durationSortMinutes)).length,
    pending_backfill: stateRows.filter(
      (r) => runtimeById.get(r.tmdbId) && !readPositiveNumber(r.durationSortMinutes),
    ).length,
    unavailable: stateRows.filter(
      (r) => !runtimeById.get(r.tmdbId) && !readPositiveNumber(r.durationSortMinutes),
    ).length,
  };
}

async function main() {
  const [{ db }, { syncTmdbTitle }, { upsertTitleState }] = await Promise.all([
    import("@/server/db/client"),
    import("@/server/sync/sync-tmdb-title"),
    import("@/server/state/user-title-state"),
  ]);

  const before = await getMovieDurationSummary(db);
  console.log(
    [
      "[duration-movies] MOVIE DURATION ANALYSIS",
      `- Total filmes na biblioteca/watchlist: ${before.total_movies}`,
      `- Com runtime válido: ${before.with_runtime}`,
      `- Com duration_sort_minutes preenchido: ${before.with_duration_sort}`,
      `- Pendentes de backfill: ${before.pending_backfill}`,
      `- Duração indisponível real: ${before.unavailable}`,
    ].join("\n"),
  );

  const pendingRows = await db.userTitleState.findMany({
    where: {
      mediaType: "movie",
      status: { in: MOVIE_STATUSES },
      durationSortMinutes: null,
    },
    select: { userId: true, tmdbId: true, status: true, favorite: true, liked: true },
  });

  const usersByMovie = new Map<number, typeof pendingRows>();
  for (const row of pendingRows) {
    const list = usersByMovie.get(row.tmdbId) ?? [];
    list.push(row);
    usersByMovie.set(row.tmdbId, list);
  }

  let synced = 0;
  let withRuntime = 0;
  let unavailable = 0;
  let failed = 0;

  for (const [tmdbId, stateRows] of usersByMovie) {
    try {
      const result = await syncTmdbTitle("movie", tmdbId, { force: true });
      const runtime =
        typeof result.title?.runtime === "number" && result.title.runtime > 0
          ? result.title.runtime
          : null;

      synced++;
      if (runtime) withRuntime++;
      else unavailable++;

      for (const stateRow of stateRows) {
        await upsertTitleState({
          userId: stateRow.userId,
          tmdbId,
          mediaType: "movie",
          libraryEntry: {
            status: stateRow.status,
            favorite: Boolean(stateRow.favorite),
            liked: stateRow.liked ?? null,
          },
        });
      }

      if (synced % 20 === 0 || synced === usersByMovie.size) {
        console.log(
          `- Progresso: ${synced}/${usersByMovie.size} | com runtime: ${withRuntime} | sem runtime: ${unavailable} | falhas: ${failed}`,
        );
      }
    } catch (err) {
      failed++;
      console.warn("[duration-movies] falha", {
        tmdbId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }

    await sleep(120);
  }

  const after = await getMovieDurationSummary(db);
  console.log(
    [
      "[duration-movies] FINAL STATUS",
      `✓ Filmes re-sincronizados: ${synced}`,
      `✓ Runtime recuperado: ${withRuntime}`,
      unavailable > 0 ? `⚠ Filmes sem duração: ${unavailable}` : "✓ Nenhum filme sem duração",
      failed > 0 ? `✗ Falhas: ${failed}` : "✓ Sem falhas",
      `✓ Filmes ordenáveis: ${after.with_duration_sort}`,
      "✓ Séries não alteradas",
      "✓ Ordenação unificada preservada",
    ].join("\n"),
  );

  await db.$disconnect();
}

main().catch((err) => {
  console.error("[duration-movies] erro fatal", err);
  process.exitCode = 1;
});
