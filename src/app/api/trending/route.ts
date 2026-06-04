import { NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import type { TmdbTitleSummary } from "@/server/api-clients/tmdb/types";
import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
} from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getSeriesEpisodeRuntimesMap } from "@/server/runtime/series-episode-runtimes";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getUserFeedbackMap } from "@/lib/personalization/feedback";
import { applyUserFeedbackScoring } from "@/lib/personalization/scoring";
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";
import {
  catalogGetTrending,
  isBalloonerismTrendingEnabled,
} from "@/server/source-engine/engine";
import { hydrateCatalogResults } from "@/server/source-engine/hydrate-catalog-results";
import type { PoplogTitle } from "@/server/types/title";

const TRENDING_CACHE_TTL_MS = 30 * 60_000;
const TRENDING_EXTERNAL_TIMEOUT_MS = 2_500;
const TRENDING_DB_TIMEOUT_MS = 1_500;
const TRENDING_AUTH_TIMEOUT_MS = 500;
const TRENDING_BALLOONERISMM_LIMIT = 15;
const TRENDING_MIN_RESULTS = 5;

type TrendingCachePayload = {
  results: unknown[];
  generatedAt: string;
};

function markStage(perf: Record<string, number>, stageRef: { value: number }, stage: string) {
  perf[stage] = Date.now() - stageRef.value;
  stageRef.value = Date.now();
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallback: T,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), timeoutMs)),
  ]);
}

async function resolveUserFeedback() {
  let userId: string | undefined;
  let feedbackMap: Awaited<ReturnType<typeof getUserFeedbackMap>> | undefined;

  await withTimeout((async () => {
    const user = await getCurrentUser();
    if (user) {
      userId = user.id;
      feedbackMap = await getUserFeedbackMap(user.id);
    }
  })().catch(() => undefined), TRENDING_AUTH_TIMEOUT_MS, undefined);

  return { userId, feedbackMap };
}

/**
 * Enriquece PoplogTitle[] com runtime_label para o componente TrendingNowSection.
 * Reutiliza a mesma lógica do caminho legado TMDB.
 */
async function enrichWithRuntime(titles: PoplogTitle[]) {
  const tvIds = titles
    .filter((t) => t.media_type === "tv")
    .map((t) => t.tmdb_id);

  const episodeRuntimesBySeries =
    tvIds.length > 0
      ? await withTimeout(
          getSeriesEpisodeRuntimesMap(tvIds),
          TRENDING_DB_TIMEOUT_MS,
          new Map()
        )
      : new Map();

  return titles.map((title) => {
    const runtimeResolution = resolveRuntimeByMediaType({
      mediaType: title.media_type,
      runtimeMinutes: title.runtime ?? null,
      episodeRunTime: title.episode_run_time ?? null,
      episodes: episodeRuntimesBySeries.get(title.tmdb_id) ?? null,
    });
    const runtimeLabel =
      title.media_type === "tv"
        ? formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
            estimated: runtimeResolution.estimated,
          })
        : formatRuntimeLabel(runtimeResolution.minutes, {
            estimated: runtimeResolution.estimated,
          });

    return {
      ...title,
      id: title.tmdb_id,
      runtime: runtimeResolution.minutes,
      runtime_label: runtimeLabel,
    };
  });
}

/**
 * Interleave movies and tv results: [movie1, tv1, movie2, tv2, ...]
 * Preserves Balloonerismm popularity order within each type.
 */
function interleaveTrending(movies: PoplogTitle[], tv: PoplogTitle[]): PoplogTitle[] {
  const result: PoplogTitle[] = [];
  const len = Math.max(movies.length, tv.length);
  for (let i = 0; i < len; i++) {
    if (i < movies.length) result.push(movies[i]);
    if (i < tv.length) result.push(tv[i]);
  }
  return result;
}

export async function GET() {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = { request_parse: 0 };
  const stageRef = { value: totalStartedAt };
  const sectionKey = "home_trending";

  try {
    const { userId, feedbackMap } = await resolveUserFeedback();
    markStage(perf, stageRef, "auth");

    const cached = await readContinuitySectionCache<TrendingCachePayload>(sectionKey, {
      region: "BR",
      language: "pt-BR",
    });
    markStage(perf, stageRef, "cache_read");

    if (cached?.payload.results?.length && (cached.status === "hit" || cached.status === "stale")) {
      const results = applyUserFeedbackScoring(cached.payload.results as Array<{
        id: number;
        media_type?: "movie" | "tv";
        popularity?: number | null;
        vote_average?: number | null;
        vote_count?: number | null;
      }>, { userId, feedbackMap, context: "trending" });
      markStage(perf, stageRef, "response_build");
      console.log("[trending/perf]", {
        cacheStatus: cached.status === "hit" ? "persistent_hit" : "persistent_stale",
        returned: cached.payload.results.length,
        external_fetch: 0,
        normalization: 0,
        db_write: 0,
        ...perf,
        total: Date.now() - totalStartedAt,
      });

      return NextResponse.json({
        ok: true,
        cacheStatus: cached.status,
        count: results.length,
        results,
      });
    }

    // ── Balloonerismm primary path ────────────────────────────────────────────
    if (isBalloonerismTrendingEnabled()) {
      try {
        const [movieResults, tvResults] = await Promise.all([
          catalogGetTrending({ mediaType: "movie", limit: TRENDING_BALLOONERISMM_LIMIT }),
          catalogGetTrending({ mediaType: "show", limit: TRENDING_BALLOONERISMM_LIMIT }),
        ]);
        markStage(perf, stageRef, "external_fetch");

        const merged = interleaveTrending(
          await hydrateCatalogResults(movieResults),
          await hydrateCatalogResults(tvResults),
        );
        markStage(perf, stageRef, "normalization");

        const validTitles = filterValidTitles(merged);

        if (validTitles.length >= TRENDING_MIN_RESULTS) {
          const withRuntime = await enrichWithRuntime(validTitles);
          markStage(perf, stageRef, "cache_tables_read");

          const results = applyUserFeedbackScoring(withRuntime, {
            userId,
            feedbackMap,
            context: "trending",
          });
          markStage(perf, stageRef, "response_build");

          void writeContinuitySectionCache({
            sectionKey,
            region: "BR",
            language: "pt-BR",
            ttlMs: TRENDING_CACHE_TTL_MS,
            payload: {
              results: withRuntime,
              generatedAt: new Date().toISOString(),
            } satisfies TrendingCachePayload,
          });

          console.log("[trending/perf]", {
            cacheStatus: "balloonerismm_primary",
            returned: results.length,
            ...perf,
            total: Date.now() - totalStartedAt,
          });

          return NextResponse.json({ ok: true, count: results.length, results });
        }

        console.log(
          `[trending] source=balloonerismm_fallback reason=${validTitles.length < TRENDING_MIN_RESULTS ? "insufficient" : "empty"}`
        );
      } catch (err) {
        console.warn(
          "[trending] source=balloonerismm_fallback reason=error",
          err instanceof Error ? err.message : err
        );
        markStage(perf, stageRef, "external_fetch");
      }
    }

    // ── Legacy TMDB path (fallback) ──────────────────────────────────────────
    const data = await withTimeout(
      tmdbFetch<{ results: TmdbTitleSummary[] }>("/trending/all/week", {
        params: { page: 1 },
      }),
      TRENDING_EXTERNAL_TIMEOUT_MS,
      { results: [] },
    );
    markStage(perf, stageRef, "external_fetch");

    if (!data.results.length) {
      markStage(perf, stageRef, "response_build");
      console.log("[trending/perf]", {
        cacheStatus: "miss_empty_fallback",
        returned: 0,
        normalization: 0,
        db_write: 0,
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json({ ok: true, count: 0, results: [] });
    }

    const titles = filterValidTitles(
      data.results.map((item) => normalizeTmdbTitle(item))
    );
    markStage(perf, stageRef, "normalization");

    type CachedRuntimeRow = {
      tmdb_id: number;
      media_type: "movie" | "tv";
      runtime: number | null;
      episode_run_time: number[] | null;
    };

    const runtimeMap = new Map(
      ([] as CachedRuntimeRow[]).map((row) => [
        `${row.media_type}-${row.tmdb_id}`,
        row,
      ])
    );
    const tvIds = titles
      .filter((title) => title.media_type === "tv")
      .map((title) => title.tmdb_id);
    const episodeRuntimesBySeries =
      tvIds.length > 0
        ? await withTimeout(getSeriesEpisodeRuntimesMap(tvIds), TRENDING_DB_TIMEOUT_MS, new Map())
        : new Map();
    markStage(perf, stageRef, "cache_tables_read");

    const withRuntime = titles.map((title) => {
      const cached = runtimeMap.get(`${title.media_type}-${title.tmdb_id}`);
      const runtimeResolution = resolveRuntimeByMediaType({
        mediaType: title.media_type,
        runtimeMinutes: cached?.runtime ?? title.runtime ?? null,
        episodeRunTime: cached?.episode_run_time ?? title.episode_run_time ?? null,
        episodes: episodeRuntimesBySeries.get(title.tmdb_id) ?? null,
      });
      const runtimeLabel =
        title.media_type === "tv"
          ? formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
              estimated: runtimeResolution.estimated,
            })
          : formatRuntimeLabel(runtimeResolution.minutes, {
              estimated: runtimeResolution.estimated,
            });

      return {
        ...title,
        id: title.tmdb_id,
        runtime: runtimeResolution.minutes,
        runtime_label: runtimeLabel,
      };
    });

    const results = applyUserFeedbackScoring(withRuntime, {
      userId,
      feedbackMap,
      context: "trending",
    });
    markStage(perf, stageRef, "response_build");

    void writeContinuitySectionCache({
      sectionKey,
      region: "BR",
      language: "pt-BR",
      ttlMs: TRENDING_CACHE_TTL_MS,
      payload: {
        results: withRuntime,
        generatedAt: new Date().toISOString(),
      } satisfies TrendingCachePayload,
    });
    perf.db_write = 0;

    console.log("[trending/perf]", {
      cacheStatus: "persistent_miss",
      returned: results.length,
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json({ ok: true, count: results.length, results });
  } catch (error) {
    console.error("[trending route]", error);
    console.log("[trending/perf]", {
      cacheStatus: "error_empty_fallback",
      returned: 0,
      ...perf,
      total: Date.now() - totalStartedAt,
    });
    return NextResponse.json({
      ok: true,
      count: 0,
      results: [],
      skipped: "error_fallback",
    });
  }
}
