/**
 * Detecção de status temporal de lançamento via Balloonerismm /release_dates.
 *
 * Endpoints:
 *   GET /movie/{imdbId}/release_dates
 *   GET /tv/{imdbId}/release_dates
 *
 * Formato TMDB: results[] = { iso_3166_1, release_dates: [{ release_date, type, type_label }] }
 * Tipos: 1=Premiere, 2=Limited, 3=Theatrical, 4=Digital, 5=Physical, 6=TV.
 *
 * Objetivo: identificar se um FILME ainda está em cartaz (janela theatrical recente)
 * e se um título é um lançamento futuro. Para séries, `isInTheaters` é sempre false.
 */

import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type {
  BalloonerismReleaseDatesResponse,
  BalloonerismReleaseDate,
} from "@/server/api-clients/balloonerismm/types";

/** Janela (em dias) em que um filme com lançamento theatrical é considerado "nos cinemas". */
export const THEATRICAL_WINDOW_DAYS = 120;

const RELEASE_DATES_TTL = 6 * 3600; // 6h — datas de lançamento mudam raramente
const THEATRICAL_TYPE = 3;
const PREMIERE_TYPE = 1;
const LIMITED_TYPE = 2;
const DIGITAL_TYPE = 4;
const TV_TYPE = 6;

export type ReleaseKind = "theatrical" | "direct_vod" | "direct_streaming" | "unknown";

export type ReleaseStatus = {
  /** Filme em cartaz: lançamento theatrical dentro da janela e sem streaming. */
  isInTheaters: boolean;
  /** O lançamento mais relevante ainda está no futuro. */
  isFutureRelease: boolean;
  /** Data theatrical detectada (priorizando região), se houver. */
  theatricalDate: string | null;
  /** Data de lançamento mais próxima considerada (qualquer tipo relevante). */
  earliestRelevantDate: string | null;
  /** Primeira data digital/VOD da região consultada. */
  expectedVodDate: string | null;
  releaseKind: ReleaseKind;
  /** Fim rígido da janela theatrical (D+120). */
  theatricalWindowEndsAt: string | null;
};

const NO_RELEASE_STATUS: ReleaseStatus = {
  isInTheaters: false,
  isFutureRelease: false,
  theatricalDate: null,
  earliestRelevantDate: null,
  expectedVodDate: null,
  releaseKind: "unknown",
  theatricalWindowEndsAt: null,
};

function parseTime(value?: string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

function daysSince(value?: string | null): number | null {
  const t = parseTime(value);
  if (t === null) return null;
  return Math.floor((Date.now() - t) / 86_400_000);
}

/**
 * Busca as datas de lançamento de um título no Balloonerismm.
 * Nunca lança — retorna null em caso de erro/indisponibilidade.
 */
export async function getBalloonerismReleaseDates(
  imdbId: string,
  mediaType: "movie" | "tv",
): Promise<BalloonerismReleaseDatesResponse | null> {
  const segment = mediaType === "movie" ? "movie" : "tv";
  const path = `/${segment}/${imdbId}/release_dates`;
  return balloonerismGet<BalloonerismReleaseDatesResponse>(path, {
    ttlSeconds: RELEASE_DATES_TTL,
  });
}

/** Seleciona as datas de uma região específica, com fallback global. */
function selectRegionDates(
  response: BalloonerismReleaseDatesResponse,
  region: string,
): BalloonerismReleaseDate[] {
  const results = response.results ?? [];
  const wanted = region.toUpperCase();

  const regional = results.find((r) => (r.iso_3166_1 ?? "").toUpperCase() === wanted);
  if (regional?.release_dates?.length) return regional.release_dates;

  // Fallback global: junta todas as datas de todas as regiões
  return results.flatMap((r) => r.release_dates ?? []);
}

function selectExactRegionDates(
  response: BalloonerismReleaseDatesResponse,
  region: string,
): BalloonerismReleaseDate[] {
  const wanted = region.toUpperCase();
  return response.results?.find(
    (result) => (result.iso_3166_1 ?? "").toUpperCase() === wanted,
  )?.release_dates ?? [];
}

function earliestTheatrical(dates: BalloonerismReleaseDate[]): string | null {
  const theatrical = dates
    .filter((d) => d.type === THEATRICAL_TYPE || d.type === LIMITED_TYPE)
    .map((d) => d.release_date)
    .filter((d): d is string => Boolean(d))
    .sort();
  return theatrical[0] ?? null;
}

function earliestRelevant(dates: BalloonerismReleaseDate[]): string | null {
  // Considera premiere/limited/theatrical como sinais de "estreia"
  const relevant = dates
    .filter(
      (d) =>
        d.type === PREMIERE_TYPE ||
        d.type === LIMITED_TYPE ||
        d.type === THEATRICAL_TYPE ||
        d.type === DIGITAL_TYPE ||
        d.type === TV_TYPE,
    )
    .map((d) => d.release_date)
    .filter((d): d is string => Boolean(d))
    .sort();
  return relevant[0] ?? null;
}

function earliestByType(dates: BalloonerismReleaseDate[], type: number): string | null {
  return dates
    .filter((date) => date.type === type)
    .map((date) => date.release_date)
    .filter((date): date is string => Boolean(date))
    .sort()[0] ?? null;
}

function addDays(value: string | null, days: number): string | null {
  const time = parseTime(value);
  if (time === null) return null;
  return new Date(time + days * 86_400_000).toISOString();
}

/**
 * Detecta o status temporal de um título.
 *
 * Regras (filmes):
 *   - Prioriza datas BR; sem BR, usa fallback global.
 *   - "Nos cinemas" quando: há lançamento theatrical dentro de THEATRICAL_WINDOW_DAYS
 *     atrás (0..75 dias) E não há streaming principal.
 *   - "Lançamento futuro" quando a estreia mais próxima está no futuro.
 *
 * Para séries: `isInTheaters` sempre false; só avalia lançamento futuro.
 *
 * `hasStreaming` é passado pelo caller (já tem providers) para não forçar cinema
 * em títulos que já chegaram ao streaming.
 */
export function detectReleaseStatus(input: {
  mediaType: "movie" | "tv";
  response: BalloonerismReleaseDatesResponse | null;
  region: string;
  hasStreaming: boolean;
  /** Data de estreia já conhecida (releaseDate/firstAirDate) como fallback. */
  fallbackDate?: string | null;
}): ReleaseStatus {
  const { mediaType, response, region, hasStreaming } = input;

  const dates = response ? selectRegionDates(response, region) : [];
  const exactRegionDates = response ? selectExactRegionDates(response, region) : [];

  const theatricalDate = mediaType === "movie" ? earliestTheatrical(dates) : null;
  const expectedVodDate = mediaType === "movie" ? earliestByType(exactRegionDates, DIGITAL_TYPE) : null;
  const tvDate = earliestByType(dates, TV_TYPE);
  const earliest = earliestRelevant(dates) ?? input.fallbackDate ?? null;
  const theatricalTime = parseTime(theatricalDate);
  const vodTime = parseTime(expectedVodDate);
  const releaseKind: ReleaseKind = mediaType === "tv"
    ? "direct_streaming"
    : vodTime !== null && (theatricalTime === null || vodTime <= theatricalTime)
      ? "direct_vod"
      : theatricalTime !== null
        ? "theatrical"
        : "unknown";

  // Lançamento futuro: estreia mais próxima ainda não aconteceu
  const earliestTime = parseTime(earliest);
  const isFutureRelease = earliestTime !== null && earliestTime > Date.now();

  // Nos cinemas: só filmes, theatrical recente dentro da janela, sem streaming
  let isInTheaters = false;
  if (mediaType === "movie" && !hasStreaming) {
    const age = daysSince(theatricalDate);
    if (age !== null && age >= 0 && age <= THEATRICAL_WINDOW_DAYS) {
      isInTheaters = true;
    }
  }

  if (!response && !input.fallbackDate) return NO_RELEASE_STATUS;

  return {
    isInTheaters,
    isFutureRelease,
    theatricalDate,
    earliestRelevantDate: earliest ?? tvDate,
    expectedVodDate,
    releaseKind,
    theatricalWindowEndsAt: addDays(theatricalDate, THEATRICAL_WINDOW_DAYS),
  };
}

/** Idade (dias) do lançamento theatrical/estreia — usada para escolher TTL de cache. */
export function releaseAgeDays(status: ReleaseStatus): number | null {
  return daysSince(status.theatricalDate ?? status.earliestRelevantDate);
}
