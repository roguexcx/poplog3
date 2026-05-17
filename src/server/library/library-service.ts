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

  const tmdbIds = stateRows.map((r) => r.tmdb_id);

  const { data: titles, error: titlesError } = await supabaseAdmin
    .from("poplog3_titles")
    .select(
      "tmdb_id, media_type, title, original_title, poster_path, backdrop_path, year, release_date, first_air_date, last_air_date, runtime, episode_run_time, vote_average",
    )
    .in("tmdb_id", tmdbIds);

  if (titlesError) {
    console.error("[getUserLibraryState] titles query failed", titlesError);
    return null;
  }

  const titleMap = new Map(
    ((titles ?? []) as Array<{
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
    }>).map((t) => [t.tmdb_id, t]),
  );

  return stateRows.map((row) => {
    const titleData = titleMap.get(row.tmdb_id) ?? null;

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
            last_air_date: titleData.last_air_date,
            runtime: titleData.runtime,
            episode_run_time: titleData.episode_run_time,
            vote_average: titleData.vote_average,
          }
        : null,
    } as Poplog3UserLibraryItem;
  });
}

export async function getUserLibrary(
  userId: string,
  status?: string
): Promise<Poplog3UserLibraryItem[]> {
  const supabase = supabaseAdmin;

  let query = supabase
    .from("poplog3_user_titles")
    .select(
      `
      *,
      title:poplog3_titles (
        tmdb_id,
        media_type,
        title,
        original_title,
        poster_path,
        backdrop_path,
        year,
        release_date,
        first_air_date,
        last_air_date,
        runtime,
        episode_run_time,
        vote_average
      )
    `
    )
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as Poplog3UserLibraryItem[];
}

export async function getUserTitleStatus(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv"
): Promise<Poplog3UserTitle | null> {
  const supabase = supabaseAdmin;

  const { data, error } = await supabase
    .from("poplog3_user_titles")
    .select("*")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as Poplog3UserTitle | null;
}

export async function upsertUserTitleStatus(
  input: UpsertUserTitleInput
): Promise<Poplog3UserTitle> {
  const supabase = supabaseAdmin;

  const payload = {
    user_id: input.userId,
    tmdb_id: input.tmdbId,
    media_type: input.mediaType,
    status: input.status,
    rating: input.rating ?? null,
    liked: input.liked ?? null,
    favorite: input.favorite ?? false,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from("poplog3_user_titles")
    .upsert(payload, {
      onConflict: "user_id,tmdb_id,media_type",
    })
    .select()
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const result = data as Poplog3UserTitle;

  // Propaga mudança de status para o estado global
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
  const supabase = supabaseAdmin;

  const { error } = await supabase
    .from("poplog3_user_titles")
    .delete()
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType);

  if (error) {
    throw new Error(error.message);
  }

  // Remove do estado global e loga o evento
  deleteTitleState(userId, tmdbId, mediaType).catch((err) =>
    console.error("[state] deleteTitleState failed", err),
  );
}