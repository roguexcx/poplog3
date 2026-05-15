import type {
  EpisodeStub,
  MovieState,
  MovieStateInput,
  SeriesState,
  SeriesStateInput,
  TitleAvailabilityState,
} from "./types";

const DEFAULT_FRESH_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? new Date(t) : null;
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / DAY_MS;
}

function normalizeStatus(raw: string | null | undefined): string {
  return (raw ?? "").trim().toLowerCase();
}

function isFinishedStatus(status: string): boolean {
  return status === "ended" || status === "canceled" || status === "cancelled";
}

function isReturningStatus(status: string): boolean {
  return (
    status === "returning series" ||
    status === "in production" ||
    status === "post production" ||
    status === "planned"
  );
}

/**
 * Calcula o estado canônico de uma série.
 *
 * Decisão prioritária:
 *   1. firstAirDate no futuro → coming-soon
 *   2. status Ended/Canceled  → finished
 *   3. nextEpisodeToAir       → in-season
 *   4. lastEpisodeToAir < window dias → episode-available
 *   5. status Returning, sem next/last recente → awaiting-next-season
 *   6. fallback → unknown
 */
export function computeSeriesState(input: SeriesStateInput): SeriesState {
  const now = input.now ?? new Date();
  const window =
    input.freshEpisodeWindowDays ?? DEFAULT_FRESH_WINDOW_DAYS;

  const firstAir = parseDate(input.firstAirDate);
  const lastAir = parseDate(input.lastAirDate);
  const nextEp = parseDate(input.nextEpisodeToAir?.air_date);
  const lastEp = parseDate(input.lastEpisodeToAir?.air_date);

  const status = normalizeStatus(input.tmdbStatus);

  // 1. Estreia ainda no futuro.
  if (firstAir && firstAir.getTime() > now.getTime()) {
    return "coming-soon";
  }

  // 2. Encerrada de fato.
  if (isFinishedStatus(status)) {
    return "finished";
  }

  // 3. Próximo episódio agendado (independente da data — TMDB já filtra).
  if (nextEp) {
    return "in-season";
  }

  // 4. Episódio recente saiu há pouco → ainda há novidade pra assistir.
  if (lastEp && daysBetween(lastEp, now) <= window) {
    return "episode-available";
  }

  // Última tentativa: usar lastAirDate quando lastEpisodeToAir não veio.
  if (lastAir && daysBetween(lastAir, now) <= window) {
    return "episode-available";
  }

  // 5. Série marcada como ainda em curso mas sem episódio em vista.
  if (isReturningStatus(status)) {
    return "awaiting-next-season";
  }

  // Se temos data de estreia (já passada) mas nenhum outro sinal,
  // consideramos awaiting-next-season como melhor chute neutro.
  if (firstAir) {
    return "awaiting-next-season";
  }

  return "unknown";
}

/**
 * Calcula o estado de um filme. Simples: pré-estreia vs. lançado.
 */
export function computeMovieState(input: MovieStateInput): MovieState {
  const now = input.now ?? new Date();
  const release = parseDate(input.releaseDate);

  if (!release) return "unknown";
  return release.getTime() > now.getTime() ? "coming-soon" : "released";
}

/**
 * Tipo aceito por `seriesStateFromTitle` — espelha o subset do
 * tmdb_payload que de fato consultamos.
 */
export type SeriesStateTitleSource = {
  media_type?: "movie" | "tv" | string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
  release_date?: string | null;
  tmdb_payload?: {
    status?: string | null;
    next_episode_to_air?: EpisodeStub | null;
    last_episode_to_air?: EpisodeStub | null;
  } | null;
  /** Quando vem fora do tmdb_payload (caminho legado). */
  status?: string | null;
  next_episode_to_air?: EpisodeStub | null;
  last_episode_to_air?: EpisodeStub | null;
};

/**
 * Extrai o estado de série a partir de uma row de `poplog3_titles` (ou
 * do PoplogTitleDetails normalizado). Concentra o "match" das colunas
 * num lugar só para evitar leitura inconsistente em várias telas.
 */
export function seriesStateFromTitle(
  title: SeriesStateTitleSource,
  options?: { now?: Date; freshEpisodeWindowDays?: number }
): SeriesState {
  const payload = title.tmdb_payload ?? null;

  return computeSeriesState({
    firstAirDate: title.first_air_date ?? null,
    lastAirDate: title.last_air_date ?? null,
    tmdbStatus: payload?.status ?? title.status ?? null,
    nextEpisodeToAir:
      payload?.next_episode_to_air ?? title.next_episode_to_air ?? null,
    lastEpisodeToAir:
      payload?.last_episode_to_air ?? title.last_episode_to_air ?? null,
    now: options?.now,
    freshEpisodeWindowDays: options?.freshEpisodeWindowDays,
  });
}

/**
 * Versão "dispatcher": olha o media_type e devolve o estado certo.
 * Útil para componentes que recebem títulos de qualquer tipo.
 */
export function availabilityStateFromTitle(
  title: SeriesStateTitleSource,
  options?: { now?: Date; freshEpisodeWindowDays?: number }
): TitleAvailabilityState {
  if (title.media_type === "tv") {
    return seriesStateFromTitle(title, options);
  }

  return computeMovieState({
    releaseDate: title.release_date ?? null,
    now: options?.now,
  });
}
