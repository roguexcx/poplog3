import { NextRequest, NextResponse } from "next/server";

import { withOrigin } from "@/server/engine-logger";
import { getCachedSeason } from "@/server/cache/season-cache";
import { resolvePoplogTitleIdentity } from "@/server/titles/poplog-title-identity";
import { getPoplogTitleDetails } from "@/server/titles/poplog-title-details";
import { normalizeSearchTerm } from "@/server/search/fuzzy-title-search";
import { db } from "@/server/db/client";
import { imdbIdFromSyntheticTmdbId, syntheticTmdbFromImdbId } from "@/lib/ids/synthetic-tmdb-id";
import { resolveCanonicalSeason } from "@/server/source-engine/canonical-season-resolver";
import type { PoplogTitleExternalIds } from "@/server/titles/poplog-title-identity";
import type { PoplogSeason } from "@/server/types/season";
import { resolveCatalogImage } from "@/lib/images/resolve";
import { normalizeEpisodeStillUrl } from "@/server/source-engine/normalizers/normalize-episode";
import { fixedEpisodeTitleInPortuguese } from "@/server/source-engine/canonical-season-resolver";
import { upsertSeason } from "@/server/cache/season-cache";

// ── Debug source type ──────────────────────────────────────────────────────────

type SeasonSourceLabel =
  | "cache"
  | "tvdb"
  | "trakt"
  | "balloonerismm"
  | "canonical"
  | "unavailable";

type SeasonDebugSource = {
  poplogId: string | number | null;
  externalIds: PoplogTitleExternalIds;
  seriesIdentityUsed: string;
  seasonAliasLookupSource: string | null;
  seasonSource: SeasonSourceLabel;
  episodeSource: SeasonSourceLabel;
  usedTmdbApi: false;
  usedLegacy: false;
  fallbackUsed: boolean;
  fallbackReason: string | null;
  incompleteSeasonData: boolean;
  missingSeasonCache: boolean;
  alternativeSourceUnavailable: boolean;
  /** Sources that contributed to a canonical merge (populated when seasonSource="canonical"). */
  mergedFrom?: string[];
};

function createSeasonDebug(
  input: Omit<SeasonDebugSource, "usedTmdbApi" | "usedLegacy">,
): SeasonDebugSource {
  return { ...input, usedTmdbApi: false, usedLegacy: false };
}

// ── Payload builders ───────────────────────────────────────────────────────────

function seasonPayload(
  season: PoplogSeason,
  options?: {
    poplogId?: string | number | null;
    externalIds?: PoplogTitleExternalIds;
    debugSource?: SeasonDebugSource;
  },
) {
  const img = (path: string | null, size: string) => resolveCatalogImage(path, size);
  return {
    ok: true,
    seriesTmdbId: season.series_tmdb_id,
    seasonNumber: season.season_number,
    name: season.name,
    overview: season.overview,
    posterUrl: img(season.poster_path, "w342"),
    airDate: season.air_date,
    episodeCount: season.episode_count,
    voteAverage: season.vote_average,
    lastSyncedAt: season.last_synced_at,
    episodes: season.episodes.map((e) => ({
      episodeNumber: e.episode_number,
      name: e.name ? (fixedEpisodeTitleInPortuguese(e.name) ?? e.name) : e.name,
      overview: e.overview,
      stillUrl: normalizeEpisodeStillUrl(
                e.still_url,
                e.still_source as "tvdb" | "trakt" | "balloonerismm" | undefined ?? undefined,
              ) ?? img(e.still_path, "w300"),
      stillSource: e.still_source ?? null,
      stillWidth: e.still_width ?? null,
      stillHeight: e.still_height ?? null,
      stillLanguage: e.still_language ?? null,
      textLanguage: e.title_language ?? e.overview_language ?? null,
      originalTitle: e.original_title ?? null,
      originalOverview: e.original_overview ?? null,
      imageCandidates: e.image_candidates_json ?? null,
      textCandidates: e.text_candidates_json ?? null,
      airDate: e.air_date,
      runtime: e.runtime,
      voteAverage: e.vote_average,
      voteCount: e.vote_count,
      episodeType: e.episode_type,
    })),
    poplogId: options?.poplogId ?? null,
    externalIds: options?.externalIds ?? {},
    ...(options?.debugSource ? { debugSource: options.debugSource } : {}),
  };
}

function incompleteSeasonPayload(input: {
  seriesTmdbId: number | null;
  seasonNumber: number;
  poplogId: string | number | null;
  externalIds: PoplogTitleExternalIds;
  debugSource?: SeasonDebugSource;
}) {
  return {
    ok: true,
    incompleteSeasonData: true,
    seriesTmdbId: input.seriesTmdbId,
    seasonNumber: input.seasonNumber,
    name: `Temporada ${input.seasonNumber}`,
    overview: null,
    posterUrl: null,
    airDate: null,
    episodeCount: null,
    voteAverage: null,
    lastSyncedAt: null,
    episodes: [],
    poplogId: input.poplogId,
    externalIds: input.externalIds,
    ...(input.debugSource ? { debugSource: input.debugSource } : {}),
  };
}

// ── Cache validation ───────────────────────────────────────────────────────────

const PLACEHOLDER_EP_REGEX = /^Episode #\d+\.\d+$/i;
const SEASON_CACHE_MAX_AGE_DAYS = 7;

function isRecentSeasonCache(lastSyncedAt: string | null | undefined) {
  if (!lastSyncedAt) return false;
  const t = new Date(lastSyncedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return Date.now() - t <= SEASON_CACHE_MAX_AGE_DAYS * 86_400_000;
}

function cachedSeasonProblem(season: PoplogSeason): string | null {
  if (!isRecentSeasonCache(season.last_synced_at)) return "stale_cache";
  if (season.episodes.length === 0) return "empty_episode_cache";

  const hasPlaceholder = season.episodes.some((e) =>
    e.name ? PLACEHOLDER_EP_REGEX.test(e.name) : false,
  );
  if (hasPlaceholder) return "placeholder_episode_cache";

  const uniqueNums = new Set(season.episodes.map((e) => e.episode_number));
  if (uniqueNums.size !== season.episodes.length) return "duplicate_episode_cache";

  if (
    season.episode_count !== null &&
    season.episode_count > 0 &&
    season.episodes.length !== season.episode_count
  ) {
    return "episode_count_mismatch";
  }

  const now = Date.now();
  const cacheAgeMs = now - new Date(season.last_synced_at ?? 0).getTime();
  const airedEps = season.episodes.filter(
    (e) => e.air_date && new Date(e.air_date).getTime() <= now,
  );

  // Re-fetch if all aired episodes are missing stills (cache populated before stills arrived).
  const allAiredMissingStills =
    airedEps.length > 0 &&
    airedEps.every((e) => !e.still_url && !e.still_path);
  if (allAiredMissingStills && cacheAgeMs > 86_400_000) return "all_aired_episodes_missing_stills";

  // Re-fetch if all aired episodes have English-only title language (old cache without PT-BR).
  // This triggers a canonical re-fetch so TVDB /por, Trakt translations, Balloonerismm pt-BR are applied.
  const allEnglishTitles =
    airedEps.length > 0 &&
    airedEps.every((e) => e.title_language === "eng" || e.title_language === "en");
  if (allEnglishTitles && cacheAgeMs > 86_400_000) return "all_aired_episodes_english_titles";

  return null;
}

// ── Identity helpers ───────────────────────────────────────────────────────────

async function findLocalSeriesByTitleYear(title?: string | null, year?: number | null) {
  if (!title || !year) return null;
  const normalized = normalizeSearchTerm(title);
  if (!normalized) return null;

  const rows = await db.poplog3Title
    .findMany({
      where: { mediaType: "tv", year },
      select: { id: true, tmdbId: true, title: true, originalTitle: true },
      take: 80,
    })
    .catch(() => []);

  return (
    rows.find((row) => {
      const candidates = [row.title, row.originalTitle]
        .map((v) => normalizeSearchTerm(v ?? ""))
        .filter(Boolean);
      return candidates.includes(normalized);
    }) ?? null
  );
}

async function findExternalIdsByTmdbId(tmdbId: number): Promise<PoplogTitleExternalIds> {
  const row = await db.titleExternalId
    .findFirst({
      where: { mediaType: "tv", tmdbId },
      select: { imdbId: true, tvdbId: true, traktId: true },
    })
    .catch(() => null);

  if (!row) return {};
  const tvdbId = row.tvdbId ? Number(row.tvdbId) : undefined;
  return {
    tmdbId,
    imdbId: row.imdbId ?? undefined,
    tvdbId: Number.isFinite(tvdbId) ? tvdbId : undefined,
    traktId: row.traktId ?? undefined,
    balloonerismmId: row.imdbId ?? undefined,
  };
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; season: string }> },
) {
  const resolved = await params;
  const seasonNumber = Number(resolved.season);
  const showDebug = request.nextUrl.searchParams.get("debugSource") === "1";
  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("force") === "1" ||
    request.nextUrl.searchParams.get("forceRefresh") === "1";

  if (Number.isNaN(seasonNumber) || seasonNumber < 0) {
    console.warn("[poplog3/tv/season] número de temporada inválido", {
      rawSeason: resolved.season,
    });
    return NextResponse.json(
      { ok: false, error: "Invalid season number — must be >= 0" },
      { status: 400 },
    );
  }

  return withOrigin("title", async () => {
    try {
      // ── 1. Resolve identity ───────────────────────────────────────────────

      const identity = await resolvePoplogTitleIdentity({
        mediaType: "tv",
        id: resolved.id,
      });

      let seriesTmdbId = identity.externalIds.tmdbId;
      let resolvedPoplogId = identity.poplogId ?? null;
      let externalIds = identity.externalIds;
      let seasonAliasLookupSource: string | null = null;

      // If we only have an IMDb ID, attempt to enrich external IDs from local DB
      if (!seriesTmdbId && identity.externalIds.imdbId) {
        const details = await getPoplogTitleDetails({
          mediaType: "tv",
          id: identity.externalIds.imdbId,
          sourceHint: "imdb",
        }).catch(() => null);

        const localByTitle = await findLocalSeriesByTitleYear(details?.title, details?.year);
        if (localByTitle) {
          const localExt = await findExternalIdsByTmdbId(localByTitle.tmdbId);
          seriesTmdbId = localByTitle.tmdbId;
          resolvedPoplogId = localByTitle.id;
          externalIds = {
            ...externalIds,
            ...details?.externalIds,
            ...localExt,
            tmdbId: localByTitle.tmdbId,
          };
          seasonAliasLookupSource = "localTitle:titleYearFromBalloonerismm";
        } else if (details?.externalIds.tmdbId) {
          seriesTmdbId = details.externalIds.tmdbId;
          resolvedPoplogId = details.poplogId ?? resolvedPoplogId;
          externalIds = { ...externalIds, ...details.externalIds };
          seasonAliasLookupSource = "balloonerismm:externalIds";
        }
      }

      const seriesIdentityUsed = identity.poplogId
        ? "poplog_id"
        : identity.externalIds.imdbId
          ? "imdb_id"
          : seriesTmdbId
            ? "tmdb_id_alias"
            : identity.externalIds.slug
              ? "slug"
              : "unknown";

      // Derive a synthetic tmdbId from imdbId so upsertSeason can cache with a
      // deterministic key for Balloonerismm-only titles without a real TMDB mapping.
      if (!seriesTmdbId) {
        const synthetic = externalIds.imdbId
          ? syntheticTmdbFromImdbId(externalIds.imdbId)
          : null;

        if (!synthetic) {
          const debug = createSeasonDebug({
            poplogId: resolvedPoplogId,
            externalIds,
            seriesIdentityUsed,
            seasonAliasLookupSource,
            seasonSource: "unavailable",
            episodeSource: "unavailable",
            fallbackUsed: true,
            fallbackReason: "missing_local_season_cache",
            incompleteSeasonData: true,
            missingSeasonCache: true,
            alternativeSourceUnavailable: true,
          });
          return NextResponse.json(
            incompleteSeasonPayload({
              seriesTmdbId: null,
              seasonNumber,
              poplogId: resolvedPoplogId,
              externalIds,
              debugSource: showDebug ? debug : undefined,
            }),
          );
        }

        seriesTmdbId = synthetic;
        console.log("[poplog3/tv/season] synthetic tmdbId derivado do imdbId", {
          imdbId: externalIds.imdbId,
          syntheticTmdbId: seriesTmdbId,
        });
      }

      console.log("[poplog3/tv/season] identidade resolvida", {
        requestedId: resolved.id,
        poplogId: resolvedPoplogId,
        seriesTmdbId,
        seasonNumber,
        externalIds: { tvdbId: externalIds.tvdbId, imdbId: externalIds.imdbId },
        refresh,
      });

      // ── 2. Cache check ────────────────────────────────────────────────────

      const cached = !refresh ? await getCachedSeason(seriesTmdbId, seasonNumber) : null;
      const cachedProblem = cached ? cachedSeasonProblem(cached) : null;

      if (cached && !cachedProblem) {
        const debug = createSeasonDebug({
          poplogId: resolvedPoplogId,
          externalIds,
          seriesIdentityUsed,
          seasonAliasLookupSource,
          seasonSource: "cache",
          episodeSource: "cache",
          fallbackUsed: false,
          fallbackReason: null,
          incompleteSeasonData: cached.episodes.length === 0,
          missingSeasonCache: false,
          alternativeSourceUnavailable: false,
        });
        return NextResponse.json(
          seasonPayload(cached, {
            poplogId: resolvedPoplogId,
            externalIds,
            debugSource: showDebug ? debug : undefined,
          }),
          { headers: { "x-poplog-source": "cache", "x-poplog-cache": "fresh" } },
        );
      }

      if (cachedProblem) {
        console.warn("[poplog3/tv/season] cache ignorado, reidratando", {
          seriesTmdbId,
          seasonNumber,
          cachedProblem,
          lastSyncedAt: cached?.last_synced_at,
        });
      }

      // ── 3. Canonical resolution (TVDB + Trakt parallel, Balloonerismm fallback) ──

      // IMDb ID needed by Trakt and Balloonerismm; may be derivable from synthetic key
      const resolverImdbId =
        externalIds.imdbId ??
        (typeof seriesTmdbId === "number" && seriesTmdbId < 0
          ? imdbIdFromSyntheticTmdbId(seriesTmdbId)
          : null);

      const canonical = await resolveCanonicalSeason({
        tvdbId: externalIds.tvdbId ?? null,
        imdbId: resolverImdbId,
        seasonNumber,
        title: identity.title,
        year: identity.year,
      });

      // ── Persist newly-discovered TVDB ID for all future requests ──────────
      // When the resolver found a TVDB ID via remote ID lookup (not in our DB),
      // we write it back so subsequent requests use it directly without an extra API call.
      // This is the global self-healing path: works for any series, not just re-hydrations.
      if (
        canonical.tvdbIdResolutionMethod === "remoteid" &&
        canonical.resolvedTvdbId &&
        seriesTmdbId &&
        !externalIds.tvdbId
      ) {
        const discoveredTvdbId = canonical.resolvedTvdbId;
        void db.titleExternalId
          .upsert({
            where: { tmdbId_mediaType: { tmdbId: seriesTmdbId, mediaType: "tv" } },
            update: { tvdbId: String(discoveredTvdbId) },
            create: {
              tmdbId: seriesTmdbId,
              mediaType: "tv",
              tvdbId: String(discoveredTvdbId),
              imdbId: resolverImdbId ?? undefined,
            },
          })
          .then(() => {
            console.log("[poplog3/tv/season] TVDB ID persistido no DB", {
              seriesTmdbId,
              tvdbId: discoveredTvdbId,
              imdbId: resolverImdbId,
            });
          })
          .catch((e: Error) =>
            console.warn("[poplog3/tv/season] falha ao persistir tvdbId", e.message),
          );
      }

      if (canonical.hasData) {
        const { season, episodes, sources, mergedFrom } = canonical;

        // Source label for headers/debug: "canonical" when multiple sources merged
        const sourceLabel: SeasonSourceLabel =
          mergedFrom.length > 1
            ? "canonical"
            : (mergedFrom[0] as SeasonSourceLabel | undefined) ?? "unavailable";

        const fallbackReason =
          !sources.tvdb && !sources.trakt
            ? externalIds.tvdbId
              ? "tvdb_no_data_trakt_also_empty"
              : "no_tvdb_id_trakt_also_empty"
            : !sources.tvdb
              ? externalIds.tvdbId
                ? "tvdb_no_data"
                : "no_tvdb_id"
              : null;

        const debug = createSeasonDebug({
          poplogId: resolvedPoplogId,
          externalIds,
          seriesIdentityUsed,
          seasonAliasLookupSource,
          seasonSource: sourceLabel,
          episodeSource: sourceLabel,
          fallbackUsed: !sources.tvdb || !sources.trakt,
          fallbackReason,
          incompleteSeasonData: episodes.length === 0,
          missingSeasonCache: true,
          alternativeSourceUnavailable: false,
          mergedFrom,
        });

        // Persist canonical result so markAllAiredEpisodes / computeUserSeriesProgress work
        await upsertSeason({
          seriesTmdbId,
          seasonNumber,
          tmdbSeasonId: null,
          name: season.title,
          overview: null,
          posterPath: season.posterPath,
          airDate: season.airDate,
          episodeCount: season.episodeCount,
          voteAverage: null,
          tmdbPayload: null,
          episodes: episodes.map((ep) => ({
            episodeNumber: ep.number,
            tmdbEpisodeId: ep.ids.tmdbId ?? null,
            name: ep.title ?? null,
            overview: ep.overview ?? null,
            stillPath: ep.stillPath ?? null,
            stillUrl: ep.stillUrl ?? ep.stillPath ?? null,
            stillSource: ep.stillSource ?? null,
            stillWidth: ep.stillWidth ?? null,
            stillHeight: ep.stillHeight ?? null,
            stillLanguage: ep.stillLanguage ?? null,
            airDate: ep.firstAired ?? null,
            runtime: ep.runtime ?? null,
            voteAverage: null,
            voteCount: null,
            productionCode: null,
            episodeType: null,
            absoluteNumber: ep.absoluteNumber ?? null,
            titleLanguage: ep.titleLanguage ?? ep.textLanguage ?? null,
            overviewLanguage: ep.overviewLanguage ?? ep.textLanguage ?? null,
            originalTitle: ep.originalTitle ?? null,
            originalOverview: ep.originalOverview ?? null,
            sourcePriority: ep.sourcePriority ?? ep.mergedFrom,
            imageCandidates: ep.imageCandidates ?? null,
            textCandidates: ep.textCandidates ?? null,
            // Persistir IDs externos por episódio para marcação estável e deduplicação futura
            externalIds: (ep.ids.imdbId || ep.ids.tvdbId || ep.ids.traktId || ep.ids.tmdbId)
              ? {
                  imdb: ep.ids.imdbId ?? null,
                  tvdb: ep.ids.tvdbId ?? null,
                  trakt: ep.ids.traktId ?? null,
                  tmdb: ep.ids.tmdbId ?? null,
                }
              : null,
          })),
        }).catch((err) => {
          console.warn("[season route] upsertSeason canonical falhou", err);
        });

        return NextResponse.json(
          {
            ok: true,
            seriesTmdbId,
            seasonNumber,
            name: season.title ?? `Temporada ${seasonNumber}`,
            overview: null,
            posterUrl: season.posterPath,
            airDate: season.airDate,
            episodeCount: season.episodeCount,
            voteAverage: null,
            lastSyncedAt: null,
            episodes: episodes.map((ep) => ({
              episodeNumber: ep.number,
              name: ep.title ?? null,
              overview: ep.overview ?? null,
              // stills from TVDB/Balloonerismm are full URLs; Trakt returns null
              stillUrl: ep.stillUrl ?? ep.stillPath ?? null,
              stillSource: ep.stillSource ?? null,
              stillWidth: ep.stillWidth ?? null,
              stillHeight: ep.stillHeight ?? null,
              stillLanguage: ep.stillLanguage ?? null,
              textLanguage: ep.textLanguage ?? null,
              originalTitle: ep.originalTitle ?? null,
              originalOverview: ep.originalOverview ?? null,
              imageCandidates: ep.imageCandidates ?? null,
              textCandidates: ep.textCandidates ?? null,
              airDate: ep.firstAired ?? null,
              runtime: ep.runtime ?? null,
              voteAverage: null,
              voteCount: null,
              episodeType: null,
            })),
            poplogId: resolvedPoplogId,
            externalIds,
            mergedFrom,
            ...(showDebug ? { debugSource: debug } : {}),
          },
          {
            headers: {
              "x-poplog-source": sourceLabel,
              "x-poplog-cache": "persisted",
            },
          },
        );
      }

      // ── 4. No data from any source ────────────────────────────────────────

      const debug = createSeasonDebug({
        poplogId: resolvedPoplogId,
        externalIds,
        seriesIdentityUsed,
        seasonAliasLookupSource,
        seasonSource: "unavailable",
        episodeSource: "unavailable",
        fallbackUsed: true,
        fallbackReason: externalIds.tvdbId
          ? "all_sources_empty_tvdb_present"
          : "all_sources_empty_no_tvdb",
        incompleteSeasonData: true,
        missingSeasonCache: true,
        alternativeSourceUnavailable: true,
      });

      return NextResponse.json(
        incompleteSeasonPayload({
          seriesTmdbId,
          seasonNumber,
          poplogId: resolvedPoplogId,
          externalIds,
          debugSource: showDebug ? debug : undefined,
        }),
        { headers: { "x-poplog-source": "unavailable", "x-poplog-cache": "missing" } },
      );
    } catch (error) {
      console.error("[poplog3/tv/season] erro:", error);
      return NextResponse.json(
        {
          ok: false,
          error: "Failed to fetch season",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 500 },
      );
    }
  }); // withOrigin("title")
}
