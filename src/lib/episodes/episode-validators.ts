/**
 * Validadores globais de episódios — POPLOG 3
 *
 * Regras canônicas para determinar se um episódio é "válido" para fins de:
 * - cálculo de progresso (aired, assistidos, restantes)
 * - cálculo de duração (runtime, durationSortMinutes)
 * - ordenação e exibição na Biblioteca e Acompanhando
 *
 * Centraliza lógica anteriormente duplicada em:
 * - computeUserSeriesProgress
 * - getUserWatchingSeries
 * - markAllAiredEpisodes
 * - getAiredEpisodeCountsMap
 * - calculateSeriesRuntimeStats (season 0 filter)
 *
 * Regra global de "episódio válido para progresso":
 *   1. season_number > 0     (exclui specials / season 0)
 *   2. air_date não nulo     (exclui placeholders sem data)
 *   3. air_date é data real  (valor parseável como timestamp finito)
 *   4. air_date <= hoje      (exclui episódios futuros pré-cadastrados no TMDB)
 */

// ── Tipo mínimo que os validadores aceitam ─────────────────────────────────

export type EpisodeValidationInput = {
  season_number?: number | null;
  episode_number?: number | null;
  air_date?: string | null;
};

// ── Validadores canônicos ──────────────────────────────────────────────────

/**
 * Retorna true se o episódio pertence a uma temporada real (não season 0).
 * Season 0 no TMDB agrupa specials, OVAs e extras — não contam para progresso.
 */
export function isRegularSeason(episode: EpisodeValidationInput): boolean {
  return typeof episode.season_number === "number" && episode.season_number > 0;
}

/**
 * Retorna true se o episódio tem uma data de estreia válida e parseável.
 * Rejeita null, undefined, string vazia e datas inválidas.
 */
export function hasValidAirDate(episode: EpisodeValidationInput): boolean {
  if (!episode.air_date) return false;
  const t = new Date(episode.air_date).getTime();
  return Number.isFinite(t) && t > 0;
}

/**
 * Retorna true se o número do episódio é real. Quando o campo não está
 * disponível no caller, mantém compatibilidade e valida pelos demais critérios.
 */
export function hasValidEpisodeNumber(episode: EpisodeValidationInput): boolean {
  if (episode.episode_number === undefined || episode.episode_number === null) {
    return true;
  }

  return typeof episode.episode_number === "number" && episode.episode_number > 0;
}

/**
 * Retorna true se o episódio já foi ao ar (air_date <= agora).
 * Episódios futuros pré-cadastrados no TMDB são excluídos.
 *
 * @param episode - episódio a verificar
 * @param nowMs   - timestamp de referência (default: Date.now())
 */
export function isAired(
  episode: EpisodeValidationInput,
  nowMs: number = Date.now(),
): boolean {
  if (!hasValidAirDate(episode)) return false;
  const t = new Date(episode.air_date!).getTime();
  return t <= nowMs;
}

/**
 * Validação canônica completa: episódio conta para progresso e duração.
 *
 * Episódio válido:
 *   - temporada real (season > 0)
 *   - tem air_date válido
 *   - já foi ao ar (air_date <= hoje)
 *
 * @param episode - episódio a verificar
 * @param nowMs   - timestamp de referência (default: Date.now())
 */
export function isValidAiredEpisode(
  episode: EpisodeValidationInput,
  nowMs: number = Date.now(),
): boolean {
  return (
    isRegularSeason(episode) &&
    hasValidEpisodeNumber(episode) &&
    isAired(episode, nowMs)
  );
}

/**
 * Variante para uso em filtros de queries SQL/JS onde já temos air_date
 * garantido pelo banco (NOT NULL + lte) — só checa season > 0.
 *
 * Usar quando a query já filtrou air_date IS NOT NULL AND air_date <= today.
 */
export function isRegularSeasonEpisode(episode: EpisodeValidationInput): boolean {
  return isRegularSeason(episode);
}

/**
 * Episódio válido para cálculo de runtime médio.
 *
 * Mesmo critério de isValidAiredEpisode, mas aceita um campo `runtime`
 * explicitamente (não exige runtime > 0 — séries sem runtime continuam
 * a ser válidas para contagem de progresso e aired_episodes).
 */
export type EpisodeRuntimeValidationInput = EpisodeValidationInput & {
  runtime?: number | null;
};

/**
 * Retorna true se o episódio tem runtime real usável para média.
 * Critérios: episódio válido (aired, season > 0) + runtime > 0.
 */
export function hasUsableRuntime(
  episode: EpisodeRuntimeValidationInput,
  nowMs: number = Date.now(),
): boolean {
  if (!isValidAiredEpisode(episode, nowMs)) return false;
  return typeof episode.runtime === "number" && episode.runtime > 0;
}

// ── Utilitários de filtragem em batch ─────────────────────────────────────

/**
 * Filtra uma lista de episódios para apenas os válidos (aired, season > 0).
 * Versão tipada para uso em JS puro (não depende do schema do Supabase).
 */
export function filterValidAiredEpisodes<T extends EpisodeValidationInput>(
  episodes: T[],
  nowMs: number = Date.now(),
): T[] {
  return episodes.filter((ep) => isValidAiredEpisode(ep, nowMs));
}

/**
 * Filtra temporadas válidas: ao menos 1 episódio aired na temporada.
 * Guard contra temporadas-fantasma do TMDB (criadas mas sem episódios aired).
 */
export function getValidSeasonNumbers(
  episodes: EpisodeValidationInput[],
  nowMs: number = Date.now(),
): Set<number> {
  const set = new Set<number>();
  for (const ep of episodes) {
    if (isValidAiredEpisode(ep, nowMs) && typeof ep.season_number === "number") {
      set.add(ep.season_number);
    }
  }
  return set;
}
