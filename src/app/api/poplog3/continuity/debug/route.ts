import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { supabaseAdmin } from "@/server/supabase/admin";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  const user = await getCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  }

  const { data: episodes, error: episodesError } = await supabaseAdmin
    .from("user_episodes")
    .select("series_tmdb_id, watched_at")
    .eq("user_id", user.id)
    .order("watched_at", { ascending: false })
    .limit(30);

  const ids = Array.from(
    new Set((episodes ?? []).map((item) => item.series_tmdb_id)),
  );

  const { data: titles, error: titlesError } = await supabaseAdmin
    .from("poplog3_titles")
    .select("*")
    .eq("media_type", "tv")
    .in("tmdb_id", ids);

  const { data: cachedEpisodes, error: cachedEpisodesError } =
    await supabaseAdmin
      .from("poplog3_episodes")
      .select("series_tmdb_id, season_number, episode_number")
      .in("series_tmdb_id", ids);

  return NextResponse.json({
    ids,
    episodesError,
    titlesError,
    cachedEpisodesError,
    titles,
    cachedEpisodesCount: cachedEpisodes?.length ?? 0,
  });
}
