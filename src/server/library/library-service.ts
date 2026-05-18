import { supabaseAdmin } from "@/server/supabase/admin";
import {
  upsertTitleState,
  deleteTitleState,
  getUserTitleStates,
} from "@/server/state/user-title-state";

import {
  Poplog3UserTitle,
  UpsertUserTitleInput,
} from "./types";

export type Poplog3UserLibraryItem = Poplog3UserTitle & {
  /** Campos do estado global (preenchidos por getUserLibraryState) */
  computed_state?: string | null;
  watched_episodes?: number;
  aired_episodes?: number;
  progress_pct?: number;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  title: {
    tmdb_id: number;
    media_type: "movie" | "tv";
    title: string | null;
    original_title: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    year: number | null;
    release_date: string | null;
    first_air_date: string | null;
    last_air_date: string | null;
    runtime: number | null;
    episode_run_time: number[] | null;
    vote_average: number | null;
    popularity: number | null;
    number_of_episodes: number | null;
    number_of_seasons: number | null;
  } | null;
};

/**
 * Lê a biblioteca do usuário a partir de user_title_state (estado materializado).
 * Retorna null se o usuário não tiver linhas no state — o caller faz fallback para getUserLibrary.
 */
export async function getUserLibraryState(
  userId: string,
  status?: string,
): Promise<Poplog3UserLibraryItem[] | null> {
  const statusFilter = status
    ? [status]
    : ["watchlist", "watching", "watched", "abandoned", "fridge"];

  const stateRows = await getUserTitleStates(userId, { status: statusFilter });

  if (stateRows.length === 0) return null;

  const tmdbIds  = stateRows.map((r) => r.tmdb_id);
  const tvIds    = stateRows.filter((r) => r.media_type === "tv").map((r) => r.tmdb_id);
  const today    = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"

  // ── Batch 1: metadados dos títulos ───────────────────────────────────────
  // Filtra por media_type para evitar cruzamento de IDs entre filmes e séries
  const mediaTypes = [...new Set(stateRows.map((r) => r.media_type))];

  const { data: titles, error: titlesError } = await supabaseAdmin
    .from("poplog3_titles")
    .select(
      "tmdb_id, media_type, title, original_title, poster_path, backdrop_path, year, release_date, first_air_date, last_air_date, runtime, episode_run_time, vote_average, popularity, number_of_episodes, number_of_seasons, tmdb_payload",
    )
    .in("tmdb_id", tmdbIds)
    .in("media_type", mediaTypes);

  if (titlesError) {
    console.error("[getUserLibraryState] titles query failed", titlesError);
    return null;
  }

  // ── Batch 2: data do último episódio aired por série (regra global) ──────
  // Usa poplog3_episodes como fonte de verdade — evita o last_air_date do TMDB
  // que pode conter datas futuras de episódios pré-cadastrados.
  // Resultado: Map<tmdb_id → "YYYY-MM-DD"> com a data do ep mais recente <= hoje.
  const lastAiredMap = new Map<number, string>();

  if (tvIds.length > 0) {
    const { data: epRows } = await supabaseAdmin
      .from("poplog3_episodes")
      .select("series_tmdb_id, air_date")
      .in("series_tmdb_id", tvIds)
      .not("air_date", "is", null)
      .lte("air_date", today)
      .order("air_date", { ascending: false });

    for (const ep of (epRows ?? []) as { series_tmdb_id: number; air_date: string }[]) {
      if (!lastAiredMap.has(ep.series_tmdb_id)) {
        lastAiredMap.set(ep.series_tmdb_id, ep.air_date);
      }
    }
  }

  type TitleData = {
    tmdb_id: number;
    media_type: string;
    title: string | null;
    original_title: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    year: number | null;
    release_date: string | null;
    first_air_date: string | null;
    last_air_date: string | null;
    runtime: number | null;
    episode_run_time: number[] | null;
    vote_average: number | null;
    popularity: number | null;
    number_of_episodes: number | null;
    number_of_seasons: number | null;
    tmdb_payload: Record<string, unknown> | null;
  };

  // Key MUST include media_type — TMDB IDs are NOT globally unique across movie/tv
  // (e.g. movie 550 = Fight Club, tv 550 = Till Death Us Do Part 1966)
  const titleMap = new Map(
    ((titles ?? []) as TitleData[]).map((t) => [`${t.tmdb_id}:${t.media_type}`, t]),
  );

  return stateRows.map((row) => {
    const titleData = titleMap.get(`${row.tmdb_id}:${row.media_type}`) ?? null;

    return {
      // Campos de Poplog3UserTitle — id/user_id/rating/notes não usados pela UI
      id: `${row.tmdb_id}-${row.media_type}`,
      user_id: userId,
      tmdb_id: row.tmdb_id,
      media_type: row.media_type,
      status: row.status as import("./types").Poplog3LibraryStatus,
      rating: null,
      liked: row.liked,
      favorite: row.favorite,
      notes: null,
      started_at: null,
      finished_at: null,
      abandoned_at: null,
      created_at: row.created_at,
      updated_at: row.last_event_at,
      // Campos de estado global
      computed_state: row.computed_state,
      watched_episodes: row.watched_episodes,
      aired_episodes: row.aired_episodes,
      progress_pct: row.progress_pct,
      best_provider_name: row.best_provider_name,
      best_provider_type: row.best_provider_type,
      best_provider_logo: row.best_provider_logo,
      // Metadados do título
      title: titleData
        ? {
            tmdb_id: titleData.tmdb_id,
            media_type: titleData.media_type as "movie" | "tv",
            title: titleData.title,
            original_title: titleData.original_title,
            poster_path: titleData.poster_path,
            backdrop_path: titleData.backdrop_path,
            year: titleData.year,
            release_date: titleData.release_date,
            first_air_date: titleData.first_air_date,
            // last_air_date — cadeia de prioridade (regra global):
            // 1. poplog3_episodes: último ep com air_date <= hoje (fonte de verdade)
            // 2. coluna direta last_air_date do poplog3_titles
            // 3. tmdb_payload.last_air_date (fallback legado)
            last_air_date:
              (row.media_type === "tv" ? (lastAiredMap.get(row.tmdb_id) ?? null) : null) ??
              titleData.last_air_date ??
              (typeof titleData.tmdb_payload?.last_air_date === "string"
                ? titleData.tmdb_payload.last_air_date
                : null),
            runtime: titleData.runtime,
            episode_run_time: titleData.episode_run_time,
            vote_average: titleData.vote_average,
            popularity: titleData.popularity,
            number_of_episodes: titleData.number_of_episodes,
            number_of_seasons: titleData.number_of_seasons,
          }
        : null,
    } as Poplog3UserLibraryItem;
  });
}

export async function getUserLibrary(
  userId: string,
  status?: string
): Promise<Poplog3UserLibraryItem[]> {
  let query = supabaseAdmin
    .from("user_titles")
    .select("id, user_id, tmdb_id, media_type, status, liked, favorite, created_at, watched_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return [];

  const tmdbIds = rows.map((r) => r.tmdb_id as number);
  const mediaTypes = [...new Set(rows.map((r) => r.media_type as string))];

  const { data: titles } = await supabaseAdmin
    .from("poplog3_titles")
    .select(
      "tmdb_id, media_type, title, original_title, poster_path, backdrop_path, year, release_date, first_air_date, last_air_date, runtime, episode_run_time, vote_average"
    )
    .in("tmdb_id", tmdbIds)
    .in("media_type", mediaTypes);

  const titleMap = new Map(
    ((titles ?? []) as Array<Record<string, unknown>>).map((t) => [
      `${t.tmdb_id}:${t.media_type}`,
      t,
    ])
  );

  return rows.map((row) => {
    const titleData = titleMap.get(`${row.tmdb_id}:${row.media_type}`) ?? null;
    return {
      id: row.id as string,
      user_id: row.user_id as string,
      tmdb_id: row.tmdb_id as number,
      media_type: row.media_type as "movie" | "tv",
      status: row.status as import("./types").Poplog3LibraryStatus,
      rating: null,
      liked: (row.liked as boolean | null) ?? null,
      favorite: Boolean(row.favorite),
      notes: null,
      started_at: null,
      finished_at: null,
      abandoned_at: null,
      created_at: row.created_at as string,
      updated_at: (row.watched_at as string | null) ?? (row.created_at as string),
      title: titleData
        ? {
            tmdb_id: titleData.tmdb_id as number,
            media_type: titleData.media_type as "movie" | "tv",
            title: titleData.title as string | null,
            original_title: titleData.original_title as string | null,
            poster_path: titleData.poster_path as string | null,
            backdrop_path: titleData.backdrop_path as string | null,
            year: titleData.year as number | null,
            release_date: titleData.release_date as string | null,
            first_air_date: titleData.first_air_date as string | null,
            last_air_date: titleData.last_air_date as string | null,
            runtime: titleData.runtime as number | null,
            episode_run_time: titleData.episode_run_time as number[] | null,
            vote_average: titleData.vote_average as number | null,
            popularity: null,
            number_of_episodes: null,
            number_of_seasons: null,
          }
        : null,
    } as Poplog3UserLibraryItem;
  });
}

export async function getUserTitleStatus(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<Poplog3UserTitle | null> {
  const { data, error } = await supabaseAdmin
    .from("user_titles")
    .select("id, user_id, tmdb_id, media_type, status, liked, favorite, created_at, watched_at")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const row = data as Record<string, unknown>;
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    tmdb_id: row.tmdb_id as number,
    media_type: row.media_type as "movie" | "tv",
    status: row.status as import("./types").Poplog3LibraryStatus,
    rating: null,
    liked: (row.liked as boolean | null) ?? null,
    favorite: Boolean(row.favorite),
    notes: null,
    started_at: null,
    finished_at: null,
    abandoned_at: null,
    created_at: row.created_at as string,
    updated_at: (row.watched_at as string | null) ?? (row.created_at as string),
  };
}

export async function upsertUserTitleStatus(
  input: UpsertUserTitleInput
): Promise<Poplog3UserTitle> {
  const now = new Date().toISOString();

  // Remove qualquer linha anterior para este título — user_titles não tem unique constraint
  // e pode ter múltiplas linhas de status diferentes (watchlist + watched).
  // Após uma mudança explícita de status, deixamos apenas uma linha.
  await supabaseAdmin
    .from("user_titles")
    .delete()
    .eq("user_id", input.userId)
    .eq("tmdb_id", input.tmdbId)
    .eq("media_type", input.mediaType);

  const { data, error } = await supabaseAdmin
    .from("user_titles")
    .insert({
      user_id: input.userId,
      tmdb_id: input.tmdbId,
      media_type: input.mediaType,
      status: input.status,
      liked: input.liked ?? null,
      favorite: input.favorite ?? false,
      watched_at: input.status === "watched" ? now : null,
    })
    .select("id, user_id, tmdb_id, media_type, status, liked, favorite, created_at, watched_at")
    .single();

  if (error) throw new Error(error.message);

  const row = data as Record<string, unknown>;
  const result: Poplog3UserTitle = {
    id: row.id as string,
    user_id: row.user_id as string,
    tmdb_id: row.tmdb_id as number,
    media_type: row.media_type as "movie" | "tv",
    status: row.status as import("./types").Poplog3LibraryStatus,
    rating: null,
    liked: (row.liked as boolean | null) ?? null,
    favorite: Boolean(row.favorite),
    notes: null,
    started_at: null,
    finished_at: null,
    abandoned_at: null,
    created_at: row.created_at as string,
    updated_at: (row.watched_at as string | null) ?? (row.created_at as string),
  };

  upsertTitleState({
    userId: input.userId,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    libraryEntry: {
      status: result.status,
      favorite: result.favorite,
      liked: result.liked,
    },
    event: {
      type: input.mediaType === "movie" && result.status === "watched"
        ? "movie_watched"
        : "status_changed",
      payload: { status: result.status },
    },
  }).catch((err) => console.error("[state] upsertTitleState failed", err));

  return result;
}

export async function removeUserTitle(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("user_titles")
    .delete()
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType);

  if (error) throw new Error(error.message);

  deleteTitleState(userId, tmdbId, mediaType).catch((err) =>
    console.error("[state] deleteTitleState failed", err),
  );
}