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
  /** Set serializável "S##E##" para hidratação em client. */
  watchedKeys: EpisodeKey[];
  /** Próximo episódio sugerido. Calculado considerando ordem (season, episode). */
  nextEpisode: {
    seasonNumber: number;
    episodeNumber: number;
    airDate: string | null;
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
 * Promove a série para "watching" em poplog3_user_titles se o status atual
 * não for "watched" nem "watching". Lança em caso de falha — o chamador
 * decide se propaga ou absorve. O upsert de episódio é idempotente, então
 * retry após falha aqui é seguro.
 */
async function syncLibraryStatusAfterEpisodeMark(
  userId: string,
  seriesTmdbId: number
): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("poplog3_user_titles")
    .select("status")
    .eq("user_id", userId)
    .eq("tmdb_id", seriesTmdbId)
    .eq("media_type", "tv")
    .maybeSingle();

  if (error) throw new Error(`[episode-progress] falha ao ler status da série: ${error.message}`);

  const currentStatus = (data?.status as string | null) ?? null;
  if (currentStatus !== "watched" && currentStatus !== "watching") {
    await upsertUserTitleStatus({
      userId,
      tmdbId: seriesTmdbId,
      mediaType: "tv",
      status: "watching",
    });
  }
}

/**
 * Marca/desmarca um episódio como assistido e sincroniza o status da série
 * em poplog3_user_titles.
 *
 * - Marcar → promove série para "watching" (se ainda não for "watched"/"watching")
 * - Desmarcar → não rebaixa status (decisão do usuário)
 * - Falha no sync de status propaga: o upsert de episódio é idempotente,
 *   então retry é seguro e mantém consistência.
 */
export async function toggleEpisodeWatched(
  input: ToggleEpisodeInput
): Promise<UserSeriesProgress> {
  if (input.watched) {
    const { error } = await supabaseAdmin
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

    await syncLibraryStatusAfterEpisodeMark(input.userId, input.seriesTmdbId);
  } else {
    const { error } = await supabaseAdmin
      .from("poplog3_user_episodes")
      .delete()
      .eq("user_id", input.userId)
      .eq("series_tmdb_id", input.seriesTmdbId)
      .eq("season_number", input.seasonNumber)
      .eq("episode_number", input.episodeNumber);

    if (error) throw new Error(error.message);
  }

  return computeUserSeriesProgress(input.userId, input.seriesTmdbId);
}

/**
 * Marca em massa uma lista de episódios. Usado quando o usuário clica
 * "Marcar assistido" na hero de uma série — todos os episódios conhecidos
 * são registrados.
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

  await syncLibraryStatusAfterEpisodeMark(input.userId, input.seriesTmdbId);

  return computeUserSeriesProgress(input.userId, input.seriesTmdbId);
}

/**
 * Apaga todo o progresso do usuário para a série.
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
 * Lê todos os episódios assistidos da série por este usuário.
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
 * Calcula progresso da série pro user.
 * - totalEpisodes vem de poplog3_titles.number_of_episodes (best effort)
 * - nextEpisode: percorre poplog3_episodes ordenado (season, ep) e pega o
 * primeiro que NÃO está na lista de assistidos.
 * - Proteção nativa contra temporadas fantasma do TMDB (sem episódios válidos ou futuros placeholders).
 */
export async function computeUserSeriesProgress(
  userId: string,
  seriesTmdbId: number
): Promise<UserSeriesProgress> {
  const now = Date.now();
  
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

  // Blindagem real contra temporadas fantasmas / placeholders TMDB
const { data: validEpisodesRaw } = await supabaseAdmin
  .from("poplog3_episodes")
  .select("season_number, episode_number, air_date")
  .eq("series_tmdb_id", seriesTmdbId)
  .gt("season_number", 0)
  .gt("episode_number", 0)
  .not("air_date", "is", null);

const validSeasonsSet = new Set<number>();

if (validEpisodesRaw) {
  for (const row of validEpisodesRaw) {
    const airTime = new Date(row.air_date as string).getTime();

    // ignora placeholders futuros
    if (!Number.isFinite(airTime)) continue;
    if (airTime > now) continue;

    validSeasonsSet.add(row.season_number);
  }
}

  // 2. Busca episódios ordenados por hierarquia cronológica padrão
  const { data: episodes } = await supabaseAdmin
    .from("poplog3_episodes")
    .select("season_number, episode_number, air_date")
    .eq("series_tmdb_id", seriesTmdbId)
    .order("season_number", { ascending: true })
    .order("episode_number", { ascending: true });

  let nextEpisode: UserSeriesProgress["nextEpisode"] = null;

  for (const ep of (episodes ?? []) as Array<{
    season_number: number;
    episode_number: number;
    air_date: string | null;
  }>) {
    // Pula especiais (S00) e blindagem contra temporadas fantasma que não estão no set válido
    if (ep.season_number <= 0 || !validSeasonsSet.has(ep.season_number)) continue;

    const key = `${ep.season_number}-${ep.episode_number}`;
    if (watchedSet.has(key)) continue;

    // Só sugere episódios que já foram ao ar (impede detecção de temporadas futuras/anunciadas)
    if (ep.air_date) {
      const t = new Date(ep.air_date).getTime();
      if (Number.isFinite(t) && t > now) continue;
    }

    nextEpisode = {
      seasonNumber: ep.season_number,
      episodeNumber: ep.episode_number,
      airDate: ep.air_date ?? null,
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
 * Para futura Acompanhando: lista todas as séries com pelo menos 1
 * episódio assistido pelo user, ordenadas por último episódio visto.
 *
 * Retorna metadata mínima da série (título, poster) para listagem rápida.
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
  // Pega ids únicos de séries com progresso, ordenados pelo episódio mais
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
 * Marca todos os episódios JÁ AO AR de uma série como assistidos pelo user.
 * Lê poplog3_episodes (catálogo TMDB já sincronizado) e faz bulk upsert.
 *
 * Útil para o botão "Marcar assistido" da hero da Title Page.
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