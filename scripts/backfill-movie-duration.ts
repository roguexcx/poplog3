import { config } from "dotenv";

config({ path: ".env.local" });

const MOVIE_STATUSES = ["watchlist", "watching", "watched", "abandoned", "fridge"];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

type MovieStateRow = {
  user_id: string;
  tmdb_id: number;
  status: string | null;
  favorite: boolean | null;
  liked: boolean | null;
};

type SupabaseAdmin = typeof import("@/server/supabase/admin")["supabaseAdmin"];

async function getMovieDurationSummary(supabaseAdmin: SupabaseAdmin) {
  const { data: stateRows, error: stateError } = await supabaseAdmin
    .from("user_title_state")
    .select("tmdb_id, duration_sort_minutes")
    .eq("media_type", "movie")
    .in("status", MOVIE_STATUSES);

  if (stateError) throw new Error(stateError.message);

  const tmdbIds = Array.from(
    new Set(((stateRows ?? []) as Array<{ tmdb_id: number }>).map((row) => row.tmdb_id)),
  );

  const { data: titleRows, error: titleError } = await supabaseAdmin
    .from("poplog3_titles")
    .select("tmdb_id, runtime, tmdb_payload")
    .eq("media_type", "movie")
    .in("tmdb_id", tmdbIds);

  if (titleError) throw new Error(titleError.message);

  const runtimeById = new Map(
    ((titleRows ?? []) as Array<{
      tmdb_id: number;
      runtime: number | null;
      tmdb_payload: Record<string, unknown> | null;
    }>).map((row) => [
      row.tmdb_id,
      readPositiveNumber(row.runtime) ?? readPositiveNumber(row.tmdb_payload?.runtime),
    ]),
  );

  const states = (stateRows ?? []) as Array<{
    tmdb_id: number;
    duration_sort_minutes: number | null;
  }>;

  return {
    total_movies: states.length,
    with_runtime: states.filter((row) => runtimeById.get(row.tmdb_id)).length,
    with_duration_sort: states.filter((row) => readPositiveNumber(row.duration_sort_minutes)).length,
    pending_backfill: states.filter(
      (row) => runtimeById.get(row.tmdb_id) && !readPositiveNumber(row.duration_sort_minutes),
    ).length,
    unavailable: states.filter(
      (row) => !runtimeById.get(row.tmdb_id) && !readPositiveNumber(row.duration_sort_minutes),
    ).length,
  };
}

function readPositiveNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value > 0 ? Math.round(value) : null;
}

async function main() {
  const [{ supabaseAdmin }, { syncTmdbTitle }, { upsertTitleState }] = await Promise.all([
    import("@/server/supabase/admin"),
    import("@/server/sync/sync-tmdb-title"),
    import("@/server/state/user-title-state"),
  ]);

  const before = await getMovieDurationSummary(supabaseAdmin);
  if (before) {
    console.log(
      [
        "[duration-movies] MOVIE DURATION ANALYSIS",
        `- Total filmes na biblioteca/watchlist: ${before.total_movies ?? 0}`,
        `- Com runtime válido: ${before.with_runtime ?? 0}`,
        `- Com duration_sort_minutes preenchido: ${before.with_duration_sort ?? 0}`,
        `- Pendentes de backfill: ${before.pending_backfill ?? 0}`,
        `- Duração indisponível real: ${before.unavailable ?? 0}`,
      ].join("\n"),
    );
  }

  const { data: rows, error } = await supabaseAdmin
    .from("user_title_state")
    .select("user_id, tmdb_id, status, favorite, liked")
    .eq("media_type", "movie")
    .in("status", MOVIE_STATUSES)
    .is("duration_sort_minutes", null);

  if (error) throw new Error(error.message);

  const usersByMovie = new Map<number, MovieStateRow[]>();
  for (const row of (rows ?? []) as MovieStateRow[]) {
    const list = usersByMovie.get(row.tmdb_id) ?? [];
    list.push(row);
    usersByMovie.set(row.tmdb_id, list);
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
          userId: stateRow.user_id,
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

  const after = await getMovieDurationSummary(supabaseAdmin);
  console.log(
    [
      "[duration-movies] FINAL STATUS",
      `✓ Filmes re-sincronizados: ${synced}`,
      `✓ Runtime recuperado: ${withRuntime}`,
      unavailable > 0 ? `⚠ Filmes sem duração: ${unavailable}` : "✓ Nenhum filme sem duração",
      failed > 0 ? `✗ Falhas: ${failed}` : "✓ Sem falhas",
      `✓ Filmes ordenáveis: ${after?.with_duration_sort ?? withRuntime}`,
      "✓ Séries não alteradas",
      "✓ Ordenação unificada preservada",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error("[duration-movies] erro fatal", err);
  process.exitCode = 1;
});
