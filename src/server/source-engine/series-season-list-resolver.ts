/**
 * Series Season List Resolver
 *
 * Resolve a lista de temporadas de uma série via Trakt
 * quando o banco de dados local está vazio ou incompleto.
 *
 * Usado em getTitlePageData para preencher `seasons` quando:
 *   1. getSeasonSummariesFromDb retorna vazio
 *   2. numberOfSeasons ainda não é conhecido
 *
 * Fonte única: Trakt.
 */

import { traktAdapter } from "./adapters/trakt-adapter";
import type { CatalogSeason } from "./types/catalog.types";

export type ResolvedSeasonSummary = {
  seasonNumber: number;
  name: string | null;
  airDate: string | null;
  episodeCount: number | null;
  posterUrl: string | null;
  source: "trakt" | "count_stub";
};

/**
 * Busca a lista de temporadas no Trakt.
 * Retorna uma lista ordenada, deduplicada por número de temporada.
 * Exclui temporada 0 (especiais) por padrão — podem ser incluídas via includeSpecials.
 */
export async function resolveSeriesSeasonList(params: {
  tvdbId?: number | null;
  imdbId?: string | null;
  includeSpecials?: boolean;
}): Promise<ResolvedSeasonSummary[]> {
  const { imdbId, includeSpecials = false } = params;

  if (!imdbId) return [];

  const traktSeasons = await traktAdapter.getSeasons({ imdbId }).catch((err) => {
    console.warn("[season-list-resolver] Trakt getSeasons erro:", (err as Error)?.message);
    return [] as CatalogSeason[];
  });

  const byNumber = new Map<number, ResolvedSeasonSummary>();

  for (const s of traktSeasons) {
    if (!includeSpecials && s.number === 0) continue;
    byNumber.set(s.number, {
      seasonNumber: s.number,
      name: s.title ?? null,
      airDate: null,
      episodeCount: null,
      posterUrl: s.posterPath ?? null,
      source: "trakt",
    });
  }

  if (byNumber.size === 0) return [];

  return [...byNumber.values()].sort((a, b) => a.seasonNumber - b.seasonNumber);
}

/**
 * Gera stubs de temporada a partir do número total de temporadas.
 * Usado quando nenhuma fonte retorna a lista completa de temporadas.
 */
export function buildSeasonStubsFromCount(numberOfSeasons: number): ResolvedSeasonSummary[] {
  return Array.from({ length: numberOfSeasons }, (_, i) => ({
    seasonNumber: i + 1,
    name: null,
    airDate: null,
    episodeCount: null,
    posterUrl: null,
    source: "count_stub" as const,
  }));
}
