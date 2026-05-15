import { supabaseAdmin } from "@/server/supabase/admin";
import { upsertUserTitleStatus } from "@/server/library/library-service";

export type UserEpisodeRow = {
  user_id: string;
  series_tmdb_id: number;
  season_number: number;
  episode_number: number;
  watched_at: string;
  runtime_minutes: number | null;
};

export type EpisodeKey = `S${string}E${string}`;

export type UserSeriesProgress = {
  seriesTmdbId: number;
  watchedCount: number;
  totalEpisodes: number | null;
  lastWatchedAt: string | null;
  /** Set serializavel "S##E##" para hidratacao em client. */
  watchedKeys: EpisodeKey[];
  /** Proximo episodio sugerido. Calculado considerando ordem (season, episode). */
  nextEpisode: {
    seasonNumber: number;
    episodeNumber: number;
  } | null;
};

export type ToggleEpisodeInput = {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
  watched: boolean;
  runtimeMinutes?: number | null;
};

function episodeKey(season: number, episode: number): EpisodeKey {
  return `S${String(season).padStart(2, "0")}E${String(episode).padStart(2, "0")}` as EpisodeKey;
}

/**
 * Marca/desmarca um episodio como assistido. Faz auto-sync com
 * poplog3_user_titles:
 *   - Primeira marcacao → user_titles vira "watching" (se ainda nao for "watched")
 *   - Todos os episodios conhecidos marcados → tenta promover pra "watched"
 *     (precisa de totalEpisodes pra decidir)
 *   - Desmarcar episodio NAO rebaixa automaticamente (decisao do user).
 */
export async function toggleEpisodeWatched(
  input: ToggleEpisodeInput
): Promise<UserSeriesProgress> {
  const supabase = supabaseAdmin;

  if (input.watched) {
    const { error } = await supabase
      .from("poplog3_user_episodes")
      .upsert(
        {
          user_id: input.userId,
          series_tmdb_id: input.seriesTmdbId,
          season_number: input.seasonNumber,
          episode_number: input.episodeNumber,
          runtime_minutes: input.runtimeMinutes ?? null,
          watched_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,series_tmdb_id,season_number,episode_number" }
      );

    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("poplog3_user_episodes")
      .delete()
      .eq("user_id", input.userId)
      .eq("series_tmdb_id", input.seriesTmdbId)
      .eq("season_number", input.seasonNumber)
      .eq("episode_number", input.episodeNumber);

    if (error) throw new Error(error.message);
  }

  // Auto-sync: garante que a serie esta em "watching" ao menos.
  if (input.watched) {
    try {
      const currentStatus = await getUserTitleStatusRaw(
        input.userId,
        input.seriesTmdbId
      );
      if (currentStatus !== "watched" && currentStatus !== "watching") {
        await upsertUserTitleStatus({
          userId: input.userId,
          tmdbId: input.seriesTmdbId,
          mediaType: "tv",
          status: "watching",
        });
      }
    } catch (err) {
      console.warn("[episode-progress] auto-sync watching falhou:", err);
    }
  }

  return computeUserSeriesProgress(input.userId, input.seriesTmdbId);
}

async function getUserTitleStatusRaw(
  userId: string,
  seriesTmdbId: number
): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from("poplog3_user_titles")
    .select("status")
    .eq("user_id", userId)
    .eq("tmdb_id", seriesTmdbId)
    .eq("media_type", "tv")
    .maybeSingle();
  if (error) return null;
  return (data?.status as string | null) ?? null;
}

/**
 * Marca em massa uma lista de episodios. Usado quando o usuario clica
 * "Marcar assistido" na hero de uma serie — todos os episodios conhecidos
 * sao registrados.
 */
export async function bulkMarkEpisodesWatched(input: {
  userId: string;
  seriesTmdbId: number;
  episodes: Array<{
    seasonNumber: number;
    episodeNumber: number;
    runtimeMinutes?: number | null;
  }>;
}): Promise<UserSeriesProgress> {
  if (input.episodes.length === 0) {
    return computeUserSeriesProgress(input.userId, input.seriesTmdbId);
  }

  const now = new Date().toISOString();
  const payload = input.episodes.map((e) => ({
    user_id: input.userId,
    series_tmdb_id: input.seriesTmdbId,
    season_number: e.seasonNumber,
    episode_number: e.episodeNumber,
    runtime_minutes: e.runtimeMinutes ?? null,
    watched_at: now,
    updated_at: now,
  }));

  const { error } = await supabaseAdmin
    .from("poplog3_user_episodes")
    .upsert(payload, {
      onConflict: "user_id,series_tmdb_id,season_number,episode_number",
    });

  if (error) throw new Error(error.message);

  return computeUserSeriesProgress(input.userId, input.seriesTmdbId);
}

/**
 * Apaga todo o progresso do usuario para a serie.
 */
export async function clearSeriesProgress(
  userId: string,
  seriesTmdbId: number
): Promise<void> {
  const { error } = await supabaseAdmin
    .from("poplog3_user_episodes")
    .delete()
    .eq("user_id", userId)
    .eq("series_tmdb_id", seriesTmdbId);

  if (error) throw new Error(error.message);
}

/**
 * Le todos os episodios assistidos da serie por este usuario.
 */
export async function getWatchedEpisodesForSeries(
  userId: string,
  seriesTmdbId: number
): Promise<UserEpisodeRow[]> {
  const { data, error } = await supabaseAdmin
    .from("poplog3_user_episodes")
    .select(
      "user_id, series_tmdb_id, season_number, episode_number, watched_at, runtime_minutes"
    )
    .eq("user_id", userId)
    .eq("series_tmdb_id", seriesTmdbId)
    .order("season_number", { ascending: true })
    .order("episode_number", { ascending: true });

  if (error) {
    console.error("[episode-progress/getWatched]", error);
    return [];
  }

  return (data ?? []) as UserEpisodeRow[];
}

/**
 * Calcula progresso da serie pro user.
 * - totalEpisodes vem de poplog3_titles.number_of_episodes (best effort)
 * - nextEpisode: percorre poplog3_episodes ordenado (season, ep) e pega o
 *   primeiro que NAO esta na lista de assistidos.
 */
export async function computeUserSeriesProgress(
  userId: string,
  seriesTmdbId: number
): Promise<UserSeriesProgress> {
  const watched = await getWatchedEpisodesForSeries(userId, seriesTmdbId);
  const watchedSet = new Set(
    watched.map((w) => `${w.season_number}-${w.episode_number}`)
  );

  const { data: titleRow } = await supabaseAdmin
    .from("poplog3_titles")
    .select("number_of_episodes")
    .eq("media_type", "tv")
    .eq("tmdb_id", seriesTmdbId)
    .maybeSingle();

  const totalEpisodes =
    typeof titleRow?.number_of_episodes === "number"
      ? titleRow.number_of_episodes
      : null;

  // Procura proximo episodio nao assistido percorrendo os ja catalogados.
  const { data: episodes } = await supabaseAdmin
    .from("poplog3_episodes")
    .select("season_number, episode_number, air_date")
    .eq("series_tmdb_id", seriesTmdbId)
    .order("season_number", { ascending: true })
    .order("episode_number", { ascending: true });

  let nextEpisode: UserSeriesProgress["nextEpisode"] = null;
  const now = Date.now();
  for (const ep of (episodes ?? []) as Array<{
    season_number: number;
    episode_number: number;
    air_date: string | null;
  }>) {
    if (ep.season_number <= 0) continue;
    const key = `${ep.season_number}-${ep.episode_number}`;
    if (watchedSet.has(key)) continue;
    // So sugere episodios que ja foram ao ar.
    if (ep.air_date) {
      const t = new Date(ep.air_date).getTime();
      if (Number.isFinite(t) && t > now) continue;
    }
    nextEpisode = {
      seasonNumber: ep.season_number,
      episodeNumber: ep.episode_number,
    };
    break;
  }

  const lastWatchedAt =
    watched.length > 0
      ? watched
          .map((w) => w.watched_at)
          .sort()
          .reverse()[0]
      : null;

  return {
    seriesTmdbId,
    watchedCount: watched.length,
    totalEpisodes,
    lastWatchedAt,
    watchedKeys: watched.map((w) =>
      episodeKey(w.season_number, w.episode_number)
    ),
    nextEpisode,
  };
}

/**
 * Para futura Acompanhando: lista todas as series com pelo menos 1
 * episodio assistido pelo user, ordenadas por ultimo episodio visto.
 *
 * Retorna metadata minima da serie (titulo, poster) para listagem rapida.
 */
export type UserWatchingSeriesRow = UserSeriesProgress & {
  title: string | null;
  posterPath: string | null;
  backdropPath: string | null;
  mediaStatus: string | null;
  inLibraryStatus: string | null;
};

export async function getUserWatchingSeries(
  userId: string,
  limit = 50
): Promise<UserWatchingSeriesRow[]> {
  // Pega ids unicos de series com progresso, ordenados pelo episodio mais
  // recente assistido.
  const { data: recent, error } = await supabaseAdmin
    .from("poplog3_user_episodes")
    .select("series_tmdb_id, watched_at")
    .eq("user_id", userId)
    .order("watched_at", { ascending: false })
    .limit(limit * 5);

  if (error) {
    console.error("[episode-progress/getUserWatchingSeries]", error);
    return [];
  }

  const orderedIds: number[] = [];
  const seen = new Set<number>();
  for (const r of (recent ?? []) as Array<{
    series_tmdb_id: number;
    watched_at: string;
  }>) {
    if (seen.has(r.series_tmdb_id)) continue;
    seen.add(r.series_tmdb_id);
    orderedIds.push(r.series_tmdb_id);
    if (orderedIds.length >= limit) break;
  }

  if (orderedIds.length === 0) return [];

  const { data: titles } = await supabaseAdmin
    .from("poplog3_titles")
    .select("tmdb_id, title, poster_path, backdrop_path, status")
    .eq("media_type", "tv")
    .in("tmdb_id", orderedIds);

  const { data: userTitles } = await supabaseAdmin
    .from("poplog3_user_titles")
    .select("tmdb_id, status")
    .eq("user_id", userId)
    .eq("media_type", "tv")
    .in("tmdb_id", orderedIds);

  const titleMap = new Map<
    number,
    {
      title: string | null;
      poster_path: string | null;
      backdrop_path: string | null;
      status: string | null;
    }
  >();
  for (const t of (titles ?? []) as Array<{
    tmdb_id: number;
    title: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    status: string | null;
  }>) {
    titleMap.set(t.tmdb_id, {
      title: t.title,
      poster_path: t.poster_path,
      backdrop_path: t.backdrop_path,
      status: t.status,
    });
  }

  const userTitleMap = new Map<number, string | null>();
  for (const ut of (userTitles ?? []) as Array<{
    tmdb_id: number;
    status: string | null;
  }>) {
    userTitleMap.set(ut.tmdb_id, ut.status);
  }

  const results: UserWatchingSeriesRow[] = [];
  for (const id of orderedIds) {
    const progress = await computeUserSeriesProgress(userId, id);
    const meta = titleMap.get(id) ?? null;
    results.push({
      ...progress,
      title: meta?.title ?? null,
      posterPath: meta?.poster_path ?? null,
      backdropPath: meta?.backdrop_path ?? null,
      mediaStatus: meta?.status ?? null,
      inLibraryStatus: userTitleMap.get(id) ?? null,
    });
  }

  return results;
}

/**
 * Marca todos os episodios JA AO AR de uma serie como assistidos pelo user.
 * Le poplog3_episodes (catalogo TMDB ja sincronizado) e faz bulk upsert.
 *
 * Util para o botao "Marcar assistido" da hero da Title Page.
 */
export async function markAllAiredEpisodes(
  userId: string,
  seriesTmdbId: number
): Promise<UserSeriesProgress> {
  const now = Date.now();

  const { data: episodes, error } = await supabaseAdmin
    .from("poplog3_episodes")
    .select("season_number, episode_number, air_date, runtime")
    .eq("series_tmdb_id", seriesTmdbId)
    .order("season_number", { ascending: true })
    .order("episode_number", { ascending: true });

  if (error) {
    console.error("[episode-progress/markAllAired/list]", error);
    throw new Error(error.message);
  }

  const toMark = ((episodes ?? []) as Array<{
    season_number: number;
    episode_number: number;
    air_date: string | null;
    runtime: number | null;
  }>).filter((e) => {
    if (e.season_number <= 0) return false;
    if (!e.air_date) return true;
    const t = new Date(e.air_date).getTime();
    return Number.isFinite(t) && t <= now;
  });

  if (toMark.length === 0) {
    return computeUserSeriesProgress(userId, seriesTmdbId);
  }

  return bulkMarkEpisodesWatched({
    userId,
    seriesTmdbId,
    episodes: toMark.map((e) => ({
      seasonNumber: e.season_number,
      episodeNumber: e.episode_number,
      runtimeMinutes: e.runtime ?? null,
    })),
  });
}
