/**
 * POST /api/library/watchlist-hydrate
 *
 * Hidratação persistente para séries da watchlist sem dados de episódios/runtime.
 *
 * Fonte de verdade: poplog3_episodes (Prisma/local DB).
 * Uma série é considerada "já hidratada" quando tem ao menos 1 episódio
 * em poplog3_episodes com season > 0, INDEPENDENTE do runtime (pode ser null/zero).
 *
 * Séries permanentemente não-hidratáveis (TMDB sem seasons, sem episódios reais)
 * são marcadas com hydration_skipped=true em user_title_state para não re-processar.
 *
 * O cliente chama em loop até `remaining === 0` OU `stopped === true`.
 * Cada chamada processa até MAX_SERIES_PER_RUN séries para respeitar rate-limit TMDB.
 *
 * Fluxo por série:
 * 1. Sync de metadados do título  →  garante number_of_seasons no banco
 * 2. Sync de cada temporada       →  popula poplog3_episodes
 * 3. Re-verifica se episódios foram inseridos (remaining real pós-batch)
 * 4. Marca como skipped se ainda sem episódios (permanentemente não-hidratável)
 * 5. Atualiza aired_episodes no user_title_state
 */

import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import { backfillDurationSortMinutesForUserTitles } from "@/server/state/user-title-state";
import { syncTmdbSeason } from "@/server/sync/sync-tmdb-season";
import { syncTmdbTitle } from "@/server/sync/sync-tmdb-title";

const SLEEP_MS = 150;
const MAX_SERIES_PER_RUN = 3;
const MAX_DURATION_BACKFILL_PER_RUN = 10;
const DEBUG_WATCHLIST_HYDRATION = process.env.DEBUG_WATCHLIST_HYDRATION === "true";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type WatchlistStateRow = {
  tmdb_id: number;
  duration_sort_minutes: number | null;
  duration_sort_unavailable?: boolean | null;
};

type WatchlistTitleMeta = {
  tmdb_id: number;
  title: string | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  runtime: number | null;
  episode_run_time: number[] | null;
};

type EpisodeStats = {
  episodeCount: number;
  runtimeEpisodeCount: number;
};

function logDebug(label: string, payload: Record<string, unknown>) {
  if (DEBUG_WATCHLIST_HYDRATION) {
    const compactPayload = {
      ...payload,
      titleMetaRows: Array.isArray(payload.titleMetaRows)
        ? `${payload.titleMetaRows.length} titles`
        : payload.titleMetaRows,
      episodeStats: Array.isArray(payload.episodeStats)
        ? `${payload.episodeStats.length} series`
        : payload.episodeStats,
    };
    console.log(`[watchlist-hydrate:debug] ${label}`, compactPayload);
  }
}

function getTitleLabel(tmdbId: number, titles: Map<number, WatchlistTitleMeta>) {
  return titles.get(tmdbId)?.title ?? `TMDB ${tmdbId}`;
}

function getRuntimeSource(meta: WatchlistTitleMeta | undefined, stats: EpisodeStats | undefined) {
  if ((stats?.runtimeEpisodeCount ?? 0) > 0) return "runtime real";
  if (meta?.episode_run_time?.some((value) => typeof value === "number" && value > 0)) return "tmdb_array";
  if (typeof meta?.runtime === "number" && meta.runtime > 0) return "tmdb runtime";
  return "indisponível";
}

function formatDuration(minutes: number | null | undefined) {
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
    ? `${minutes}min`
    : "sem duração";
}

function numericJsonArray(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;
  const numbers = value.filter((item): item is number => typeof item === "number" && Number.isFinite(item));
  return numbers.length > 0 ? numbers : null;
}

function logWatchlistAnalysis(input: {
  total: number;
  hydrated: number;
  hydrationPending: number;
  durationPending: number;
  durationReady: number;
  durationUnavailable: number;
  sourceCounts: Record<string, number>;
}) {
  console.log(
    [
      "[watchlist-hydrate] WATCHLIST ANALYSIS",
      `- Total séries watchlist: ${input.total}`,
      `- Já hidratadas: ${input.hydrated}`,
      `- Pendentes de hidratação: ${input.hydrationPending}`,
      `- Pendentes de duração: ${input.durationPending}`,
      `- Duração pronta: ${input.durationReady}`,
      `- Duração indisponível: ${input.durationUnavailable}`,
      `- Fontes: runtime real ${input.sourceCounts["runtime real"] ?? 0}, tmdb_array ${input.sourceCounts.tmdb_array ?? 0}, tmdb runtime ${input.sourceCounts["tmdb runtime"] ?? 0}, indisponível ${input.sourceCounts["indisponível"] ?? 0}`,
    ].join("\n"),
  );
}

function logHydrationSummary(input: {
  hydratedIds: number[];
  skippedIds: number[];
  pendingIds: number[];
  titles: Map<number, WatchlistTitleMeta>;
}) {
  const lines = ["[watchlist-hydrate] HYDRATION"];
  if (input.hydratedIds.length === 0 && input.skippedIds.length === 0 && input.pendingIds.length === 0) {
    lines.push("✓ Nenhuma hidratação pendente");
  }
  for (const id of input.hydratedIds.slice(0, 8)) {
    lines.push(`✓ ${getTitleLabel(id, input.titles)} hidratada`);
  }
  for (const id of input.skippedIds.slice(0, 8)) {
    lines.push(`⚠ ${getTitleLabel(id, input.titles)} sem episódios válidos (hydration_skipped)`);
  }
  for (const id of input.pendingIds.slice(0, 8)) {
    lines.push(`⚠ ${getTitleLabel(id, input.titles)} ainda pendente de hidratação`);
  }
  console.log(lines.join("\n"));
}

function logDurationSummary(input: {
  backfilledIds: number[];
  unavailableIds: number[];
  titles: Map<number, WatchlistTitleMeta>;
  episodeStats: Map<number, EpisodeStats>;
  durationById: Map<number, number | null>;
}) {
  const lines = ["[watchlist-hydrate] DURATION BACKFILL"];
  if (input.backfilledIds.length === 0 && input.unavailableIds.length === 0) {
    lines.push("✓ Nenhum backfill de duração pendente");
  }
  for (const id of input.backfilledIds.slice(0, 10)) {
    const source = getRuntimeSource(input.titles.get(id), input.episodeStats.get(id));
    lines.push(`✓ ${getTitleLabel(id, input.titles)} calculado: ${formatDuration(input.durationById.get(id))} (${source})`);
  }
  for (const id of input.unavailableIds.slice(0, 10)) {
    const stats = input.episodeStats.get(id);
    const reason = (stats?.episodeCount ?? 0) === 0 ? "sem episódios" : "sem runtime suficiente";
    lines.push(`⚠ ${getTitleLabel(id, input.titles)} ${reason} (duration_sort_unavailable)`);
  }
  console.log(lines.join("\n"));
}

function logFinalStatus(input: {
  stopped: boolean;
  reason?: string;
  sortableCount: number;
  unavailableCount: number;
  refreshExpected: boolean;
}) {
  console.log(
    [
      "[watchlist-hydrate] FINAL STATUS",
      input.stopped ? `⚠ Loop interrompido: ${input.reason ?? "remaining_not_decreasing"}` : "✓ Sistema estabilizado",
      input.stopped ? "⚠ Proteção anti-loop acionada" : "✓ Nenhum loop detectado",
      `✓ ${input.sortableCount} títulos ordenáveis`,
      input.unavailableCount > 0
        ? `⚠ ${input.unavailableCount} títulos indisponíveis`
        : "✓ Nenhum título indisponível",
      input.refreshExpected ? "✓ Router refresh deve atualizar a Biblioteca" : "✓ Router refresh não necessário",
    ].join("\n"),
  );
}

function logWatchlistOk(input: {
  sortableCount: number;
  unavailableCount: number;
  pendingCount: number;
}) {
  console.log(
    [
      "[watchlist-hydrate] OK",
      `- ${input.sortableCount} ordenáveis`,
      `- ${input.unavailableCount} indisponíveis`,
      `- ${input.pendingCount} pendências`,
    ].join("\n"),
  );
}

export async function POST() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    // ── 1. Séries TV na watchlist pura (não iniciadas, não marcadas como skipped) ──
    const stateRows = await db.userTitleState.findMany({
      where: {
        userId: user.id,
        mediaType: "tv",
        status: "watchlist",
        watchedEpisodes: 0,
        hydrationSkipped: false,
      },
      select: {
        tmdbId: true,
        durationSortMinutes: true,
        durationSortUnavailable: true,
      },
    });

    const allRows: WatchlistStateRow[] = stateRows.map((row) => ({
      tmdb_id: row.tmdbId,
      duration_sort_minutes: row.durationSortMinutes,
      duration_sort_unavailable: row.durationSortUnavailable,
    }));
    const allTmdbIds = allRows.map((r) => r.tmdb_id);

    if (allTmdbIds.length === 0) {
      console.log("[watchlist-hydrate] nenhuma série para hidratar");
      return NextResponse.json({ ok: true, hydrated: 0, remaining: 0 });
    }

    // ── 2. Quais já foram sincronizadas? ─────────────────────────────────────────
    //
    // Critério: tem ao menos 1 episódio em poplog3_episodes (season > 0).
    // NÃO usamos runtime > 0 — TMDB tem séries com todos os runtimes null/zero.
    const [hydratedEps, titleMetaRows] = await Promise.all([
      db.poplog3Episode.findMany({
        where: {
          seriesTmdbId: { in: allTmdbIds },
          seasonNumber: { gt: 0 },
        },
        select: {
          seriesTmdbId: true,
          runtime: true,
        },
      }),
      db.poplog3Title.findMany({
        where: {
          tmdbId: { in: allTmdbIds },
          mediaType: "tv",
        },
        select: {
          tmdbId: true,
          title: true,
          numberOfSeasons: true,
          numberOfEpisodes: true,
          runtime: true,
          episodeRunTime: true,
        },
      }),
    ]);

    const titleMetaMap = new Map(
      titleMetaRows.map((row) => [
        row.tmdbId,
        {
          tmdb_id: row.tmdbId,
          title: row.title,
          number_of_seasons: row.numberOfSeasons,
          number_of_episodes: row.numberOfEpisodes,
          runtime: row.runtime,
          episode_run_time: numericJsonArray(row.episodeRunTime),
        } satisfies WatchlistTitleMeta,
      ]),
    );
    const episodeStatsById = new Map<number, EpisodeStats>();
    for (const row of hydratedEps) {
      const stats = episodeStatsById.get(row.seriesTmdbId) ?? {
        episodeCount: 0,
        runtimeEpisodeCount: 0,
      };
      stats.episodeCount++;
      if (typeof row.runtime === "number" && row.runtime > 0) {
        stats.runtimeEpisodeCount++;
      }
      episodeStatsById.set(row.seriesTmdbId, stats);
    }

    const alreadyHydrated = new Set(episodeStatsById.keys());

    const durationReadyCount = allRows.filter(
      (row) => typeof row.duration_sort_minutes === "number" && row.duration_sort_minutes > 0,
    ).length;
    const durationUnavailableCount = allRows.filter(
      (row) => row.duration_sort_unavailable === true,
    ).length;
    const sourceCounts = allRows.reduce<Record<string, number>>((acc, row) => {
      const source = getRuntimeSource(titleMetaMap.get(row.tmdb_id), episodeStatsById.get(row.tmdb_id));
      acc[source] = (acc[source] ?? 0) + 1;
      return acc;
    }, {});

    logDebug("raw input", {
      allTmdbIds,
      titleMetaRows,
      episodeStats: Array.from(episodeStatsById.entries()),
    });

    const needsHydration = allTmdbIds.filter((id) => !alreadyHydrated.has(id));
    const needsDurationBackfill = allRows
      .filter((row) =>
        alreadyHydrated.has(row.tmdb_id) &&
        row.duration_sort_minutes === null &&
        row.duration_sort_unavailable !== true
      )
      .map((row) => row.tmdb_id);
    const beforeRemaining = needsHydration.length + needsDurationBackfill.length;
    const batch = needsHydration.slice(0, MAX_SERIES_PER_RUN);
    const durationBackfillBatch = needsDurationBackfill.slice(0, MAX_DURATION_BACKFILL_PER_RUN);

    const hasInitialWork = beforeRemaining > 0;
    if (DEBUG_WATCHLIST_HYDRATION || hasInitialWork) {
      logWatchlistAnalysis({
        total: allTmdbIds.length,
        hydrated: alreadyHydrated.size,
        hydrationPending: needsHydration.length,
        durationPending: needsDurationBackfill.length,
        durationReady: durationReadyCount,
        durationUnavailable: durationUnavailableCount,
        sourceCounts,
      });
    }
    logDebug("initial state", {
      beforeRemaining,
      needsHydration,
      needsDurationBackfill,
      hydrationBatch: batch,
      durationBackfillBatch,
    });

    let durationBackfillResult: Awaited<ReturnType<typeof backfillDurationSortMinutesForUserTitles>> | null = null;

    // ── 3. Metadados atuais do banco ──────────────────────────────────────────────
    const titlesData = batch.length > 0
      ? await db.poplog3Title.findMany({
          where: {
            tmdbId: { in: batch },
            mediaType: "tv",
          },
          select: {
            tmdbId: true,
            numberOfSeasons: true,
          },
        })
      : [];

    const seasonMap = new Map<number, number | null>(
      titlesData.map((title) => [title.tmdbId, title.numberOfSeasons]),
    );

    // ── 4. Processa cada série do lote ────────────────────────────────────────────
    const results: {
      tmdb_id: number;
      ok: boolean;
      seasons_synced: number;
      episodes_found: number;
      error?: string;
    }[] = [];
    const today = new Date().toISOString().slice(0, 10);

    for (const tmdbId of batch) {
      try {
        let numberOfSeasons = seasonMap.get(tmdbId) ?? null;

        if (!numberOfSeasons) {
          const titleSync = await syncTmdbTitle("tv", tmdbId, { force: true });
          const raw = titleSync.title as Record<string, unknown> | null;
          numberOfSeasons = typeof raw?.number_of_seasons === "number"
            ? raw.number_of_seasons
            : null;
          await sleep(SLEEP_MS);
        }

        if (!numberOfSeasons || numberOfSeasons <= 0) {
          logDebug("sem seasons", { tmdbId, title: getTitleLabel(tmdbId, titleMetaMap) });
          results.push({ tmdb_id: tmdbId, ok: false, seasons_synced: 0, episodes_found: 0, error: "no_seasons_data" });
          continue;
        }

        // Sync de cada temporada (season >= 1, ignora season 0)
        let seasonsSynced = 0;
        for (let s = 1; s <= numberOfSeasons; s++) {
          try {
            await syncTmdbSeason(tmdbId, s, { force: false });
            seasonsSynced++;
          } catch {
            // temporada individual falha → continua com as demais
          }
          await sleep(SLEEP_MS);
        }

        // Conta episódios efetivamente inseridos após o sync
        const episodesFound = await db.poplog3Episode.count({
          where: {
            seriesTmdbId: tmdbId,
            seasonNumber: { gt: 0 },
          },
        });
        logDebug("series hydrated", {
          tmdbId,
          title: getTitleLabel(tmdbId, titleMetaMap),
          seasonsSynced,
          episodesFound,
        });

        // Atualiza aired_episodes no state
        const airedCount = await db.poplog3Episode.count({
          where: {
            seriesTmdbId: tmdbId,
            seasonNumber: { gt: 0 },
            airDate: { lte: new Date(`${today}T00:00:00.000Z`) },
          },
        });

        await db.userTitleState.updateMany({
          where: {
            userId: user.id,
            tmdbId,
            mediaType: "tv",
          },
          data: {
            airedEpisodes: airedCount,
          },
        });

        results.push({ tmdb_id: tmdbId, ok: episodesFound > 0, seasons_synced: seasonsSynced, episodes_found: episodesFound });
      } catch (err) {
        results.push({
          tmdb_id: tmdbId,
          ok: false,
          seasons_synced: 0,
          episodes_found: 0,
          error: err instanceof Error ? err.message : "unknown",
        });
      }
    }

    if (durationBackfillBatch.length > 0) {
      durationBackfillResult = await backfillDurationSortMinutesForUserTitles({
        userId: user.id,
        mediaType: "tv",
        tmdbIds: durationBackfillBatch,
      });
      logDebug("duration backfill result", durationBackfillResult);
    }

    // ── 5. Re-verificar quais séries DO BATCH foram realmente hidratadas ──────────
    //
    // CRÍTICO: não confiar no resultado do sync — re-consultar o banco.
    // Séries que ainda não têm episódios após o sync são permanentemente skipped.
    const postBatchEps = batch.length > 0
      ? await db.poplog3Episode.findMany({
          where: {
            seriesTmdbId: { in: batch },
            seasonNumber: { gt: 0 },
          },
          select: {
            seriesTmdbId: true,
          },
          distinct: ["seriesTmdbId"],
        })
      : [];

    const hydratedAfterBatch = new Set(
      postBatchEps.map((row) => row.seriesTmdbId),
    );

    // Séries processadas mas ainda sem episódios → marcar como skipped para não re-processar
    const stillEmptyAfterSync = batch.filter((id) => !hydratedAfterBatch.has(id));
    if (stillEmptyAfterSync.length > 0) {
      logDebug("marking hydration skipped", { tmdbIds: stillEmptyAfterSync });

      await db.userTitleState.updateMany({
        where: {
          userId: user.id,
          mediaType: "tv",
          tmdbId: { in: stillEmptyAfterSync },
        },
        data: {
          hydrationSkipped: true,
        },
      });
    }

    // ── 6. Calcular remaining REAL pós-batch ──────────────────────────────────────
    //
    // Re-consulta para contar séries que AINDA precisam de hidratação.
    // Isso garante que remaining diminua quando o batch for bem-sucedido
    // e NÃO diminua apenas por "tentamos processar" mas falhamos.
    const postBatchAllEps = await db.poplog3Episode.findMany({
      where: {
        seriesTmdbId: { in: allTmdbIds },
        seasonNumber: { gt: 0 },
      },
      select: {
        seriesTmdbId: true,
      },
      distinct: ["seriesTmdbId"],
    });

    const hydratedAfterAll = new Set(
      postBatchAllEps.map((row) => row.seriesTmdbId),
    );

    // Séries que ainda precisam hidratar = todas - hidratadas - skipped(stillEmpty)
    const stillPendingIds = allTmdbIds.filter(
      (id) => !hydratedAfterAll.has(id) && !stillEmptyAfterSync.includes(id),
    );

    const postStateRows = await db.userTitleState.findMany({
      where: {
        userId: user.id,
        mediaType: "tv",
        status: "watchlist",
        watchedEpisodes: 0,
        hydrationSkipped: false,
      },
      select: {
        tmdbId: true,
        durationSortMinutes: true,
        durationSortUnavailable: true,
      },
    });

    const postRows: WatchlistStateRow[] = postStateRows.map((row) => ({
      tmdb_id: row.tmdbId,
      duration_sort_minutes: row.durationSortMinutes,
      duration_sort_unavailable: row.durationSortUnavailable,
    }));
    const stillNeedsDurationBackfill = postRows
      .filter((row) =>
        hydratedAfterAll.has(row.tmdb_id) &&
        row.duration_sort_minutes === null &&
        row.duration_sort_unavailable !== true
      )
      .map((row) => row.tmdb_id);
    const afterRemaining = stillPendingIds.length + stillNeedsDurationBackfill.length;

    // IDs informativos para debug
    const processedTmdbIds = batch;
    const hydratedTmdbIds = batch.filter((id) => hydratedAfterBatch.has(id));
    const skippedTmdbIds = stillEmptyAfterSync;
    const stillPendingTmdbIds = stillPendingIds;
    const durationBackfilledTmdbIds = durationBackfillResult?.updatedTmdbIds ?? [];
    const durationUnavailableTmdbIds = durationBackfillResult?.unavailableTmdbIds ?? [];
    const stillNeedsDurationBackfillTmdbIds = stillNeedsDurationBackfill;

    const durationById = new Map(
      postRows.map((row) => [row.tmdb_id, row.duration_sort_minutes] as const),
    );

    const hasChanges =
      hydratedTmdbIds.length > 0 ||
      skippedTmdbIds.length > 0 ||
      durationBackfilledTmdbIds.length > 0 ||
      durationUnavailableTmdbIds.length > 0;
    const hasPending = afterRemaining > 0 || stillPendingTmdbIds.length > 0;
    const shouldLogFullReport = DEBUG_WATCHLIST_HYDRATION || hasInitialWork || hasChanges || hasPending;

    if (shouldLogFullReport) {
      logHydrationSummary({
        hydratedIds: hydratedTmdbIds,
        skippedIds: skippedTmdbIds,
        pendingIds: stillPendingTmdbIds,
        titles: titleMetaMap,
      });
      logDurationSummary({
        backfilledIds: durationBackfilledTmdbIds,
        unavailableIds: durationUnavailableTmdbIds,
        titles: titleMetaMap,
        episodeStats: episodeStatsById,
        durationById,
      });
    }
    logDebug("batch result", {
      beforeRemaining,
      afterRemaining,
      processedTmdbIds,
      hydratedTmdbIds,
      skippedTmdbIds,
      stillPendingTmdbIds,
      durationBackfillBatch,
      durationBackfilledTmdbIds,
      durationUnavailableTmdbIds,
      stillNeedsDurationBackfillTmdbIds,
    });

    // Proteção: se remaining não diminuiu após o batch, parar o loop
    const remainingDecreased = afterRemaining < beforeRemaining;
    const stopped = !remainingDecreased && afterRemaining > 0;
    if (stopped) {
      logDebug("remaining did not decrease", {
        beforeRemaining,
        afterRemaining,
        stillPendingTmdbIds,
      });
    }

    const finalDurationReady = postRows.filter(
      (row) => typeof row.duration_sort_minutes === "number" && row.duration_sort_minutes > 0,
    ).length;
    const finalDurationUnavailable = postRows.filter(
      (row) => row.duration_sort_unavailable === true,
    ).length;
    if (shouldLogFullReport || stopped) {
      logFinalStatus({
        stopped,
        reason: stopped ? "remaining_not_decreasing" : undefined,
        sortableCount: finalDurationReady,
        unavailableCount: finalDurationUnavailable,
        refreshExpected: hydratedTmdbIds.length > 0 || durationBackfilledTmdbIds.length > 0,
      });
    } else {
      logWatchlistOk({
        sortableCount: finalDurationReady,
        unavailableCount: finalDurationUnavailable,
        pendingCount: afterRemaining,
      });
    }

    return NextResponse.json({
      ok: true,
      hydrated: hydratedTmdbIds.length,
      failed: results.filter((r) => !r.ok).length,
      processed: processedTmdbIds.length + (durationBackfillResult?.processedTmdbIds.length ?? 0),
      skipped: skippedTmdbIds.length,
      durationBackfilled: durationBackfilledTmdbIds.length,
      durationUnavailable: durationUnavailableTmdbIds.length,
      needsDurationBackfill: stillNeedsDurationBackfillTmdbIds.length,
      remaining: afterRemaining,
      stopped,
      ...(stopped ? { reason: "remaining_not_decreasing" } : {}),
      // Debug
      beforeRemaining,
      afterRemaining,
      processedTmdbIds,
      hydratedTmdbIds,
      skippedTmdbIds,
      stillPendingTmdbIds,
      durationBackfillBatch,
      durationBackfilledTmdbIds,
      durationUnavailableTmdbIds,
      stillNeedsDurationBackfillTmdbIds,
      results,
      durationBackfillResult,
    });
  } catch (err) {
    console.error("[watchlist-hydrate]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "unknown" },
      { status: 500 },
    );
  }
}
