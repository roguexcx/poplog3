/**
 * POPLOG Source Engine.
 *
 * Trakt is the primary external catalog source for structure, search and
 * identity. Balloonerismm remains a residual fallback, except for protected
 * Home editorial feeds that intentionally preserve the Trakt + Balloonerismm
 * curation pipeline outside this generic engine entrypoint.
 */

import { traktAdapter } from "./adapters/trakt-adapter";
import { balloonerismAdapter } from "./adapters/balloonerismm-adapter";
export type { PersonSearchResult, CompanySearchResult } from "./adapters/balloonerismm-adapter";
import type {
  CatalogTitle,
  CatalogSearchResult,
  CatalogRatings,
  CatalogPeople,
  CatalogVideo,
  SearchParams,
  GetTitleParams,
  PopularParams,
  TrendingParams,
  DiscoverParams,
  RelatedParams,
  RatingParams,
  PeopleParams,
  VideoParams,
} from "./types/catalog.types";
import { sourceEngineLog } from "./source-log";

export function isBalloonerismSearchEnabled(): boolean {
  return true;
}

export function isTraktSearchEnabled(): boolean {
  return true;
}

export function isTraktTrendingEnabled(): boolean {
  return true;
}

export function isTraktDiscoverEnabled(): boolean {
  return true;
}

export const isBalloonerismTrendingEnabled = isTraktTrendingEnabled;
export const isBalloonerismDiscoverEnabled = isTraktDiscoverEnabled;

export async function catalogSearch(params: SearchParams): Promise<CatalogSearchResult[]> {
  const traktResults = await traktAdapter.searchTitles(params);
  if (traktResults.length > 0) {
    sourceEngineLog("trakt_primary_resolved", {
      op: "search",
      query: params.query,
      language: params.language ?? null,
      region: params.region ?? null,
      results: traktResults.length,
    });
    return traktResults;
  }

  const balloonerismResults = await balloonerismAdapter.searchTitles(params);
  sourceEngineLog(
    balloonerismResults.length > 0 ? "balloon_fallback_used" : "balloon_fallback_skipped",
    {
      op: "search",
      query: params.query,
      language: params.language ?? null,
      region: params.region ?? null,
      reason: balloonerismResults.length > 0 ? "trakt_empty" : "fallback_empty",
      results: balloonerismResults.length,
    },
    balloonerismResults.length > 0 ? "warn" : "debug",
  );
  return balloonerismResults;
}

export async function catalogSearchPeople(query: string) {
  return balloonerismAdapter.searchPeople({ query });
}

export async function catalogSearchCompanies(query: string) {
  return balloonerismAdapter.searchCompanies({ query });
}

export async function catalogGetMovie(params: GetTitleParams): Promise<CatalogTitle | null> {
  return traktAdapter.getMovie(params);
}

export async function catalogGetShow(params: GetTitleParams): Promise<CatalogTitle | null> {
  return traktAdapter.getShow(params);
}

export async function catalogGetPopular(params: PopularParams): Promise<CatalogSearchResult[]> {
  return traktAdapter.getPopular(params);
}

export async function catalogGetTrending(params: TrendingParams): Promise<CatalogSearchResult[]> {
  return traktAdapter.getTrending(params);
}

export async function catalogGetByGenre(params: DiscoverParams): Promise<CatalogSearchResult[]> {
  return traktAdapter.getDiscover(params);
}

export async function catalogGetRelated(params: RelatedParams): Promise<CatalogSearchResult[]> {
  return traktAdapter.getRelated(params);
}

export async function catalogGetRatings(params: RatingParams): Promise<CatalogRatings | null> {
  return traktAdapter.getRatings(params);
}

export async function catalogGetPeople(params: PeopleParams): Promise<CatalogPeople | null> {
  return traktAdapter.getPeople(params);
}

export async function catalogGetVideos(params: VideoParams): Promise<CatalogVideo[]> {
  return traktAdapter.getVideos(params);
}
