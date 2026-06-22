import type {
  EpisodeStub,
  MovieState,
  MovieStateInput,
  SeriesState,
  SeriesStateInput,
  SeriesStatus,
  TitleAvailabilityState,
} from "./types";

const DEFAULT_FRESH_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Janela de sinal futuro aceita para considerar uma temporada real. */
export const FUTURE_SEASON_WINDOW_DAYS = 120;

/**
 * Forma mínima de uma temporada necessária para validação.
 * Compatível com PoplogTitleSeasonStub e com o tmdb_payload raw.
 */
export interface SeasonFilterable {
  season_number?: number | null;
  air_date?: string | null;
  name?: string | null;
  poster_path?: string | null;
  overview?: string | null;
}

/**
 * Decide se uma temporada deve ser exibida ou contada.
 * Regra global — usada na Title Page e na página Acompanhando.
 *
 * Exige season_number > 0 E pelo menos um dos sinais:
 *   a) air_date passada ou dentro da janela de 120 dias futuros
 *   b) nome + (poster OU overview)
 */
export function isValidSeason(season: SeasonFilterable): boolean {
  const num = season.season_number;
  if (typeof num !== "number" || num <= 0) return false;

  const now = Date.now();
  const futureLimit = now + FUTURE_SEASON_WINDOW_DAYS * DAY_MS;
  const airTime = season.air_date ? new Date(season.air_date).getTime() : null;

  const hasValidAirDate =
    airTime !== null &&
    Number.isFinite(airTime) &&
    (airTime <= now || airTime <= futureLimit);

  const hasName = Boolean(season.name?.trim());
  const hasStrongSignal =
    Boolean(season.poster_path) || Boolean(season.overview?.trim());

  return hasValidAirDate || (hasName && hasStrongSignal);
}

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
 * Mapeia o status bruto de produção vindo do TMDB para o enum canônico
 * `SeriesStatus`. Regra global — não duplicar por tela.
 *
 * Retorna `null` quando o status não se encaixa em nenhuma categoria
 * conhecida (ex: string vazia ou valor inesperado).
 */
export function mapSeriesStatus(raw: string | null | undefined): SeriesStatus | null {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (lower.includes("return") || lower === "continuing") return "returning";
  if (lower.includes("end")) return "ended";
  if (lower.includes("cancel")) return "canceled";
  if (lower.includes("hiatus")) return "hiatus";
  if (lower.includes("production")) return "in_production";
  return null;
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
