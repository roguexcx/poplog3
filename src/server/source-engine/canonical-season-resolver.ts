/**
 * Canonical season resolver — Trakt.tv como única fonte de episódios/temporadas.
 * Retorna dados em pt-BR via extended=full,translations&translations=pt do Trakt.
 *
 * Entry point: resolveCanonicalSeason({ imdbId, seasonNumber })
 */

import { traktAdapter } from "./adapters/trakt-adapter";
import type { CatalogEpisode, CatalogSeason } from "./types/catalog.types";
import { mergeEpisodeSources, type MergedCatalogEpisode } from "./merge/episode-merge";

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
  // Trakt's episode_count is the authoritative total — it knows about all episodes including
  // ones not yet in TVDB or Balloonerismm. Use it so the DB stores the correct count and
  // cachedSeasonProblem can detect episode_count_mismatch on future re-fetches.
  const episodeCount = trakt?.episodeCount ?? tvdb?.episodeCount ?? (episodes.length || null);
  return {
    number,
    title: tvdb?.title ?? trakt?.title ?? null,
    posterPath: tvdb?.posterPath ?? null, // Trakt never has season posters
    airDate: episodes.find((ep) => ep.firstAired)?.firstAired ?? null,
    episodeCount,
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
  const { imdbId } = params;

  console.log("[canonical-season] resolvendo temporada via Trakt", {
    seasonNumber,
    imdbId: imdbId ? `${imdbId.slice(0, 4)}...` : null,
  });

  // ── Phase 1: Trakt only (canonical source for season/episode data) ───────────
  // TVDB and Balloonerismm are disabled — Trakt is authoritative for episodes/seasons.
  // Trakt provides pt-BR translations inline via extended=full,translations&translations=pt.

  const traktEpisodes = imdbId
    ? await traktAdapter.getEpisodes({ imdbId, season: seasonNumber }).catch((err) => {
        console.warn("[canonical-season] Trakt getEpisodes erro:", (err as Error)?.message);
        return [] as CatalogEpisode[];
      })
    : [];

  const filteredTrakt = traktEpisodes.filter((ep) => ep.season === seasonNumber && ep.number > 0);
  const hasTrakt = filteredTrakt.length > 0;

  if (hasTrakt) {
    const merged = localizeMergedEpisodes(mergeEpisodeSources([], filteredTrakt, []));
    const seasonMeta = buildSeasonMeta(null, null, seasonNumber, merged);

    const mergedFrom = ["trakt"];

    console.log("[canonical-season] trakt completo", {
      seasonNumber,
      imdbId,
      traktEps: filteredTrakt.length,
      mergedEps: merged.length,
      epNums: merged.map((ep) => ep.number),
      ptBrEps: filteredTrakt.filter((ep) => /^(pt|por)/i.test(ep.textLanguage ?? "")).length,
    });

    return {
      season: seasonMeta,
      episodes: merged,
      sources: { tvdb: false, trakt: true, balloonerismm: false },
      mergedFrom,
      hasData: true,
      resolvedTvdbId: null,
      tvdbIdResolutionMethod: "none",
    };
  }

  // ── No data ────────────────────────────────────────────────────────────────

  console.warn("[canonical-season] Trakt sem dados", { seasonNumber, imdbId });

  return {
    season: { number: seasonNumber, title: null, posterPath: null, airDate: null, episodeCount: null },
    episodes: [],
    sources: { tvdb: false, trakt: false, balloonerismm: false },
    mergedFrom: [],
    hasData: false,
    resolvedTvdbId: null,
    tvdbIdResolutionMethod: "none",
  };
}
