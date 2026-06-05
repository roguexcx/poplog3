import { NextRequest, NextResponse } from "next/server";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
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
import {
  hydrateCatalogResultsWithDebug,
  resolveCatalogIdentityFields,
} from "@/server/source-engine/hydrate-catalog-results";
import type { PoplogTitle } from "@/server/types/title";
import { db } from "@/server/db/client";

const TRENDING_CACHE_TTL_MS = 30 * 60_000;
const TRENDING_DB_TIMEOUT_MS = 1_500;
const TRENDING_AUTH_TIMEOUT_MS = 500;
const TRENDING_BALLOONERISMM_LIMIT = 15;
const TRENDING_MIN_RESULTS = 5;
const TRENDING_LOCAL_FALLBACK_LIMIT = 20;

async function fetchLocalTrending(): Promise<PoplogTitle[]> {
  try {
    const rows = await db.poplog3Title.findMany({
      where: { posterPath: { not: null } },
      orderBy: { popularity: "desc" },
      take: TRENDING_LOCAL_FALLBACK_LIMIT,
      select: {
        id: true,
        tmdbId: true,
        mediaType: true,
        title: true,
        originalTitle: true,
        overview: true,
        posterPath: true,
        backdropPath: true,
        releaseDate: true,
        firstAirDate: true,
        lastAirDate: true,
        year: true,
        runtime: true,
        episodeRunTime: true,
        genres: true,
        popularity: true,
        voteAverage: true,
        voteCount: true,
        originalLanguage: true,
      },
    });

    return rows.map((row) => ({
      tmdb_id: row.tmdbId,
      media_type: row.mediaType as "movie" | "tv",
      title: row.title ?? row.originalTitle ?? "",
      original_title: row.originalTitle ?? null,
      overview: row.overview ?? null,
      poster_path: row.posterPath ?? null,
      backdrop_path: row.backdropPath ?? null,
      release_date: row.mediaType === "movie" ? (row.releaseDate?.toISOString().slice(0, 10) ?? null) : null,
      first_air_date: row.mediaType === "tv" ? (row.firstAirDate?.toISOString().slice(0, 10) ?? null) : null,
      last_air_date: row.mediaType === "tv" ? (row.lastAirDate?.toISOString().slice(0, 10) ?? null) : null,
      year: row.year ?? null,
      runtime: row.mediaType === "movie" ? row.runtime ?? null : null,
      episode_run_time: row.mediaType === "tv" ? (Array.isArray(row.episodeRunTime) ? row.episodeRunTime as number[] : null) : null,
      genres: Array.isArray(row.genres) ? (row.genres as number[]) : [],
      popularity: row.popularity != null ? Number(row.popularity) : null,
      vote_average: row.voteAverage != null ? Number(row.voteAverage) : null,
      vote_count: row.voteCount ?? null,
      original_language: row.originalLanguage ?? null,
      imdb_id: undefined,
      poplogId: row.id,
      externalIds: { tmdbId: row.tmdbId },
      ...resolveCatalogIdentityFields({ tmdb_id: row.tmdbId, media_type: row.mediaType as "movie" | "tv", poplogId: row.id }, "legacy"),
      normalizedFrom: "legacy" as const,
    }));
  } catch {
    return [];
  }
}

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
      ...resolveCatalogIdentityFields(title, title.normalizedFrom === "cache-fuzzy" ? "cache-fuzzy" : "balloonerismm"),
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

export async function GET(request: NextRequest) {
  const debugSource = request.nextUrl.searchParams.get("debugSource") === "1";
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
        ...(debugSource
          ? {
              debugSource: {
                source: "cache",
                fallbackUsed: false,
                usedTmdbApi: false,
                usedLegacy: false,
                normalizedFrom: "continuity_section_cache",
                identityUsed: "cached_payload",
                legacyCompatibilityUsed: true,
                cacheStatus: cached.status,
              },
            }
          : {}),
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

        const [movieHydrated, tvHydrated] = await Promise.all([
          hydrateCatalogResultsWithDebug(movieResults),
          hydrateCatalogResultsWithDebug(tvResults),
        ]);
        const merged = interleaveTrending(movieHydrated.titles, tvHydrated.titles);
        const balloonerismmDebug = {
          source: "balloonerismm",
          rawCount: movieHydrated.debug.rawCount + tvHydrated.debug.rawCount,
          normalizedCount:
            movieHydrated.debug.normalizedCount + tvHydrated.debug.normalizedCount,
          poplogResolvedCount:
            movieHydrated.debug.poplogResolvedCount + tvHydrated.debug.poplogResolvedCount,
          searchCompatibleCount:
            movieHydrated.debug.searchCompatibleCount + tvHydrated.debug.searchCompatibleCount,
          fallbackUsed: false,
          fallbackReason: null as string | null,
          usedTmdbApi: false,
          normalizedFrom: "balloonerismm",
          identityUsed: "poplog_id_or_best_alias",
          legacyCompatibilityUsed: true,
          externalIdStats: {
            imdbId:
              movieHydrated.debug.externalIdStats.imdbId + tvHydrated.debug.externalIdStats.imdbId,
            tmdbId:
              movieHydrated.debug.externalIdStats.tmdbId + tvHydrated.debug.externalIdStats.tmdbId,
            tvdbId:
              movieHydrated.debug.externalIdStats.tvdbId + tvHydrated.debug.externalIdStats.tvdbId,
            traktId:
              movieHydrated.debug.externalIdStats.traktId + tvHydrated.debug.externalIdStats.traktId,
            balloonerismmId:
              movieHydrated.debug.externalIdStats.balloonerismmId +
              tvHydrated.debug.externalIdStats.balloonerismmId,
            slug:
              movieHydrated.debug.externalIdStats.slug + tvHydrated.debug.externalIdStats.slug,
            poplogResolved:
              movieHydrated.debug.externalIdStats.poplogResolved +
              tvHydrated.debug.externalIdStats.poplogResolved,
            temporaryCandidates:
              movieHydrated.debug.externalIdStats.temporaryCandidates +
              tvHydrated.debug.externalIdStats.temporaryCandidates,
          },
        };
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

          return NextResponse.json({
            ok: true,
            count: results.length,
            results,
            ...(debugSource ? { debugSource: balloonerismmDebug } : {}),
          });
        }

        balloonerismmDebug.fallbackUsed = true;
        balloonerismmDebug.fallbackReason =
          validTitles.length < TRENDING_MIN_RESULTS ? "insufficient" : "empty";
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

    // ── Local DB fallback ─────────────────────────────────────────────────────
    const localTitles = await withTimeout(
      fetchLocalTrending(),
      TRENDING_DB_TIMEOUT_MS,
      [],
    );
    const localValid = filterValidTitles(localTitles);
    markStage(perf, stageRef, "local_fallback");

    if (localValid.length > 0) {
      const withRuntime = await enrichWithRuntime(localValid);
      const results = applyUserFeedbackScoring(withRuntime, {
        userId,
        feedbackMap,
        context: "trending",
      });
      markStage(perf, stageRef, "response_build");

      console.log("[trending/perf]", {
        cacheStatus: "local_db_fallback",
        returned: results.length,
        ...perf,
        total: Date.now() - totalStartedAt,
      });

      return NextResponse.json({
        ok: true,
        count: results.length,
        results,
        ...(debugSource
          ? {
              debugSource: {
                source: "local_db",
                fallbackUsed: true,
                fallbackReason: "balloonerismm_insufficient_or_failed",
                usedTmdbApi: false,
                usedLegacy: false,
                normalizedFrom: "legacy",
                identityUsed: "poplog_id",
                legacyCompatibilityUsed: true,
              },
            }
          : {}),
      });
    }

    markStage(perf, stageRef, "response_build");

    console.log("[trending/perf]", {
      cacheStatus: "all_sources_empty",
      returned: 0,
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json({
      ok: true,
      count: 0,
      results: [],
      ...(debugSource
        ? {
            debugSource: {
              source: "unavailable",
              fallbackUsed: true,
              fallbackReason: "all_sources_empty",
              usedTmdbApi: false,
              usedLegacy: false,
              normalizedFrom: "none",
              identityUsed: "none",
              legacyCompatibilityUsed: true,
            },
          }
        : {}),
    });
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
