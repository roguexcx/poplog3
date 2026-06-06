/**
 * Series Season List Resolver
 *
 * Resolve a lista de temporadas de uma série de fontes live (TVDB + Trakt)
 * quando o banco de dados local está vazio ou incompleto.
 *
 * Usado em getTitlePageData para preencher `seasons` quando:
 *   1. getSeasonSummariesFromDb retorna vazio
 *   2. numberOfSeasons ainda não é conhecido
 *
 * Prioridade: TVDB > Trakt (TVDB tem a estrutura de temporadas mais confiável)
 */

import { tvdbAdapter } from "./adapters/tvdb-adapter";
import { traktAdapter } from "./adapters/trakt-adapter";
import type { CatalogSeason } from "./types/catalog.types";

export type ResolvedSeasonSummary = {
  seasonNumber: number;
  name: string | null;
  airDate: string | null;
  episodeCount: number | null;
  posterUrl: string | null;
  source: "tvdb" | "trakt" | "count_stub";
};

/**
 * Busca a lista de temporadas de TVDB e/ou Trakt em paralelo.
 * Retorna uma lista ordenada, deduplicada por número de temporada.
 * Exclui temporada 0 (especiais) por padrão — podem ser incluídas via includeSpecials.
 */
export async function resolveSeriesSeasonList(params: {
  tvdbId?: number | null;
  imdbId?: string | null;
  includeSpecials?: boolean;
}): Promise<ResolvedSeasonSummary[]> {
  const { tvdbId, imdbId, includeSpecials = false } = params;

  if (!tvdbId && !imdbId) return [];

  const [tvdbSeasons, traktSeasons] = await Promise.all([
    tvdbId
      ? tvdbAdapter.getSeasons({ tvdbId }).catch((err) => {
          console.warn("[season-list-resolver] TVDB getSeasons erro:", (err as Error)?.message);
          return [] as CatalogSeason[];
        })
      : Promise.resolve([] as CatalogSeason[]),

    imdbId
      ? traktAdapter.getSeasons({ imdbId }).catch((err) => {
          console.warn("[season-list-resolver] Trakt getSeasons erro:", (err as Error)?.message);
          return [] as CatalogSeason[];
        })
      : Promise.resolve([] as CatalogSeason[]),
  ]);

  // Merge: TVDB tem precedência; Trakt preenche gaps
  const byNumber = new Map<number, ResolvedSeasonSummary>();

  // Trakt primeiro (prioridade mais baixa)
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

  // TVDB sobrescreve (maior prioridade)
  for (const s of tvdbSeasons) {
    if (!includeSpecials && s.number === 0) continue;
    byNumber.set(s.number, {
      seasonNumber: s.number,
      name: s.title ?? null,
      airDate: null,
      episodeCount: null,
      posterUrl: s.posterPath ?? null,
      source: "tvdb",
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
