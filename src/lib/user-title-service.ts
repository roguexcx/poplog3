import { createClient } from "@/lib/supabase/client";
import type { MediaType, UserTitle } from "@/types/user";

export type { MediaType, UserTitle };

type TitleInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  releaseYear?: number | null;
};

function getSupabase() {
  return createClient();
}

export async function getUserTitles(userId: string): Promise<UserTitle[]> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("user_titles")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Erro ao buscar títulos:", error);
    return [];
  }

  return data as UserTitle[];
}

export async function isTitleInWatchlist(
  userId: string,
  tmdbId: number,
  mediaType: MediaType
): Promise<boolean> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("user_titles")
    .select("id")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .eq("status", "watchlist")
    .maybeSingle();

  if (error) {
    console.error("Erro ao verificar watchlist:", error);
    return false;
  }

  return Boolean(data);
}

export async function toggleWatchlist({
  userId,
  tmdbId,
  mediaType,
}: TitleInput): Promise<boolean> {
  const inWatchlist = await isTitleInWatchlist(userId, tmdbId, mediaType);

  if (inWatchlist) {
    const res = await fetch("/api/library/title", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId, mediaType }),
    });
    if (!res.ok && res.status !== 401) throw new Error(`DELETE ${res.status}`);
    return false;
  }

  const res = await fetch("/api/library/title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tmdbId, mediaType, status: "watchlist" }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  return true;
}

export async function isTitleWatched(
  userId: string,
  tmdbId: number,
  mediaType: MediaType
): Promise<boolean> {
  const supabase = getSupabase();

  const { data, error } = await supabase
    .from("user_titles")
    .select("id")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .eq("status", "watched")
    .maybeSingle();

  if (error) {
    console.error("Erro ao verificar assistido:", error);
    return false;
  }

  return Boolean(data);
}

export async function toggleWatched({
  userId,
  tmdbId,
  mediaType,
}: TitleInput): Promise<boolean> {
  const isWatched = await isTitleWatched(userId, tmdbId, mediaType);

  if (isWatched) {
    const res = await fetch("/api/library/title", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId, mediaType }),
    });
    if (!res.ok && res.status !== 401) throw new Error(`DELETE ${res.status}`);
    return false;
  }

  const res = await fetch("/api/library/title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tmdbId, mediaType, status: "watched" }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  return true;
}
