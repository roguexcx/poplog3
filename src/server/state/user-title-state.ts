/**
 * Engine central de estado do usuário — POPLOG 3
 *
 * user_title_state é a fonte de verdade para todo o front-end.
 * Atualizada em todo evento de escrita (episódio, status, clear).
 * Lida por Hero, Acompanhando, Biblioteca, Página de Título.
 *
 * Nunca calcule progresso dentro de um componente. Leia daqui.
 */

import { supabaseAdmin } from "@/server/supabase/admin";
import type { UserSeriesProgress } from "@/server/episodes/episode-progress-service";

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

// ── Helpers internos ──────────────────────────────────────────────────────────

function deriveSeriesComputedState(
  status: string | null,
  watched: number,
  airedEps: number,
  nextEp: { seasonNumber: number; episodeNumber: number } | null,
  mediaStatus: string | null,
): ComputedState | null {
  if (!status) return null;

  // Estados terminais têm prioridade sobre tudo
  if (status === "abandoned") return "abandoned";
  if (status === "fridge") return "fridge";

  // Usuário marcou manualmente como watched = concluído
  if (status === "watched") return "completed";

  // Sem nenhum episódio assistido = ainda não começou
  if (watched === 0) return "watchlist";

  // Tem progresso e está em dia com todos os aired
  if (nextEp === null && airedEps > 0) {
    const isEnded = /ended|canceled|cancelled/i.test(mediaStatus ?? "");
    return isEnded ? "completed" : "up_to_date";
  }

  // Tem progresso + ainda há aired não vistos
  return "in_progress";
}

function deriveMovieComputedState(status: string | null): ComputedState | null {
  if (!status) return null;
  if (status === "watchlist") return "watchlist";
  if (status === "watching") return "in_progress";
  if (status === "watched") return "watched";
  if (status === "abandoned") return "abandoned";
  if (status === "fridge") return "fridge";
  return null;
}

async function fetchLibraryEntry(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<{ status: string | null; favorite: boolean; liked: boolean | null } | null> {
  const { data } = await supabaseAdmin
    .from("user_titles")
    .select("status, favorite, liked")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  return {
    status: (data as Record<string, unknown>).status as string | null,
    favorite: Boolean((data as Record<string, unknown>).favorite),
    liked: (data as Record<string, unknown>).liked as boolean | null,
  };
}

async function fetchTitleMeta(
  tmdbId: number,
  mediaType: MediaType,
): Promise<{
  mediaStatus: string | null;
  collection: { id?: number; name?: string } | null;
}> {
  const { data } = await supabaseAdmin
    .from("poplog3_titles")
    .select("tmdb_payload")
    .eq("media_type", mediaType)
    .eq("tmdb_id", tmdbId)
    .maybeSingle();

  const payload = (data as Record<string, unknown> | null)?.tmdb_payload as Record<
    string,
    unknown
  > | null;

  const mediaStatus = (payload?.status as string | null) ?? null;
  const collection = (payload?.belongs_to_collection as {
    id?: number;
    name?: string;
  } | null) ?? null;

  return { mediaStatus, collection };
}

/**
 * Calcula quantos filmes de uma franquia o usuário já assistiu.
 * Usa apenas títulos já sincronizados em poplog3_titles.
 */
async function computeFranchiseProgress(
  userId: string,
  collectionId: number,
): Promise<{ total: number; watched: number }> {
  const [allResult, watchedResult] = await Promise.all([
    supabaseAdmin
      .from("poplog3_titles")
      .select("tmdb_id")
      .eq("media_type", "movie")
      .filter(
        "tmdb_payload->belongs_to_collection->>id",
        "eq",
        String(collectionId),
      ),
    supabaseAdmin
      .from("user_titles")
      .select("tmdb_id")
      .eq("user_id", userId)
      .eq("media_type", "movie")
      .eq("status", "watched"),
  ]);

  const allIds = new Set(
    ((allResult.data ?? []) as Array<{ tmdb_id: number }>).map((r) => r.tmdb_id),
  );

  const watchedInCollection = (
    (watchedResult.data ?? []) as Array<{ tmdb_id: number }>
  ).filter((r) => allIds.has(r.tmdb_id)).length;

  return { total: allIds.size, watched: watchedInCollection };
}

// ── API pública ───────────────────────────────────────────────────────────────

/**
 * Atualiza (ou cria) o estado global de um título para um usuário.
 *
 * Chamada após todo evento de escrita: toggle episódio, bulk mark,
 * mudança de status de biblioteca, clear de progresso.
 *
 * Fire-and-forget é recomendado nos callers:
 *   upsertTitleState(...).catch(console.error)
 */
export async function upsertTitleState(
  input: UpsertTitleStateInput,
): Promise<void> {
  const { userId, tmdbId, mediaType } = input;

  // Busca o que não foi fornecido pelo caller
  const [libraryEntry, titleMeta] = await Promise.all([
    input.libraryEntry !== undefined
      ? Promise.resolve(input.libraryEntry)
      : fetchLibraryEntry(userId, tmdbId, mediaType),
    fetchTitleMeta(tmdbId, mediaType),
  ]);

  const status = libraryEntry?.status ?? null;
  const favorite = libraryEntry?.favorite ?? false;
  const liked = libraryEntry?.liked ?? null;
  const now = new Date().toISOString();

  let row: Record<string, unknown>;

  if (mediaType === "tv") {
    let progress = input.seriesProgress;

    if (!progress) {
      // Import dinâmico para evitar dependência circular
      const { computeUserSeriesProgress } = await import(
        "@/server/episodes/episode-progress-service"
      );
      progress = await computeUserSeriesProgress(userId, tmdbId);
    }

    const pct =
      progress.airedEpisodes > 0
        ? Math.min(
            Math.round((progress.watchedCount / progress.airedEpisodes) * 100),
            100,
          )
        : 0;

    row = {
      user_id: userId,
      tmdb_id: tmdbId,
      media_type: "tv",
      status,
      favorite,
      liked,
      computed_state: deriveSeriesComputedState(
        status,
        progress.watchedCount,
        progress.airedEpisodes,
        progress.nextEpisode,
        titleMeta.mediaStatus,
      ),
      watched_episodes: progress.watchedCount,
      aired_episodes: progress.airedEpisodes,
      total_episodes: progress.totalEpisodes ?? null,
      progress_pct: pct,
      next_season: progress.nextEpisode?.seasonNumber ?? null,
      next_episode: progress.nextEpisode?.episodeNumber ?? null,
      next_episode_air_date: progress.nextEpisode?.airDate ?? null,
      last_watched_at: progress.lastWatchedAt ?? null,
      watched_keys: progress.watchedKeys,
      last_event_at: now,
      updated_at: now,
    };
  } else {
    // Filme — calcula progresso de franquia se aplicável
    let franchise_tmdb_id: number | null = null;
    let franchise_name: string | null = null;
    let franchise_watched: number | null = null;
    let franchise_total: number | null = null;

    if (titleMeta.collection?.id) {
      franchise_tmdb_id = titleMeta.collection.id;
      franchise_name = titleMeta.collection.name ?? null;

      const prog = await computeFranchiseProgress(userId, titleMeta.collection.id);
      franchise_watched = prog.watched;
      franchise_total = prog.total;
    }

    row = {
      user_id: userId,
      tmdb_id: tmdbId,
      media_type: "movie",
      status,
      favorite,
      liked,
      computed_state: deriveMovieComputedState(status),
      franchise_tmdb_id,
      franchise_name,
      franchise_watched,
      franchise_total,
      last_event_at: now,
      updated_at: now,
    };
  }

  const { error } = await supabaseAdmin
    .from("user_title_state")
    .upsert(row, { onConflict: "user_id,tmdb_id,media_type" });

  if (error) {
    console.error("[user-title-state] upsert failed", {
      userId,
      tmdbId,
      mediaType,
      error,
    });
    return;
  }

  if (input.event) {
    logUserEvent({
      userId,
      tmdbId,
      mediaType,
      eventType: input.event.type,
      payload: input.event.payload ?? {},
    });
  }
}

/**
 * Remove o estado de um título (chamado por removeUserTitle).
 */
export async function deleteTitleState(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("user_title_state")
    .delete()
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType);

  if (error) {
    console.error("[user-title-state] delete failed", { userId, tmdbId, mediaType, error });
  }

  logUserEvent({
    userId,
    tmdbId,
    mediaType,
    eventType: "status_changed",
    payload: { removed: true },
  });
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
  supabaseAdmin
    .from("user_events")
    .insert({
      user_id: input.userId,
      tmdb_id: input.tmdbId,
      media_type: input.mediaType,
      event_type: input.eventType,
      payload: input.payload ?? {},
    })
    .then(({ error }) => {
      if (error) {
        console.error("[user-events] insert failed", { ...input, error });
      }
    });
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
  const { data, error } = await supabaseAdmin
    .from("user_title_state")
    .select("*")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .maybeSingle();

  if (error) {
    console.error("[user-title-state] read failed", error);
    return null;
  }

  return data as UserTitleState | null;
}

/**
 * Lê todos os estados de um usuário, com filtros opcionais.
 * Usado por Acompanhando, Biblioteca, Hero (fast path futuro).
 */
export async function getUserTitleStates(
  userId: string,
  opts?: GetUserTitleStatesOptions,
): Promise<UserTitleState[]> {
  let query = supabaseAdmin
    .from("user_title_state")
    .select("*")
    .eq("user_id", userId)
    .order("last_event_at", { ascending: false });

  if (opts?.mediaType) {
    query = query.eq("media_type", opts.mediaType);
  }

  if (opts?.computedState) {
    const states = Array.isArray(opts.computedState)
      ? opts.computedState
      : [opts.computedState];
    query = query.in("computed_state", states);
  }

  if (opts?.status) {
    const statuses = Array.isArray(opts.status) ? opts.status : [opts.status];
    query = query.in("status", statuses);
  }

  if (opts?.limit) {
    query = query.limit(opts.limit);
  }

  const { data, error } = await query;

  if (error) {
    console.error("[user-title-state] getUserStates failed", error);
    return [];
  }

  return (data ?? []) as UserTitleState[];
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
  const { error } = await supabaseAdmin
    .from("user_title_state")
    .update({
      best_provider_name: availability?.providerName ?? null,
      best_provider_type: availability?.providerType ?? null,
      best_provider_logo: availability?.providerLogo ?? null,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType);

  if (error) {
    console.error("[user-title-state] refreshAvailability failed", error);
  }
}
