/**
 * Engine central de estado do usuário — POPLOG 3
 *
 * user_title_state é a fonte de verdade para todo o front-end.
 * Atualizada em todo evento de escrita (episódio, status, clear).
 * Lida por Hero, Acompanhando, Biblioteca, Página de Título.
 *
 * Nunca calcule progresso dentro de um componente. Leia daqui.
 */

import type { UserSeriesProgress } from "@/server/episodes/episode-progress-service";
import { computeBulkSeriesProgress } from "@/server/repositories";
import { formatError, rateLimitedWarn } from "@/server/logging/log-control";

// ── Tipos públicos ────────────────────────────────────────────────────────────

type MediaType = "movie" | "tv";

/**
 * Estado computado de exibição — o que a UI deve mostrar.
 *
 * TV:
 *   watchlist   → salvo, nunca iniciado
 *   in_progress → assistindo, há aired não vistos (série atrasada)
 *   up_to_date  → em dia com todos os aired, série ainda em produção (série em dia)
 *   completed   → em dia + série encerrada/cancelada; ou marcado como watched
 *   abandoned   → abandonado
 *   fridge      → geladeira
 *
 * Filme:
 *   watchlist | in_progress | watched | abandoned | fridge
 */
export type ComputedState =
  | "watchlist"
  | "in_progress"
  | "up_to_date"
  | "completed"
  | "watched"
  | "abandoned"
  | "fridge";

export type UserEventType =
  | "episode_watched"
  | "episode_unwatched"
  | "season_marked"
  | "season_unmarked"
  | "series_completed"
  | "series_reset"
  | "status_changed"
  | "movie_watched"
  | "franchise_updated"
  | "availability_synced";

export type UserTitleState = {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;

  status: string | null;
  favorite: boolean;
  liked: boolean | null;
  computed_state: ComputedState | null;

  // TV progress
  watched_episodes: number;
  aired_episodes: number;
  total_episodes: number | null;
  progress_pct: number;
  next_season: number | null;
  next_episode: number | null;
  next_episode_air_date: string | null;
  last_watched_at: string | null;
  watched_keys: string[];

  // Franchise (movie)
  franchise_tmdb_id: number | null;
  franchise_name: string | null;
  franchise_watched: number | null;
  franchise_total: number | null;

  // Duração para ordenação
  duration_sort_minutes: number | null;
  duration_sort_unavailable: boolean;

  // Streaming
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;

  last_event_at: string;
  created_at: string;
  updated_at: string;
};

export type UpsertTitleStateInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;

  /**
   * Progresso pré-computado — evita re-query quando o caller já calculou.
   * Se omitido, upsertTitleState calcula internamente (TV only).
   */
  seriesProgress?: Pick<
    UserSeriesProgress,
    | "watchedCount"
    | "airedEpisodes"
    | "totalEpisodes"
    | "nextEpisode"
    | "lastWatchedAt"
    | "watchedKeys"
  >;

  /**
   * Status de biblioteca pré-carregado — evita re-query quando disponível.
   */
  libraryEntry?: {
    status: string | null;
    favorite?: boolean;
    liked?: boolean | null;
  };

  /** Evento a logar junto à atualização de estado. */
  event?: {
    type: UserEventType;
    payload?: Record<string, unknown>;
  };
};

export type GetUserTitleStatesOptions = {
  mediaType?: MediaType;
  computedState?: ComputedState | ComputedState[];
  status?: string | string[];
  limit?: number;
};

export type SyncUserTvTitleStatesOptions = {
  statuses?: string[];
  limit?: number;
  refreshCatalog?: boolean;
  forceCatalogRefresh?: boolean;
};

type TvCatalogRefreshState = {
  expiresAt: number;
  promise: Promise<void>;
};

const tvCatalogRefreshCache = new Map<number, TvCatalogRefreshState>();

// ── Helpers internos ──────────────────────────────────────────────────────────

async function getLocalUserTitleStateService() {
  return import("@/server/local-services/user-title-state-local.service");
}

async function refreshTvCatalogForStateSync(
  tmdbId: number,
  _options: { force?: boolean } = {},
): Promise<void> {
  const ttlMs = 10 * 60 * 1000;
  const cached = tvCatalogRefreshCache.get(tmdbId);

  if (cached && cached.expiresAt > Date.now()) {
    return cached.promise;
  }

  // TMDB catalog refresh disabled
  const promise = Promise.resolve();

  tvCatalogRefreshCache.set(tmdbId, {
    expiresAt: Date.now() + ttlMs,
    promise,
  });

  try {
    await promise;
  } catch (err) {
    tvCatalogRefreshCache.delete(tmdbId);
    throw err;
  }
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Atualiza (ou cria) o estado global de um título para um usuário.
 *
 * Chamada após todo evento de escrita: toggle episódio, bulk mark,
 * mudança de status de biblioteca, clear de progresso.
 *
 * Callers devem aguardar a promise quando a UI depende do estado global
 * imediatamente após a ação.
 */
export async function upsertTitleState(
  input: UpsertTitleStateInput,
): Promise<void> {
  const local = await getLocalUserTitleStateService();
  return local.upsertTitleState(input);
}

export async function backfillDurationSortMinutesForUserTitles(input: {
  userId: string;
  tmdbIds: number[];
  mediaType?: MediaType;
}): Promise<{
  processedTmdbIds: number[];
  updatedTmdbIds: number[];
  unavailableTmdbIds: number[];
  failed: Array<{ tmdbId: number; error: string }>;
}> {
  const mediaType = input.mediaType ?? "tv";
  const tmdbIds = Array.from(
    new Set(input.tmdbIds.filter((id) => Number.isFinite(id) && id > 0)),
  );
  const processedTmdbIds: number[] = [];
  const updatedTmdbIds: number[] = [];
  const unavailableTmdbIds: number[] = [];
  const failed: Array<{ tmdbId: number; error: string }> = [];

  const local = await getLocalUserTitleStateService();

  const existingStates = tmdbIds.length > 0
    ? await local.getUserTitleStates(input.userId, { mediaType })
    : [];

  const stateMap = new Map(existingStates.map((row) => [row.tmdb_id, row]));

  for (const tmdbId of tmdbIds) {
    try {
      const stateRow = stateMap.get(tmdbId);
      processedTmdbIds.push(tmdbId);
      await upsertTitleState({
        userId: input.userId,
        tmdbId,
        mediaType,
        libraryEntry: stateRow
          ? {
              status: stateRow.status,
              favorite: Boolean(stateRow.favorite),
              liked: stateRow.liked,
            }
          : undefined,
      });

      const state = await readTitleState(input.userId, tmdbId, mediaType);
      if (typeof state?.duration_sort_minutes === "number" && state.duration_sort_minutes > 0) {
        updatedTmdbIds.push(tmdbId);
      } else {
        unavailableTmdbIds.push(tmdbId);
      }
    } catch (err) {
      failed.push({
        tmdbId,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  return { processedTmdbIds, updatedTmdbIds, unavailableTmdbIds, failed };
}

/**
 * Remove o estado de um título (chamado por removeUserTitle).
 */
export async function deleteTitleState(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<void> {
  const local = await getLocalUserTitleStateService();
  return local.deleteTitleState(userId, tmdbId, mediaType);
}

/**
 * Loga um evento no histórico imutável do usuário.
 * Fire-and-forget — nunca bloqueia o caller.
 */
export function logUserEvent(input: {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  eventType: UserEventType;
  payload?: Record<string, unknown>;
}): void {
  void getLocalUserTitleStateService()
    .then((local) => local.logUserEvent(input))
    .catch((error) => console.error("[user-events] local insert failed", error));
}

/**
 * Lê o estado atual de um título para um usuário.
 * Fast path — leitura direta da tabela materializada.
 */
export async function readTitleState(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<UserTitleState | null> {
  const local = await getLocalUserTitleStateService();
  return local.readTitleState(userId, tmdbId, mediaType);
}

/**
 * Lê todos os estados de um usuário, com filtros opcionais.
 * Usado por Acompanhando, Biblioteca, Hero (fast path futuro).
 */
export async function getUserTitleStates(
  userId: string,
  opts?: GetUserTitleStatesOptions,
): Promise<UserTitleState[]> {
  const local = await getLocalUserTitleStateService();
  return local.getUserTitleStates(
    userId,
    opts as Parameters<typeof local.getUserTitleStates>[1],
  );
}

/**
 * Recalcula o estado materializado das séries ativas do usuário.
 *
 * Útil em páginas globais como Acompanhando: novos episódios podem ter sido
 * hidratados ou passado da data de exibição sem uma ação explícita do usuário.
 */
export async function syncUserTvTitleStates(
  userId: string,
  opts?: SyncUserTvTitleStatesOptions,
): Promise<{ processed: number; failed: Array<{ tmdbId: number; error: string }> }> {
  const local = await getLocalUserTitleStateService();
  const states = await local.getUserTitleStates(userId, {
    mediaType: "tv",
    status: opts?.statuses as NonNullable<Parameters<typeof local.getUserTitleStates>[1]>["status"],
    limit: opts?.limit ?? 250,
  });
  const failed: Array<{ tmdbId: number; error: string }> = [];

  // Compute fresh progress from the episode catalog (not from cached state).
  // This is what detects new aired episodes for up_to_date series.
  const tmdbIds = states.map((s) => s.tmdb_id);
  const bulkResult = await computeBulkSeriesProgress({ userId, seriesTmdbIds: tmdbIds });
  const freshProgressMap = bulkResult.ok ? bulkResult.data : new Map<number, UserSeriesProgress>();

  if (!bulkResult.ok) {
    rateLimitedWarn(
      "user-title-state:bulk-progress-failed",
      5 * 60 * 1000,
      "[user-title-state] bulk progress computation failed — falling back to cached values",
      bulkResult.error,
    );
  }

  for (const state of states) {
    try {
      if (opts?.refreshCatalog) {
        try {
          await refreshTvCatalogForStateSync(state.tmdb_id, {
            force: opts.forceCatalogRefresh ?? false,
          });
        } catch (err) {
          rateLimitedWarn(
            `user-title-state:catalog-refresh-failed:${state.tmdb_id}`,
            5 * 60 * 1000,
            "[user-title-state] refresh de catálogo TV falhou\n- fallback aplicado: cache atual",
            formatError(err),
          );
        }
      }

      // Use fresh progress if available; fall back to cached state values.
      const freshProgress = freshProgressMap.get(state.tmdb_id);
      const seriesProgress = freshProgress
        ? {
            watchedCount: freshProgress.watchedCount,
            airedEpisodes: freshProgress.airedEpisodes,
            totalEpisodes: freshProgress.totalEpisodes,
            nextEpisode: freshProgress.nextEpisode,
            lastWatchedAt: freshProgress.lastWatchedAt,
            watchedKeys: freshProgress.watchedKeys,
          }
        : {
            watchedCount: state.watched_episodes,
            airedEpisodes: state.aired_episodes,
            totalEpisodes: state.total_episodes,
            nextEpisode:
              state.next_season !== null && state.next_episode !== null
                ? {
                    seasonNumber: state.next_season,
                    episodeNumber: state.next_episode,
                    airDate: state.next_episode_air_date,
                  }
                : null,
            lastWatchedAt: state.last_watched_at,
            watchedKeys: state.watched_keys,
          };

      await local.upsertTitleState({
        userId,
        tmdbId: state.tmdb_id,
        mediaType: "tv",
        libraryEntry: {
          status: state.status,
          favorite: state.favorite,
          liked: state.liked,
        },
        seriesProgress,
      });
    } catch (err) {
      failed.push({
        tmdbId: state.tmdb_id,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  if (failed.length > 0) {
    rateLimitedWarn(
      "user-title-state:sync-tv-partial-failed",
      5 * 60 * 1000,
      "[user-title-state] sync parcial de séries TV falhou",
      { failed },
    );
  }

  return { processed: states.length, failed };
}

/**
 * Recalcula todos os usuários afetados por uma mudança no catálogo canônico de
 * episódios. Séries antes concluídas voltam para `watching` quando surge um
 * episódio exibido e ainda não visto.
 */
export async function recomputeUserTitleStatesForSeries(
  seriesTmdbId: number,
): Promise<{ processed: number; reopened: number; failed: Array<{ userId: string; error: string }> }> {
  const { db } = await import("@/server/db/client");
  const local = await getLocalUserTitleStateService();

  const [libraryEntries, existingStates] = await Promise.all([
    db.userTitle.findMany({
      where: { tmdbId: seriesTmdbId, mediaType: "tv" },
      select: { userId: true, status: true, favorite: true, liked: true },
    }),
    db.userTitleState.findMany({
      where: { tmdbId: seriesTmdbId, mediaType: "tv" },
      select: { userId: true, status: true, favorite: true, liked: true },
    }),
  ]);

  const targets = new Map<
    string,
    { status: string | null; favorite: boolean; liked: boolean | null; hasLibraryEntry: boolean }
  >();
  for (const state of existingStates) {
    targets.set(state.userId, {
      status: state.status,
      favorite: state.favorite,
      liked: state.liked,
      hasLibraryEntry: false,
    });
  }
  for (const entry of libraryEntries) {
    targets.set(entry.userId, {
      status: entry.status,
      favorite: entry.favorite,
      liked: entry.liked,
      hasLibraryEntry: true,
    });
  }

  let reopened = 0;
  const failed: Array<{ userId: string; error: string }> = [];

  for (const [userId, target] of targets) {
    try {
      const progressResult = await computeBulkSeriesProgress({
        userId,
        seriesTmdbIds: [seriesTmdbId],
      });
      if (!progressResult.ok) throw new Error(progressResult.error);

      const progress = progressResult.data.get(seriesTmdbId);
      if (!progress) continue;

      const shouldReopen =
        target.status === "watched" &&
        progress.watchedCount > 0 &&
        progress.airedEpisodes > progress.watchedCount;
      const effectiveStatus = shouldReopen ? "watching" : target.status;

      if (shouldReopen && target.hasLibraryEntry) {
        await db.userTitle.updateMany({
          where: { userId, tmdbId: seriesTmdbId, mediaType: "tv", status: "watched" },
          data: { status: "watching", finishedAt: null },
        });
        reopened += 1;
      }

      await local.upsertTitleState({
        userId,
        tmdbId: seriesTmdbId,
        mediaType: "tv",
        libraryEntry: {
          status: effectiveStatus,
          favorite: target.favorite,
          liked: target.liked,
        },
        seriesProgress: progress,
      });
    } catch (error) {
      failed.push({
        userId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { processed: targets.size, reopened, failed };
}

/**
 * Atualiza o campo de melhor streaming disponível.
 * Chamado separadamente após sync de availability ou mudança de preferências.
 * Não bloqueia o fluxo principal de marcação.
 */
export async function refreshTitleStateAvailability(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
  availability: {
    providerName: string | null;
    providerType: string | null;
    providerLogo: string | null;
  } | null,
): Promise<void> {
  const local = await getLocalUserTitleStateService();
  return local.refreshTitleStateAvailability(userId, tmdbId, mediaType, availability);
}

/**
 * Retorna um Set com chaves "tmdbId:mediaType" de todos os títulos
 * que o usuário já tem em qualquer status na biblioteca.
 *
 * Leitura mínima (só tmdb_id e media_type) — usada para filtrar
 * seções de descoberta como recomendações e títulos similares.
 */
export async function getUserKnownTitleIds(
  userId: string,
): Promise<Set<string>> {
  const local = await getLocalUserTitleStateService();
  return local.getUserKnownTitleIds(userId);
}
