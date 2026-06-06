/**
 * Canonical season resolver — fetches season/episode data from TVDB + Trakt in
 * parallel, merges the results, and falls back to Balloonerismm only when both fail.
 *
 * This replaces the sequential TVDB → Trakt → Balloonerismm fallback chain with a
 * parallel merge strategy: no source's data is discarded because another source
 * responded first. TVDB contributes stills and episode structure; Trakt contributes
 * precise air dates and cross-IDs; Balloonerismm covers titles with no TVDB/Trakt data.
 *
 * Entry point: resolveCanonicalSeason({ tvdbId, imdbId, seasonNumber })
 */

import { tvdbAdapter, findTvdbSeriesByRemoteId } from "./adapters/tvdb-adapter";
import { traktAdapter } from "./adapters/trakt-adapter";
import type { CatalogEpisode, CatalogSeason } from "./types/catalog.types";
import { mergeEpisodeSources, type MergedCatalogEpisode } from "./merge/episode-merge";
import { balloonerismAdapter } from "./adapters/balloonerismm-adapter";

// ── Types ──────────────────────────────────────────────────────────────────────

export type CanonicalSeasonSources = {
  tvdb: boolean;
  trakt: boolean;
  balloonerismm: boolean;
};

export type CanonicalSeasonMeta = {
  number: number;
  title: string | null;
  posterPath: string | null;
  airDate: string | null;
  episodeCount: number | null;
};

export type CanonicalSeasonResult = {
  /** Merged season-level metadata (poster from TVDB; title from TVDB ?? Trakt). */
  season: CanonicalSeasonMeta;
  /** Deduplicated, merged episode list sorted by number. */
  episodes: MergedCatalogEpisode[];
  /** Which sources contributed data to this result. */
  sources: CanonicalSeasonSources;
  /** Source names that contributed at least one episode (used for headers/debug). */
  mergedFrom: string[];
  /** True when any source returned usable episode or season data. */
  hasData: boolean;
  /**
   * TVDB series ID used for this resolution.
   * Non-null when TVDB contributed data OR was discovered via remoteid lookup.
   * Callers can persist this to titleExternalId when it was not already in the DB.
   */
  resolvedTvdbId: number | null;
  /** How the TVDB ID was obtained. */
  tvdbIdResolutionMethod: "known" | "remoteid" | "title_search" | "none";
};

// ── Internal helpers ───────────────────────────────────────────────────────────

function buildSeasonMeta(
  tvdb: CatalogSeason | null,
  trakt: CatalogSeason | null,
  number: number,
  episodes: MergedCatalogEpisode[],
): CanonicalSeasonMeta {
  return {
    number,
    title: tvdb?.title ?? trakt?.title ?? null,
    posterPath: tvdb?.posterPath ?? null, // Trakt never has season posters
    airDate: episodes.find((ep) => ep.firstAired)?.firstAired ?? null,
    episodeCount: episodes.length || null,
  };
}

function isPortugueseLanguage(language?: string | null): boolean {
  return /^(pt|por)(-|_|$)/i.test(language ?? "");
}

function looksPortugueseText(text?: string | null): boolean {
  if (!text) return false;
  const normalized = ` ${text.toLowerCase()} `;
  return /[ãõáéíóúâêôç]/i.test(text) || [
    " de ",
    " da ",
    " do ",
    " que ",
    " uma ",
    " para ",
    " com ",
    " seu ",
    " sua ",
    " episódio ",
    " série ",
  ].some((signal) => normalized.includes(signal));
}

function placeholderTitleInPortuguese(title: string): string | null {
  const match = title.match(/^Episode(?: #\d+\.)? ?(\d+)$/i);
  return match ? `Episódio ${match[1]}` : null;
}

export function fixedEpisodeTitleInPortuguese(title: string): string | null {
  const normalized = title.trim().toLowerCase();
  if (normalized === "pilot") return "Piloto";
  if (normalized === "finale") return "Finale";
  return placeholderTitleInPortuguese(title);
}

function shouldMachineTranslateEpisodeTitle(title?: string | null): boolean {
  if (!title) return false;
  // Only translate well-known placeholder patterns: "Episode N", "Pilot", "Finale".
  // Arbitrary multi-word titles (e.g. episode names) must NOT be machine-translated —
  // they can be proper nouns, idioms, or franchise names where literal translation is wrong.
  return fixedEpisodeTitleInPortuguese(title) !== null;
}

function localizeMergedEpisodes(episodes: MergedCatalogEpisode[]): MergedCatalogEpisode[] {
  return episodes.map((episode) => {
    const titleIsPt = isPortugueseLanguage(episode.titleLanguage ?? episode.textLanguage) && looksPortugueseText(episode.title);
    // Only replace placeholder titles (e.g. "Episode 1" → "Episódio 1", "Pilot" → "Piloto").
    // Episode overviews and arbitrary titles must NOT be machine-translated — PT-BR content must
    // come from API sources (TVDB /por endpoint, Balloonerismm language=pt-BR).
    if (titleIsPt || !shouldMachineTranslateEpisodeTitle(episode.title)) return episode;

    const fixedTitle = episode.title ? fixedEpisodeTitleInPortuguese(episode.title) : null;
    if (!fixedTitle) return episode;

    return {
      ...episode,
      title: fixedTitle,
      originalTitle: episode.originalTitle ?? episode.title,
      titleLanguage: "pt-BR",
      textLanguage: episode.textLanguage ?? "pt-BR",
    };
  });
}

// ── Main resolver ──────────────────────────────────────────────────────────────

/**
 * Resolves canonical season data.
 *
 * Phase 1 (parallel): TVDB + Trakt + Balloonerismm fetched simultaneously and merged.
 *
 * Logs a dev-mode summary of each phase with episode counts per source.
 */
export async function resolveCanonicalSeason(params: {
  tvdbId?: number | null;
  imdbId?: string | null;
  seasonNumber: number;
  /** Série title — usado como fallback para descoberta via busca quando todos IDs faltam */
  title?: string | null;
  /** Ano de estreia — melhora precisão do match na busca por título */
  year?: number | null;
}): Promise<CanonicalSeasonResult> {
  const { seasonNumber } = params;
  let { imdbId } = params;
  let tvdbId = params.tvdbId ?? null;

  // ── ID discovery: tenta resolver imdbId + tvdbId quando ausentes ──────────
  //
  // Ordem de tentativas:
  //   1. TVDB remoteid lookup (rápido, se imdbId já disponível)
  //   2. Trakt /search/tmdb cross-reference (se tmdbId ou title disponível, via aliases)
  //      → já foi feito no caller (resolveAndMergeExternalIdsForPoplogTitle)
  //   3. TVDB text search por título (último recurso, só se imdbId ainda null)
  //
  // O caller (season route, hydrate route) já passou pelos passos 1-2 via
  // resolveAndMergeExternalIdsForPoplogTitle. O passo 3 é exclusivo do resolver.

  let tvdbIdResolutionMethod: "known" | "remoteid" | "title_search" | "none" =
    tvdbId ? "known" : "none";

  // Step 1: TVDB remoteid lookup usando imdbId
  if (!tvdbId && imdbId) {
    try {
      const discovered = await findTvdbSeriesByRemoteId(imdbId);
      if (discovered) {
        tvdbId = discovered;
        tvdbIdResolutionMethod = "remoteid";
        console.log("[canonical-season] TVDB ID via remoteid", { imdbId, tvdbId, seasonNumber });
      }
    } catch (err) {
      console.warn("[canonical-season] TVDB remoteid falhou", {
        imdbId,
        error: (err as Error)?.message,
      });
    }
  }

  // Step 3: TVDB + Trakt text search — último recurso quando TUDO falta
  if (!tvdbId && !imdbId && params.title) {
    try {
      const { discoverTvSeriesIdsByTitle } = await import("@/server/titles/discover-series-ids");
      const found = await discoverTvSeriesIdsByTitle(params.title, params.year);
      if (found?.tvdbId || found?.imdbId) {
        tvdbId = found.tvdbId ?? tvdbId;
        imdbId = found.imdbId ?? imdbId;
        tvdbIdResolutionMethod = "title_search";
        console.log("[canonical-season] IDs descobertos via title search", {
          title: params.title,
          year: params.year,
          tvdbId,
          imdbId,
        });
      }
    } catch (err) {
      console.warn("[canonical-season] title search falhou", {
        title: params.title,
        error: (err as Error)?.message,
      });
    }
  }

  console.log("[canonical-season] resolvendo temporada", {
    seasonNumber,
    tvdbId,
    tvdbIdResolutionMethod,
    imdbId: imdbId ? `${imdbId.slice(0, 4)}...` : null,
  });

  // ── Phase 1: TVDB + Trakt in parallel ─────────────────────────────────────

  const [tvdbSeasons, tvdbEpisodes, traktSeasons, traktEpisodes, balloonSeasons, balloonEpisodes] = await Promise.all([
    tvdbId
      ? tvdbAdapter.getSeasons({ tvdbId, season: seasonNumber }).catch((err) => {
          console.warn("[canonical-season] TVDB getSeasons erro:", (err as Error)?.message);
          return [] as CatalogSeason[];
        })
      : Promise.resolve([] as CatalogSeason[]),

    tvdbId
      ? tvdbAdapter.getEpisodes({ tvdbId, season: seasonNumber }).catch((err) => {
          console.warn("[canonical-season] TVDB getEpisodes erro:", (err as Error)?.message);
          return [] as CatalogEpisode[];
        })
      : Promise.resolve([] as CatalogEpisode[]),

    imdbId
      ? traktAdapter.getSeasons({ imdbId, season: seasonNumber }).catch((err) => {
          console.warn("[canonical-season] Trakt getSeasons erro:", (err as Error)?.message);
          return [] as CatalogSeason[];
        })
      : Promise.resolve([] as CatalogSeason[]),

    imdbId
      ? traktAdapter.getEpisodes({ imdbId, season: seasonNumber }).catch((err) => {
          console.warn("[canonical-season] Trakt getEpisodes erro:", (err as Error)?.message);
          return [] as CatalogEpisode[];
        })
      : Promise.resolve([] as CatalogEpisode[]),

    imdbId
      ? balloonerismAdapter.getSeasons({ imdbId, season: seasonNumber }).catch((err) => {
          console.warn("[canonical-season] Balloonerismm getSeasons erro real:", {
            seasonNumber,
            imdbId,
            error: (err as Error)?.message,
          });
          return [] as CatalogSeason[];
        })
      : Promise.resolve([] as CatalogSeason[]),

    imdbId
      ? balloonerismAdapter.getEpisodes({ imdbId, season: seasonNumber }).catch((err) => {
          console.warn("[canonical-season] Balloonerismm getEpisodes erro real:", {
            seasonNumber,
            imdbId,
            error: (err as Error)?.message,
          });
          return [] as CatalogEpisode[];
        })
      : Promise.resolve([] as CatalogEpisode[]),
  ]);

  const tvdbSeason = tvdbSeasons.find((s) => s.number === seasonNumber) ?? null;
  const traktSeason = traktSeasons.find((s) => s.number === seasonNumber) ?? null;
  const balloonSeason = balloonSeasons.find((s) => s.number === seasonNumber) ?? null;

  const filteredTvdb = tvdbEpisodes.filter((ep) => ep.season === seasonNumber && ep.number > 0);
  const filteredTrakt = traktEpisodes.filter((ep) => ep.season === seasonNumber && ep.number > 0);
  const filteredBalloon = balloonEpisodes.filter((ep) => ep.season === seasonNumber && ep.number > 0);

  const hasTvdb = Boolean(tvdbSeason || filteredTvdb.length > 0);
  const hasTrakt = Boolean(traktSeason || filteredTrakt.length > 0);
  const hasBalloon = Boolean(balloonSeason || filteredBalloon.length > 0);

  if (hasTvdb || hasTrakt || hasBalloon) {
    // TVDB = priority 0 (official stills, episode structure)
    // Trakt = priority 1 (fills gaps, better air dates, cross-IDs, images when available)
    // Balloonerismm = priority 2 for structure, but its pt-BR text can win in resolveEpisodeText.
    const merged = localizeMergedEpisodes(mergeEpisodeSources(filteredTvdb, filteredTrakt, filteredBalloon));
    const seasonMeta = buildSeasonMeta(tvdbSeason, traktSeason, seasonNumber, merged);
    if (!seasonMeta.title && balloonSeason?.title) seasonMeta.title = balloonSeason.title;
    if (!seasonMeta.posterPath && balloonSeason?.posterPath) seasonMeta.posterPath = balloonSeason.posterPath;

    const mergedFrom = [
      ...(filteredTvdb.length > 0 || tvdbSeason ? ["tvdb"] : []),
      ...(filteredTrakt.length > 0 || traktSeason ? ["trakt"] : []),
      ...(filteredBalloon.length > 0 || balloonSeason ? ["balloonerismm"] : []),
    ];

    console.log("[canonical-season] fase 1 completa", {
      seasonNumber,
      tvdbId,
      imdbId,
      tvdbEps: filteredTvdb.length,
      traktEps: filteredTrakt.length,
      balloonEps: filteredBalloon.length,
      mergedEps: merged.length,
      stillsBySource: {
        tvdb: filteredTvdb.filter((ep) => ep.stillUrl || ep.stillPath).length,
        trakt: filteredTrakt.filter((ep) => ep.stillUrl || ep.stillPath).length,
        balloonerismm: filteredBalloon.filter((ep) => ep.stillUrl || ep.stillPath).length,
      },
      ptBrTextsBySource: {
        tvdb: filteredTvdb.filter((ep) => /^(pt|por)/i.test(ep.textLanguage ?? "")).length,
        trakt: filteredTrakt.filter((ep) => /^(pt|por)/i.test(ep.textLanguage ?? "")).length,
        balloonerismm: filteredBalloon.filter((ep) => /^(pt|por)/i.test(ep.textLanguage ?? "")).length,
      },
      mergedFrom,
    });

    return {
      season: seasonMeta,
      episodes: merged,
      sources: { tvdb: hasTvdb, trakt: hasTrakt, balloonerismm: hasBalloon },
      mergedFrom,
      hasData: true,
      resolvedTvdbId: tvdbId,
      tvdbIdResolutionMethod,
    };
  }

  // ── No data ────────────────────────────────────────────────────────────────

  console.warn("[canonical-season] sem dados em nenhuma fonte", {
    seasonNumber,
    tvdbId,
    imdbId,
  });

  return {
    season: { number: seasonNumber, title: null, posterPath: null, airDate: null, episodeCount: null },
    episodes: [],
    sources: { tvdb: false, trakt: false, balloonerismm: false },
    mergedFrom: [],
    hasData: false,
    resolvedTvdbId: tvdbId,
    tvdbIdResolutionMethod,
  };
}
