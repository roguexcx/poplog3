// src/lib/user-title-service.ts

import { supabase } from "@/lib/supabase";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type MediaType = "movie" | "tv";

export type UserTitle = {
  id: string;
  user_id: string;
  tmdb_id: number;
  media_type: MediaType;
  status: string;
  favorite: boolean;
  created_at: string;
  watched_at: string | null;
  title: string | null;
  release_year: number | null;
};

type TitleInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  releaseYear?: number | null;
};

// ─── Queries ──────────────────────────────────────────────────────────────────

export async function getUserTitles(userId: string): Promise<UserTitle[]> {
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

// ─── Watchlist ────────────────────────────────────────────────────────────────

export async function isTitleInWatchlist(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_titles")
    .select("id")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .eq("status", "watchlist")
    .limit(1);

  if (error) {
    console.error("Erro ao verificar watchlist:", error);
    return false;
  }

  return Boolean(data?.length);
}

/**
 * Alterna o status de watchlist de um título.
 * Retorna `true` se o título está na watchlist após a operação.
 */
export async function toggleWatchlist({
  userId,
  tmdbId,
  mediaType,
  title,
  releaseYear,
}: TitleInput): Promise<boolean> {
  const inWatchlist = await isTitleInWatchlist(userId, tmdbId, mediaType);

  if (inWatchlist) {
    const { error } = await supabase
      .from("user_titles")
      .delete()
      .eq("user_id", userId)
      .eq("tmdb_id", tmdbId)
      .eq("media_type", mediaType)
      .eq("status", "watchlist");

    if (error) {
      console.error("Erro ao remover da watchlist:", error);
      return true; // falhou → mantém como true (ainda na watchlist)
    }

    return false;
  }

  const { error } = await supabase.from("user_titles").insert({
    user_id: userId,
    tmdb_id: tmdbId,
    media_type: mediaType,
    status: "watchlist",
    favorite: false,
    title,
    release_year: releaseYear ?? null,
  });

  if (error) {
    console.error("Erro ao adicionar à watchlist:", error);
    return false; // falhou → mantém como false (não entrou)
  }

  return true;
}

// ─── Watched ──────────────────────────────────────────────────────────────────

export async function isTitleWatched(
  userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_titles")
    .select("id")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .eq("status", "watched")
    .limit(1);

  if (error) {
    console.error("Erro ao verificar assistido:", error);
    return false;
  }

  return Boolean(data?.length);
}

/**
 * Alterna o status de "assistido" de um título.
 * Retorna `true` se o título está como assistido após a operação.
 */
export async function toggleWatched({
  userId,
  tmdbId,
  mediaType,
  title,
  releaseYear,
}: TitleInput): Promise<boolean> {
  // Busca linha com status 'watched'
  const { data: watchedRows, error: watchedError } = await supabase
    .from("user_titles")
    .select("id")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .eq("status", "watched")
    .limit(1);

  if (watchedError) {
    console.error("Erro ao verificar assistido:", watchedError);
    return false;
  }

  if (watchedRows?.length) {
    // Remove o registro (não move para watchlist — o usuário pode nunca ter adicionado)
    const { error } = await supabase
      .from("user_titles")
      .delete()
      .eq("id", watchedRows[0].id);

    if (error) {
      console.error("Erro ao remover dos assistidos:", error);
      return true; // falhou → mantém como assistido
    }

    return false;
  }

  // Verifica se já existe um registro com outro status (ex: watchlist)
  const { data: existingRows, error: existingError } = await supabase
    .from("user_titles")
    .select("id")
    .eq("user_id", userId)
    .eq("tmdb_id", tmdbId)
    .eq("media_type", mediaType)
    .limit(1);

  if (existingError) {
    console.error("Erro ao buscar título existente:", existingError);
    return false;
  }

  const existing = existingRows?.[0];

  if (existing) {
    // Atualiza o registro existente para 'watched'
    const { error } = await supabase
      .from("user_titles")
      .update({
        status: "watched",
        watched_at: new Date().toISOString(),
        title,
        release_year: releaseYear ?? null,
      })
      .eq("id", existing.id);

    if (error) {
      console.error("Erro ao marcar como assistido:", error);
      return false;
    }

    return true;
  }

  // Sem registro existente — insere novo
  const { error } = await supabase.from("user_titles").insert({
    user_id: userId,
    tmdb_id: tmdbId,
    media_type: mediaType,
    status: "watched",
    favorite: false,
    title,
    release_year: releaseYear ?? null,
    watched_at: new Date().toISOString(),
  });

  if (error) {
    console.error("Erro ao inserir assistido:", error);
    return false;
  }

  return true;
}