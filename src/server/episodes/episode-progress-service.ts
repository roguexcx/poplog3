import { upsertUserTitleStatus } from "@/server/library/library-service";
import { upsertTitleState } from "@/server/state/user-title-state";
import { isLocalEpisodeProgressEnabled } from "@/server/runtime/local-db-flags";
import {
  filterValidAiredEpisodes,
  getValidSeasonNumbers,
  isValidAiredEpisode,
} from "@/lib/episodes/episode-validators";

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
  /** Total planejado pelo TMDB — pode incluir episódios futuros. Não usar para progresso. */
  totalEpisodes: number | null;
  /**
   * Episódios que realmente foram ao ar (air_date <= now, season > 0).
   * Fonte de verdade para cálculos de progresso, remaining e percentual.
   */
  airedEpisodes: number;
  lastWatchedAt: string | null;
  /** Set serializável "S##E##" para hidratação no client. */
  watchedKeys: EpisodeKey[];
  /** Próximo episódio sugerido — nunca futuro, nunca placeholder, nunca S00. */
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

async function getLocalEpisodeProgressService() {
  return import("@/server/local-services/episode-progress-local.service");
}

async function getSupabaseAdmin() {
  const { supabaseAdmin } = await import("@/server/supabase/admin");
  return supabaseAdmin;
}

/**
 * Garante que a série esteja como "watching" na biblioteca após marcar episódio.
 * Retorna o entry de biblioteca resultante para reutilizar no upsertTitleState.
 *
 * Regra: série com qualquer status diferente de "watched" ou "watching" deve
 * ser promovida para "watching" automaticamente quando o usuário marca episódios.
 * Isso cobre os casos de:
 *   - status="watchlist" (série que o usuário começou a assistir sem mudar status)
 *   - status="fridge" (série na geladeira que voltou para foco)
 *   - status="abandoned" (série retomada via marcação de episódio)
 *   - status=null (série sem entrada prévia na biblioteca)
 */
async function syncLibraryStatusAfterEpisodeMark(
  userId: string,
  seriesTmdbId: number
): Promise<{ status: string; favorite: boolean; liked: boolean | null }> {
  const { data, error } = await (await getSupabaseAdmin()).from("user_titles")
    .select("status, favorite, liked")
    .eq("user_id", userId)
    .eq("tmdb_id", seriesTmdbId)
    .eq("media_type", "tv")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`[episode-progress] falha ao ler status da série: ${error.message}`);

  const currentStatus = (data?.status as string | null) ?? null;
  const favorite = Boolean((data as Record<string, unknown> | null)?.favorite);
  const liked = ((data as Record<string, unknown> | null)?.liked as boolean | null) ?? null;

  // Qualquer status que não seja "watching" ou "watched" deve ser promovido.
  // Inclui explicitamente "watchlist" — série iniciada via marcação de episódio
  // deve sair da watchlist e entrar em "watching".
  const needsPromotion = currentStatus !== "watched" && currentStatus !== "watching";

  if (needsPromotion) {
    await upsertUserTitleStatus({
      userId,
      tmdbId: seriesTmdbId,
      mediaType: "tv",
      status: "watching",
    });
    return { status: "watching", favorite, liked };
  }

  return { status: currentStatus ?? "watching", favorite, liked };
}

export async function toggleEpisodeWatched(
  input: ToggleEpisodeInput
): Promise<UserSeriesProgress> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.toggleEpisodeWatched(input);
  }

  if (input.watched) {
    const { error } = await (await getSupabaseAdmin()).from("user_episodes")
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

    const [libraryEntry, progress] = await Promise.all([
      syncLibraryStatusAfterEpisodeMark(input.userId, input.seriesTmdbId),
      computeUserSeriesProgress(input.userId, input.seriesTmdbId),
    ]);

    await upsertTitleState({
      userId: input.userId,
      tmdbId: input.seriesTmdbId,
      mediaType: "tv",
      seriesProgress: progress,
      libraryEntry,
      event: {
        type: "episode_watched",
        payload: { season: input.seasonNumber, episode: input.episodeNumber },
      },
    });

    return progress;
  } else {
    const { error } = await (await getSupabaseAdmin()).from("user_episodes")
      .delete()
      .eq("user_id", input.userId)
      .eq("series_tmdb_id", input.seriesTmdbId)
      .eq("season_number", input.seasonNumber)
      .eq("episode_number", input.episodeNumber);

    if (error) throw new Error(error.message);

    const [libraryEntry, progress] = await Promise.all([
      syncLibraryStatusAfterEpisodeMark(input.userId, input.seriesTmdbId),
      computeUserSeriesProgress(input.userId, input.seriesTmdbId),
    ]);

    await upsertTitleState({
      userId: input.userId,
      tmdbId: input.seriesTmdbId,
      mediaType: "tv",
      seriesProgress: progress,
      libraryEntry,
      event: {
        type: "episode_unwatched",
        payload: { season: input.seasonNumber, episode: input.episodeNumber },
      },
    });

    return progress;
  }
}

export async function bulkMarkEpisodesWatched(input: {
  userId: string;
  seriesTmdbId: number;
  episodes: Array<{
    seasonNumber: number;
    episodeNumber: number;
    runtimeMinutes?: number | null;
  }>;
  /** Hint para o event log — "season_marked" quando bulk de uma temporada inteira. */
  eventType?: "season_marked" | "episode_watched" | "series_completed";
}): Promise<UserSeriesProgress> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.bulkMarkEpisodesWatched(input);
  }

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

  const { error } = await (await getSupabaseAdmin()).from("user_episodes")
    .upsert(payload, {
      onConflict: "user_id,series_tmdb_id,season_number,episode_number",
    });

  if (error) throw new Error(error.message);

  const [libraryEntry, progress] = await Promise.all([
    syncLibraryStatusAfterEpisodeMark(input.userId, input.seriesTmdbId),
    computeUserSeriesProgress(input.userId, input.seriesTmdbId),
  ]);

  await upsertTitleState({
    userId: input.userId,
    tmdbId: input.seriesTmdbId,
    mediaType: "tv",
    seriesProgress: progress,
    libraryEntry,
    event: {
      type: input.eventType ?? "season_marked",
      payload: { count: input.episodes.length },
    },
  });

  return progress;
}

export async function markSeasonWatched(
  userId: string,
  seriesTmdbId: number,
  seasonNumber: number
): Promise<UserSeriesProgress> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.markSeasonWatched(userId, seriesTmdbId, seasonNumber);
  }

  const today = new Date().toISOString().split("T")[0];

  const { data: episodes, error } = await (await getSupabaseAdmin()).from("poplog3_episodes")
    .select("episode_number, runtime")
    .eq("series_tmdb_id", seriesTmdbId)
    .eq("season_number", seasonNumber)
    .not("air_date", "is", null)
    .lte("air_date", today);

  if (error) throw new Error(error.message);

  const eps = (episodes ?? [])
    .filter((e: { episode_number: number; runtime: number | null }) =>
      isValidAiredEpisode({
        season_number: seasonNumber,
        episode_number: e.episode_number,
        air_date: today,
      })
    )
    .map((e: { episode_number: number; runtime: number | null }) => ({
      seasonNumber,
      episodeNumber: e.episode_number,
      runtimeMinutes: e.runtime ?? null,
    }));

  return bulkMarkEpisodesWatched({
    userId,
    seriesTmdbId,
    episodes: eps,
    eventType: "season_marked",
  });
}

export async function clearSeasonProgress(
  userId: string,
  seriesTmdbId: number,
  seasonNumber: number
): Promise<UserSeriesProgress> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.clearSeasonProgress(userId, seriesTmdbId, seasonNumber);
  }

  const { error } = await (await getSupabaseAdmin()).from("user_episodes")
    .delete()
    .eq("user_id", userId)
    .eq("series_tmdb_id", seriesTmdbId)
    .eq("season_number", seasonNumber);

  if (error) throw new Error(error.message);

  const [libraryEntry, progress] = await Promise.all([
    syncLibraryStatusAfterEpisodeMark(userId, seriesTmdbId),
    computeUserSeriesProgress(userId, seriesTmdbId),
  ]);

  await upsertTitleState({
    userId,
    tmdbId: seriesTmdbId,
    mediaType: "tv",
    seriesProgress: progress,
    libraryEntry,
    event: {
      type: "season_unmarked",
      payload: { season: seasonNumber },
    },
  });

  return progress;
}

export async function clearSeriesProgress(
  userId: string,
  seriesTmdbId: number
): Promise<void> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.clearSeriesProgress(userId, seriesTmdbId);
  }

  const { error } = await (await getSupabaseAdmin()).from("user_episodes")
    .delete()
    .eq("user_id", userId)
    .eq("series_tmdb_id", seriesTmdbId);

  if (error) throw new Error(error.message);

  // Re-computa o estado com progresso zerado (nextEpisode = primeiro aired)
  await upsertTitleState({
    userId,
    tmdbId: seriesTmdbId,
    mediaType: "tv",
    event: { type: "series_reset" },
  });
}

export async function getWatchedEpisodesForSeries(
  userId: string,
  seriesTmdbId: number
): Promise<UserEpisodeRow[]> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.getWatchedEpisodesForSeries(userId, seriesTmdbId);
  }

  const { data, error } = await (await getSupabaseAdmin()).from("user_episodes")
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
 * Calcula progresso de uma única série.
 * Usa 3 queries em paralelo — para uso pontual (toggle, bulk mark).
 * Para carregar N séries de uma vez, use getUserWatchingSeries().
 */
export async function computeUserSeriesProgress(
  userId: string,
  seriesTmdbId: number
): Promise<UserSeriesProgress> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.computeUserSeriesProgress(userId, seriesTmdbId);
  }

  const now = Date.now();

  const [watchedResult, episodesResult] = await Promise.all([
    (await getSupabaseAdmin()).from("user_episodes")
      .select("season_number, episode_number, watched_at, runtime_minutes")
      .eq("user_id", userId)
      .eq("series_tmdb_id", seriesTmdbId),
    (await getSupabaseAdmin()).from("poplog3_episodes")
      .select("season_number, episode_number, air_date")
      .eq("series_tmdb_id", seriesTmdbId)
      .gt("season_number", 0)
      .order("season_number", { ascending: true })
      .order("episode_number", { ascending: true }),
  ]);

  const watched = (watchedResult.data ?? []) as Array<{
    season_number: number;
    episode_number: number;
    watched_at: string;
    runtime_minutes: number | null;
  }>;

  const allEpisodes = (episodesResult.data ?? []) as Array<{
    season_number: number;
    episode_number: number;
    air_date: string | null;
  }>;

  const validCatalogKeys = new Set(
    allEpisodes
      .filter((ep) => isValidAiredEpisode(ep, now))
      .map((ep) => `${ep.season_number}-${ep.episode_number}`)
  );
  const watchedValid = watched.filter((w) =>
    validCatalogKeys.has(`${w.season_number}-${w.episode_number}`)
  );
  const watchedSet = new Set(
    watchedValid.map((w) => `${w.season_number}-${w.episode_number}`)
  );

  const airedEps = filterValidAiredEpisodes(allEpisodes, now);
  const confirmedEpisodes = allEpisodes.filter((ep) => {
    if (!ep.air_date) return false;
    const t = new Date(ep.air_date).getTime();
    return Number.isFinite(t);
  });

  const validSeasonsSet = getValidSeasonNumbers(allEpisodes, now);

  let nextEpisode: UserSeriesProgress["nextEpisode"] = null;
  for (const ep of allEpisodes) {
    if (!validSeasonsSet.has(ep.season_number)) continue;
    if (watchedSet.has(`${ep.season_number}-${ep.episode_number}`)) continue;
    if (!ep.air_date) continue;
    const t = new Date(ep.air_date).getTime();
    if (!Number.isFinite(t) || t > now) continue;
    nextEpisode = {
      seasonNumber: ep.season_number,
      episodeNumber: ep.episode_number,
      airDate: ep.air_date ?? null,
    };
    break;
  }

  const lastWatchedAt =
    watchedValid.length > 0
      ? watchedValid.map((w) => w.watched_at).sort().reverse()[0]
      : null;

  return {
    seriesTmdbId,
    watchedCount: watchedValid.length,
    totalEpisodes: confirmedEpisodes.length > 0 ? confirmedEpisodes.length : null,
    airedEpisodes: airedEps.length,
    lastWatchedAt,
    watchedKeys: watchedValid.map((w) =>
      episodeKey(w.season_number, w.episode_number)
    ),
    nextEpisode,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH: carrega progresso de N séries com 4 queries fixas (independente de N)
// Antes: 3 + N×4 queries seriais. Agora: 4 queries paralelas + cálculo em JS.
// ─────────────────────────────────────────────────────────────────────────────

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
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.getUserWatchingSeries(userId, limit);
  }

  const now = Date.now();

  // Query 1: todos os episódios assistidos do usuário (todas as séries, uma só query)
  const { data: allWatched, error: watchedErr } = await (await getSupabaseAdmin()).from("user_episodes")
    .select("series_tmdb_id, season_number, episode_number, watched_at, runtime_minutes")
    .eq("user_id", userId)
    .order("watched_at", { ascending: false });

  if (watchedErr) {
    console.error("[episode-progress/getUserWatchingSeries] watched query failed", watchedErr);
    return [];
  }

  const watched = (allWatched ?? []) as Array<{
    series_tmdb_id: number;
    season_number: number;
    episode_number: number;
    watched_at: string;
    runtime_minutes: number | null;
  }>;

  if (watched.length === 0) return [];

  // Ordena séries por atividade recente, deduplica, limita
  const orderedIds: number[] = [];
  const seenSeries = new Set<number>();
  for (const row of watched) {
    if (seenSeries.has(row.series_tmdb_id)) continue;
    seenSeries.add(row.series_tmdb_id);
    orderedIds.push(row.series_tmdb_id);
    if (orderedIds.length >= limit) break;
  }

  if (orderedIds.length === 0) return [];

  // Queries 2–4 em paralelo — tudo que precisamos para N séries
  const [titlesResult, userTitlesResult, catalogEpsResult] = await Promise.all([
    (await getSupabaseAdmin()).from("poplog3_titles")
      .select("tmdb_id, title, poster_path, backdrop_path, number_of_episodes, tmdb_payload")
      .eq("media_type", "tv")
      .in("tmdb_id", orderedIds),
    (await getSupabaseAdmin()).from("user_titles")
      .select("tmdb_id, status")
      .eq("user_id", userId)
      .eq("media_type", "tv")
      .in("tmdb_id", orderedIds),
    // Todos os episódios do catálogo para as séries relevantes (filtrado em JS)
    (await getSupabaseAdmin()).from("poplog3_episodes")
      .select("series_tmdb_id, season_number, episode_number, air_date")
      .in("series_tmdb_id", orderedIds)
      .gt("season_number", 0)
      .order("series_tmdb_id", { ascending: true })
      .order("season_number", { ascending: true })
      .order("episode_number", { ascending: true }),
  ]);

  // Indexa metadata por série
  // mediaStatus (ex: "Returning Series", "Ended") vem de tmdb_payload.status
  const titleMap = new Map<number, {
    title: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    mediaStatus: string | null;
    number_of_episodes: number | null;
  }>();
  for (const t of (titlesResult.data ?? []) as Array<{
    tmdb_id: number;
    title: string | null;
    poster_path: string | null;
    backdrop_path: string | null;
    number_of_episodes: number | null;
    tmdb_payload: Record<string, unknown> | null;
  }>) {
    const mediaStatus = (t.tmdb_payload?.status as string | null) ?? null;
    titleMap.set(t.tmdb_id, {
      title: t.title,
      poster_path: t.poster_path,
      backdrop_path: t.backdrop_path,
      mediaStatus,
      number_of_episodes: t.number_of_episodes,
    });
  }

  const userTitleMap = new Map<number, string | null>();
  for (const ut of (userTitlesResult.data ?? []) as Array<{
    tmdb_id: number;
    status: string | null;
  }>) {
    userTitleMap.set(ut.tmdb_id, ut.status);
  }

  // Agrupa episódios do catálogo por série
  const catalogBySeriesId = new Map<number, Array<{
    season_number: number;
    episode_number: number;
    air_date: string | null;
  }>>();
  for (const ep of (catalogEpsResult.data ?? []) as Array<{
    series_tmdb_id: number;
    season_number: number;
    episode_number: number;
    air_date: string | null;
  }>) {
    const list = catalogBySeriesId.get(ep.series_tmdb_id) ?? [];
    list.push(ep);
    catalogBySeriesId.set(ep.series_tmdb_id, list);
  }

  // Agrupa episódios assistidos por série
  const watchedBySeriesId = new Map<number, Array<{
    season_number: number;
    episode_number: number;
    watched_at: string;
  }>>();
  for (const row of watched) {
    if (!seenSeries.has(row.series_tmdb_id)) continue;
    const list = watchedBySeriesId.get(row.series_tmdb_id) ?? [];
    list.push(row);
    watchedBySeriesId.set(row.series_tmdb_id, list);
  }

  // Calcula progresso completo em memória — zero queries adicionais
  const results: UserWatchingSeriesRow[] = [];

  for (const seriesId of orderedIds) {
    const watchedEps = watchedBySeriesId.get(seriesId) ?? [];
    const catalogEps = catalogBySeriesId.get(seriesId) ?? [];
    const meta = titleMap.get(seriesId) ?? null;

    const validCatalogKeys = new Set(
      catalogEps
        .filter((ep) => isValidAiredEpisode(ep, now))
        .map((ep) => `${ep.season_number}-${ep.episode_number}`)
    );
    const watchedValid = watchedEps.filter((w) =>
      validCatalogKeys.has(`${w.season_number}-${w.episode_number}`)
    );
    const watchedSet = new Set(
      watchedValid.map((w) => `${w.season_number}-${w.episode_number}`)
    );

    // Episódios realmente aired — fonte de verdade
    const airedEps = filterValidAiredEpisodes(catalogEps, now);
    const confirmedEpisodes = catalogEps.filter((ep) => {
      if (!ep.air_date) return false;
      const t = new Date(ep.air_date).getTime();
      return Number.isFinite(t);
    });

    // Temporadas com ao menos 1 episódio aired (guard contra temporadas fantasma)
    const validSeasonsSet = getValidSeasonNumbers(catalogEps, now);

    let nextEpisode: UserSeriesProgress["nextEpisode"] = null;
    for (const ep of catalogEps) {
      if (!validSeasonsSet.has(ep.season_number)) continue;
      if (watchedSet.has(`${ep.season_number}-${ep.episode_number}`)) continue;
      if (!ep.air_date) continue;
      const t = new Date(ep.air_date).getTime();
      if (!Number.isFinite(t) || t > now) continue;
      nextEpisode = {
        seasonNumber: ep.season_number,
        episodeNumber: ep.episode_number,
        airDate: ep.air_date,
      };
      break;
    }

    const lastWatchedAt =
      watchedValid.length > 0
        ? watchedValid.map((w) => w.watched_at).sort().reverse()[0]
        : null;

    const totalEpisodes = confirmedEpisodes.length > 0 ? confirmedEpisodes.length : null;

    results.push({
      seriesTmdbId: seriesId,
      watchedCount: watchedValid.length,
      totalEpisodes,
      airedEpisodes: airedEps.length,
      lastWatchedAt,
      watchedKeys: watchedValid.map((w) =>
        episodeKey(w.season_number, w.episode_number)
      ),
      nextEpisode,
      title: meta?.title ?? null,
      posterPath: meta?.poster_path ?? null,
      backdropPath: meta?.backdrop_path ?? null,
      mediaStatus: meta?.mediaStatus ?? null,
      inLibraryStatus: userTitleMap.get(seriesId) ?? null,
    });
  }

  return results;
}

export async function markAllAiredEpisodes(
  userId: string,
  seriesTmdbId: number
): Promise<UserSeriesProgress> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.markAllAiredEpisodes(userId, seriesTmdbId);
  }

  const now = Date.now();

  const { data: episodes, error } = await (await getSupabaseAdmin()).from("poplog3_episodes")
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
  }>).filter((e) => isValidAiredEpisode(e, now));

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
    eventType: "series_completed",
  });
}

export async function markEpisodesUntil(input: {
  userId: string;
  seriesTmdbId: number;
  seasonNumber: number;
  episodeNumber: number;
}): Promise<UserSeriesProgress> {
  if (isLocalEpisodeProgressEnabled()) {
    const local = await getLocalEpisodeProgressService();
    return local.markEpisodesUntil(input);
  }

  const now = Date.now();

  const { data: episodes, error } = await (await getSupabaseAdmin()).from("poplog3_episodes")
    .select("season_number, episode_number, air_date, runtime")
    .eq("series_tmdb_id", input.seriesTmdbId)
    .gt("season_number", 0)
    .order("season_number", { ascending: true })
    .order("episode_number", { ascending: true });

  if (error) {
    console.error("[episode-progress/markUntil/list]", error);
    throw new Error(error.message);
  }

  const toMark = ((episodes ?? []) as Array<{
    season_number: number;
    episode_number: number;
    air_date: string | null;
    runtime: number | null;
  }>).filter((ep) => {
    // nunca marcar episódio futuro
    if (!isValidAiredEpisode(ep, now)) {
      return false;
    }

    // temporadas anteriores entram
    if (ep.season_number < input.seasonNumber) {
      return true;
    }

    // temporadas futuras não entram
    if (ep.season_number > input.seasonNumber) {
      return false;
    }

    // mesma temporada: marca até o episódio escolhido
    return ep.episode_number <= input.episodeNumber;
  });

  return bulkMarkEpisodesWatched({
    userId: input.userId,
    seriesTmdbId: input.seriesTmdbId,
    episodes: toMark.map((ep) => ({
      seasonNumber: ep.season_number,
      episodeNumber: ep.episode_number,
      runtimeMinutes: ep.runtime ?? null,
    })),
    eventType: "episode_watched",
  });
}

