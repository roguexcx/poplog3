/**
 * Source Engine — camada de orquestração de adapters.
 *
 * Roteia cada operação de catálogo pelo adapter primário configurado,
 * com fallback transparente para o adapter legado (TMDB/OMDb direto).
 *
 * Configuração via env:
 *   BALLOONERISMM_ACTIVE=true        — ativa Balloonerismm como primeiro adapter
 *   CATALOG_SOURCE=balloonerismm     — define fonte primária explicitamente
 *   CATALOG_FALLBACK=legacy          — define fallback (padrão: legacy)
 *
 * Regra operacional:
 *   - Retorna null/[] quando nenhum adapter tem dados — o caller usa sua lógica legada.
 *   - Nunca lança — erros são absorvidos e logados pelo adapter subjacente.
 *   - Não substitui o sync layer (syncTmdbTitle, syncOmdbRatings) diretamente.
 *     Esses precisam de integração gradual por caller.
 */

import { balloonerismAdapter } from "./adapters/balloonerismm-adapter";
import { isBalloonerismActive } from "@/server/api-clients/balloonerismm/client";
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
  RatingParams,
  PeopleParams,
  VideoParams,
} from "./types/catalog.types";

// ─── Feature flags ────────────────────────────────────────────────────────────

function catalogSource(): string {
  return process.env.CATALOG_SOURCE ?? "legacy";
}

function catalogFallback(): string {
  return process.env.CATALOG_FALLBACK ?? "legacy";
}

/** Balloonerismm está ativo e configurado como fonte primária ou complementar. */
function balloonerismEnabled(): boolean {
  return isBalloonerismActive() || catalogSource() === "balloonerismm";
}

// ─── Search ──────────────────────────────────────────────────────────────────

/**
 * Busca de títulos via adapter primário.
 * Retorna [] quando Balloonerismm está inativo — o caller usa TMDB.
 *
 * NOTA: resultados Balloonerismm têm apenas imdbId. Para rotas que precisam
 * de tmdbId (frontend), usar o cross-reference cache (Etapa 3).
 */
export async function catalogSearch(
  params: SearchParams,
): Promise<CatalogSearchResult[]> {
  if (!balloonerismEnabled()) return [];
  return balloonerismAdapter.searchTitles(params);
}

// ─── Title details ────────────────────────────────────────────────────────────

/**
 * Detalhes de filme via adapter primário.
 * Retorna null quando Balloonerismm está inativo ou não tem dados.
 */
export async function catalogGetMovie(
  params: GetTitleParams,
): Promise<CatalogTitle | null> {
  if (!balloonerismEnabled()) return null;
  return balloonerismAdapter.getMovie(params);
}

/**
 * Detalhes de série via adapter primário.
 * Retorna null quando Balloonerismm está inativo ou não tem dados.
 */
export async function catalogGetShow(
  params: GetTitleParams,
): Promise<CatalogTitle | null> {
  if (!balloonerismEnabled()) return null;
  return balloonerismAdapter.getShow(params);
}

// ─── Popular / Trending ───────────────────────────────────────────────────────

/**
 * Títulos populares via adapter primário.
 * NOTA: resultados têm imdbId, sem tmdbId — cross-reference necessário (Etapa 3).
 */
export async function catalogGetPopular(
  params: PopularParams,
): Promise<CatalogSearchResult[]> {
  if (!balloonerismEnabled()) return [];
  return balloonerismAdapter.getPopular(params);
}

/**
 * Títulos trending via adapter primário.
 * Usa o endpoint de popular do Balloonerismm (não tem trending separado).
 */
export async function catalogGetTrending(
  params: TrendingParams,
): Promise<CatalogSearchResult[]> {
  if (!balloonerismEnabled()) return [];
  return balloonerismAdapter.getTrending(params);
}

// ─── Ratings ─────────────────────────────────────────────────────────────────

/**
 * Ratings via adapter primário (Balloonerismm IMDb-first).
 * Retorna null quando inativo — o caller usa OMDb.
 *
 * Uso típico: fallback quando OMDb falha ou allowExternalRefresh=false.
 * O adapter já normaliza para CatalogRatings.
 */
export async function catalogGetRatings(
  params: RatingParams,
): Promise<CatalogRatings | null> {
  if (!balloonerismEnabled()) return null;
  return balloonerismAdapter.getRatings(params);
}

// ─── People / Credits ─────────────────────────────────────────────────────────

/**
 * Elenco e equipe via adapter primário.
 * Retorna null quando inativo — o caller usa TMDB credits.
 */
export async function catalogGetPeople(
  params: PeopleParams,
): Promise<CatalogPeople | null> {
  if (!balloonerismEnabled()) return null;
  return balloonerismAdapter.getPeople(params);
}

// ─── Videos / Trailers ────────────────────────────────────────────────────────

/**
 * Trailers e vídeos via adapter primário.
 * Retorna [] quando inativo — o caller usa TMDB videos.
 */
export async function catalogGetVideos(
  params: VideoParams,
): Promise<CatalogVideo[]> {
  if (!balloonerismEnabled()) return [];
  return balloonerismAdapter.getVideos(params);
}
