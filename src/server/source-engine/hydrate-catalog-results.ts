/**
 * Hydration: CatalogSearchResult[] → PoplogTitle[]
 *
 * Resolve resultados do Balloonerismm (imdbId-first) para o formato PoplogTitle
 * usado pelas rotas legadas, consultando o cache local (TitleExternalId + Poplog3Title).
 *
 * Itens não encontrados no cache local são descartados silenciosamente.
 * Nenhuma chamada de API externa — apenas DB.
 */

import { db } from "@/server/db/client";
import type { CatalogSearchResult } from "./types/catalog.types";
import type { PoplogTitle } from "@/server/types/title";

type TitleRow = {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string | null;
  originalTitle: string | null;
  overview: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  releaseDate: Date | null;
  firstAirDate: Date | null;
  lastAirDate: Date | null;
  year: number | null;
  runtime: number | null;
  episodeRunTime: unknown;
  genres: unknown;
  popularity: unknown;
  voteAverage: unknown;
  voteCount: number | null;
  originalLanguage: string | null;
};

function rowToPoplogTitle(row: TitleRow): PoplogTitle {
  return {
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    title: row.title ?? row.originalTitle ?? "Untitled",
    original_title: row.originalTitle,
    overview: row.overview,
    poster_path: row.posterPath,
    backdrop_path: row.backdropPath,
    release_date: row.mediaType === "movie" ? (row.releaseDate?.toISOString().slice(0, 10) ?? null) : null,
    first_air_date: row.mediaType === "tv" ? (row.firstAirDate?.toISOString().slice(0, 10) ?? null) : null,
    last_air_date: row.mediaType === "tv" ? (row.lastAirDate?.toISOString().slice(0, 10) ?? null) : null,
    year: row.year,
    runtime: row.mediaType === "movie" ? row.runtime : null,
    episode_run_time: row.mediaType === "tv" ? (row.episodeRunTime as number[] | null) : null,
    genres: Array.isArray(row.genres) ? (row.genres as number[]) : undefined,
    popularity: row.popularity != null ? Number(row.popularity) : null,
    vote_average: row.voteAverage != null ? Number(row.voteAverage) : null,
    vote_count: row.voteCount,
    original_language: row.originalLanguage,
  };
}

/**
 * Converte CatalogSearchResult[] (Balloonerismm) em PoplogTitle[] via cache local.
 *
 * Fluxo (2 queries batch, sem API externa):
 *   1. TitleExternalId: imdbId[] → {tmdbId, mediaType}[]
 *   2. Poplog3Title: {tmdbId, mediaType}[] → dados completos com poster_path TMDB
 *
 * Preserva a ordem original dos resultados Balloonerismm.
 * Descarta itens sem tmdbId no cache local ou sem poster_path.
 */
export async function hydrateCatalogResults(
  results: CatalogSearchResult[],
): Promise<PoplogTitle[]> {
  if (!results.length) return [];

  const imdbIds = results
    .map((r) => r.ids.imdbId)
    .filter((id): id is string => typeof id === "string" && id.startsWith("tt"));

  if (!imdbIds.length) return [];

  // 1. Resolve imdbId → (tmdbId, mediaType) via title_external_ids
  const externalRows = await db.titleExternalId
    .findMany({
      where: { imdbId: { in: imdbIds } },
      select: { imdbId: true, tmdbId: true, mediaType: true },
    })
    .catch(() => []);

  if (!externalRows.length) return [];

  const imdbToTmdb = new Map<string, { tmdbId: number; mediaType: "movie" | "tv" }>();
  for (const row of externalRows) {
    if (row.imdbId) {
      imdbToTmdb.set(row.imdbId, {
        tmdbId: row.tmdbId,
        mediaType: row.mediaType as "movie" | "tv",
      });
    }
  }

  const titleKeys = Array.from(imdbToTmdb.values());
  if (!titleKeys.length) return [];

  // 2. Fetch full title data from poplog3_titles
  const titleRows = await db.poplog3Title
    .findMany({
      where: { OR: titleKeys.map(({ tmdbId, mediaType }) => ({ tmdbId, mediaType })) },
      select: {
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
    })
    .catch(() => []);

  // Build lookup keyed by "mediaType-tmdbId"
  const titleMap = new Map<string, (typeof titleRows)[0]>();
  for (const row of titleRows) {
    titleMap.set(`${row.mediaType}-${row.tmdbId}`, row);
  }

  // 3. Reconstruct in original Balloonerismm order, dropping unresolved items
  const hydrated: PoplogTitle[] = [];
  for (const result of results) {
    const imdbId = result.ids.imdbId;
    if (!imdbId) continue;

    const ids = imdbToTmdb.get(imdbId);
    if (!ids) continue;

    const row = titleMap.get(`${ids.mediaType}-${ids.tmdbId}`);
    if (!row?.posterPath) continue; // filterValidTitles requires poster_path

    hydrated.push(rowToPoplogTitle(row as TitleRow));
  }

  return hydrated;
}
