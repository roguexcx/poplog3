/**
 * POPLOG Source Engine.
 *
 * Balloonerismm is the primary external catalog source (IMDb-first, enriched).
 * Trakt is the fallback when Balloonerismm is inactive or returns no results.
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
  // Balloonerismm is primary (IMDb-first, pt-BR enriched); Trakt is fallback.
  const balloonerismResults = await balloonerismAdapter.searchTitles(params);
  if (balloonerismResults.length > 0) return balloonerismResults;
  return traktAdapter.searchTitles(params);
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
