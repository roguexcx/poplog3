import { supabaseAdmin } from "@/server/supabase/admin";

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

  return data as Poplog3UserTitle;
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
}