import { supabaseAdmin } from "@/server/supabase/admin";
import {
  upsertTitleState,
  deleteTitleState,
  refreshTitleStateAvailability,
} from "@/server/state/user-title-state";
import { formatEpisodeRuntimeLabel, formatRuntimeLabel } from "@/lib/domain-labels";
import { resolveRuntimeByMediaType, type RuntimeResolution } from "@/lib/runtime";
import { getSeriesEpisodeRuntimesMap } from "@/server/runtime/series-episode-runtimes";
import { refreshAvailabilityForUserTitle } from "@/server/streaming/title-availability";
import { formatError, isDebugEnabled, rateLimitedWarn } from "@/server/logging/log-control";

import {
  Poplog3UserTitle,
  UpsertUserTitleInput,
} from "./types";

export type Poplog3UserLibraryItem = Poplog3UserTitle & {
  /** Campos do estado global (preenchidos por getUserLibraryState) */
  computed_state?: string | null;
  watched_episodes?: number;
  aired_episodes?: number;
  total_episodes?: number | null;
  progress_pct?: number;
  duration_sort_minutes?: number | null;
  duration_sort_unavailable?: boolean | null;
  runtime_label?: string | null;
  remaining_runtime_minutes?: number | null;
  remaining_runtime_label?: string | null;
  remaining_runtime_estimated?: boolean;
  average_episode_runtime_minutes?: number | null;
  average_episode_runtime_label?: string | null;
  total_runtime_minutes?: number | null;
  total_runtime_label?: string | null;
  total_runtime_estimated?: boolean;
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
    runtime_minutes: number | null;
    runtime_estimated: boolean;
    total_runtime_minutes: number | null;
    total_runtime_estimated: boolean;
    vote_average: number | null;
    popularity: number | null;
    number_of_episodes: number | null;
    number_of_seasons: number | null;
  } | null;
};

function getPositiveNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : null;
}

function readPositiveNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

function getTitleRuntime(title: { runtime: number | null } | null) {
  return readPositiveNumber(title?.runtime) ?? null;
}

type LibraryStateRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: string | null;
  favorite: boolean;
  liked: boolean | null;
  computed_state: string | null;
  watched_episodes: number;
  aired_episodes: number;
  total_episodes: number | null;
  progress_pct: number;
  duration_sort_minutes: number | null;
  duration_sort_unavailable: boolean | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
  last_event_at: string;
  created_at: string;
};

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
};

const LIBRARY_STATE_SELECT = [
  "tmdb_id",
  "media_type",
  "status",
  "favorite",
  "liked",
  "computed_state",
  "watched_episodes",
  "aired_episodes",
  "total_episodes",
  "progress_pct",
  "duration_sort_minutes",
  "duration_sort_unavailable",
  "best_provider_name",
  "best_provider_type",
  "best_provider_logo",
  "last_event_at",
  "created_at",
].join(", ");

const LIBRARY_TITLE_SELECT = [
  "tmdb_id",
  "media_type",
  "title",
  "original_title",
  "poster_path",
  "backdrop_path",
  "year",
  "release_date",
  "first_air_date",
  "last_air_date",
  "runtime",
  "episode_run_time",
  "vote_average",
  "popularity",
  "number_of_episodes",
  "number_of_seasons",
].join(", ");

const LIBRARY_BATCH_SIZE = 80;
const LOG_TTL_MS = 5 * 60 * 1000;

function chunkArray<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function isTimeoutError(error: unknown) {
  const normalized = formatError(error);
  return /timeout|canceling statement/i.test(
    [normalized.message, normalized.details, normalized.hint].filter(Boolean).join(" "),
  );
}

async function getLibraryStateRows(userId: string, statusFilter: string[]) {
  const { data, error } = await supabaseAdmin
    .from("user_title_state")
    .select(LIBRARY_STATE_SELECT)
    .eq("user_id", userId)
    .in("status", statusFilter)
    .order("last_event_at", { ascending: false });

  if (error) {
    rateLimitedWarn(
      "library:state-query-failed",
      LOG_TTL_MS,
      [
        "[library] state query failed",
        `- query stage: read user state`,
        `- fallback aplicado: biblioteca legada`,
      ].join("\n"),
      formatError(error),
    );
    return [];
  }

  return (data ?? []) as unknown as LibraryStateRow[];
}

async function getLibraryTitleRows(input: {
  stateRows: LibraryStateRow[];
  userTitleCount: number;
}) {
  const rows: TitleData[] = [];
  const idsByType = input.stateRows.reduce<Record<"movie" | "tv", Set<number>>>(
    (acc, row) => {
      acc[row.media_type].add(row.tmdb_id);
      return acc;
    },
    { movie: new Set<number>(), tv: new Set<number>() },
  );

  for (const mediaType of ["movie", "tv"] as const) {
    for (const batch of chunkArray(Array.from(idsByType[mediaType]), LIBRARY_BATCH_SIZE)) {
      if (batch.length === 0) continue;

      const { data, error } = await supabaseAdmin
        .from("poplog3_titles")
        .select(LIBRARY_TITLE_SELECT)
        .eq("media_type", mediaType)
        .in("tmdb_id", batch);

      if (error) {
        const label = isTimeoutError(error)
          ? "[library] titles query timeout"
          : "[library] titles query failed";
        rateLimitedWarn(
          `library:title-query:${mediaType}:${isTimeoutError(error) ? "timeout" : "error"}`,
          LOG_TTL_MS,
          [
            label,
            `- user titles: ${input.userTitleCount}`,
            `- query stage: enrich titles`,
            `- media type: ${mediaType}`,
            `- batch size: ${batch.length}`,
            `- fallback aplicado: partial payload`,
          ].join("\n"),
          formatError(error),
        );
        continue;
      }

      rows.push(...((data ?? []) as unknown as TitleData[]));
    }
  }

  if (isDebugEnabled("DEBUG_LIBRARY_PERF")) {
    console.log(
      [
        "[library] TITLE ENRICHMENT",
        `- Estados do usuário: ${input.stateRows.length}`,
        `- Títulos encontrados: ${rows.length}`,
        `- Batch size: ${LIBRARY_BATCH_SIZE}`,
      ].join("\n"),
    );
  }

  return rows;
}

function logMovieDurationAnalysis(items: Poplog3UserLibraryItem[]) {
  if (!isDebugEnabled("DEBUG_LIBRARY_PERF")) return;

  const movies = items.filter((item) => item.media_type === "movie");
  const sortable = movies.filter((item) => getPositiveNumber(item.duration_sort_minutes)).length;
  const withRuntime = movies.filter((item) => getPositiveNumber(item.title?.runtime)).length;
  const pending = movies.filter(
    (item) => getPositiveNumber(item.title?.runtime) && !getPositiveNumber(item.duration_sort_minutes),
  ).length;
  const unavailable = movies.filter(
    (item) => !getPositiveNumber(item.title?.runtime) && !getPositiveNumber(item.duration_sort_minutes),
  ).length;

  console.log(
    [
      "[duration-movies] MOVIE DURATION ANALYSIS",
      `- Total filmes na biblioteca/watchlist: ${movies.length}`,
      `- Com runtime válido: ${withRuntime}`,
      `- Com duration_sort_minutes preenchido: ${sortable}`,
      `- Pendentes de backfill: ${pending}`,
      `- Duração indisponível real: ${unavailable}`,
      "[duration-movies] FINAL STATUS",
      `✓ Filmes ordenáveis: ${sortable}`,
      unavailable > 0 ? `⚠ Filmes sem duração: ${unavailable}` : "✓ Nenhum filme sem duração",
      "✓ Séries não alteradas",
      "✓ Ordenação unificada preservada",
    ].join("\n"),
  );
}

async function getAiredEpisodeCountsMap(seriesTmdbIds: number[]) {
  const ids = Array.from(
    new Set(seriesTmdbIds.filter((id) => Number.isFinite(id) && id > 0)),
  );
  const counts = new Map<number, number>();

  if (ids.length === 0) return counts;

  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabaseAdmin
    .from("poplog3_episodes")
    .select("series_tmdb_id")
    .in("series_tmdb_id", ids)
    .gt("season_number", 0)
    .not("air_date", "is", null)
    .lte("air_date", today);

  if (error) {
    rateLimitedWarn(
      "library:aired-episode-count-failed",
      LOG_TTL_MS,
      [
        "[library] contagem de episódios falhou",
        "- query stage: aired episode counts",
        "- fallback aplicado: state materializado",
      ].join("\n"),
      formatError(error),
    );
    return counts;
  }

  for (const row of (data ?? []) as Array<{ series_tmdb_id: number }>) {
    counts.set(row.series_tmdb_id, (counts.get(row.series_tmdb_id) ?? 0) + 1);
  }

  return counts;
}

function resolveLibraryRuntimeFields(input: {
  mediaType: "movie" | "tv";
  runtimeResolution: RuntimeResolution;
  airedEpisodes?: number | null;
  watchedEpisodes?: number | null;
  /** Total de episódios do TMDB — usado como fallback quando aired_episodes está indisponível */
  totalEpisodes?: number | null;
  /** Contagem de episódios com runtime real em poplog3_episodes — fallback final para ordenação */
  knownEpisodeCount?: number | null;
}) {
  if (input.mediaType === "movie") {
    const runtimeMinutes = getPositiveNumber(input.runtimeResolution.minutes);
    const runtimeLabel = formatRuntimeLabel(runtimeMinutes, { spaced: true });

    return {
      runtime_minutes: runtimeMinutes,
      runtime_estimated: false,
      total_runtime_minutes: runtimeMinutes,
      total_runtime_estimated: false,
      total_runtime_label: runtimeLabel,
      remaining_runtime_minutes: runtimeMinutes,
      remaining_runtime_estimated: false,
      remaining_runtime_label: runtimeLabel,
      average_episode_runtime_minutes: null,
      average_episode_runtime_label: null,
      duration_sort_minutes: runtimeMinutes,
      runtime_label: runtimeLabel,
    };
  }

  const runtimeMinutes = getPositiveNumber(input.runtimeResolution.minutes);
  const watchedEpisodes = Math.max(input.watchedEpisodes ?? 0, 0);

  // Melhor contagem de episódios disponíveis em cascata:
  // 1. aired_episodes do state  2. number_of_episodes TMDB  3. poplog3_episodes count
  const airedEpisodeCount   = getPositiveNumber(input.airedEpisodes);
  const totalEpisodesCount  = getPositiveNumber(input.totalEpisodes);
  const knownEpisodesCount  = getPositiveNumber(input.knownEpisodeCount);
  const bestEpisodeCount    = airedEpisodeCount ?? totalEpisodesCount ?? knownEpisodesCount;

  const remainingEpisodeCount =
    bestEpisodeCount !== null
      ? Math.max(bestEpisodeCount - watchedEpisodes, 0)
      : null;

  const totalRuntimeMinutes =
    runtimeMinutes !== null && bestEpisodeCount !== null
      ? runtimeMinutes * bestEpisodeCount
      : null;

  const remainingRuntimeMinutes =
    runtimeMinutes !== null && remainingEpisodeCount !== null
      ? runtimeMinutes * remainingEpisodeCount
      : null;

  // durationSortMinutes: tempo restante se > 0, senão total (ex: série 100% assistida
  // na watchlist = foi ressetada, ordena pelo total)
  const durationSortMinutes =
    (remainingRuntimeMinutes ?? 0) > 0
      ? remainingRuntimeMinutes
      : totalRuntimeMinutes ?? null;

  const averageEpisodeRuntimeLabel = formatEpisodeRuntimeLabel(runtimeMinutes, {
    estimated: input.runtimeResolution.estimated,
  });
  const totalRuntimeLabel = formatRuntimeLabel(totalRuntimeMinutes, {
    estimated: input.runtimeResolution.estimated,
    suffix: " total",
  });
  const remainingRuntimeLabel =
    remainingRuntimeMinutes !== null && remainingRuntimeMinutes > 0
      ? formatRuntimeLabel(remainingRuntimeMinutes, {
          estimated: input.runtimeResolution.estimated,
          suffix: " restantes",
        })
      : null;

  // runtime_label exibido no card:
  // - não iniciada (watchedEpisodes = 0) → total da série
  // - iniciada e com restante → tempo restante até o fim
  // - concluída / sem restante → total da série
  const effectiveRuntimeLabel =
    watchedEpisodes === 0
      ? totalRuntimeLabel
      : remainingRuntimeLabel ?? totalRuntimeLabel;

  return {
    runtime_minutes: runtimeMinutes,
    runtime_estimated: input.runtimeResolution.estimated,
    total_runtime_minutes: totalRuntimeMinutes,
    total_runtime_estimated: input.runtimeResolution.estimated,
    total_runtime_label: totalRuntimeLabel,
    remaining_runtime_minutes: remainingRuntimeMinutes,
    remaining_runtime_estimated: input.runtimeResolution.estimated,
    remaining_runtime_label: remainingRuntimeLabel,
    average_episode_runtime_minutes: runtimeMinutes,
    average_episode_runtime_label: averageEpisodeRuntimeLabel,
    duration_sort_minutes: durationSortMinutes,
    runtime_label: effectiveRuntimeLabel,
  };
}

/**
 * Lê a biblioteca do usuário a partir de user_title_state (estado materializado).
 * Retorna null se o usuário não tiver linhas no state — o caller faz fallback para getUserLibrary.
 */
export async function getUserLibraryState(
  userId: string,
  status?: string,
): Promise<Poplog3UserLibraryItem[] | null> {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  const stageRef = { value: totalStartedAt };
  const mark = (stage: string) => {
    perf[stage] = Date.now() - stageRef.value;
    stageRef.value = Date.now();
  };
  const statusFilter = status
    ? [status]
    : ["watchlist", "watching", "watched", "abandoned", "fridge"];

  const stateRows = await getLibraryStateRows(userId, statusFilter);
  mark("state_read");

  if (stateRows.length === 0) return null;

  const tvIds    = stateRows.filter((r) => r.media_type === "tv").map((r) => r.tmdb_id);

  // ── Batch 1: metadados dos títulos ───────────────────────────────────────
  const titles = await getLibraryTitleRows({
    stateRows,
    userTitleCount: stateRows.length,
  });
  mark("titles_read");

  // Fast path da biblioteca: user_title_state já materializa progresso, episódios
  // exibidos e duração ordenável. Evitamos varrer poplog3_episodes no carregamento.
  const episodeRuntimesBySeries = new Map<
    number,
    NonNullable<Parameters<typeof resolveRuntimeByMediaType>[0]["episodes"]>
  >();
  mark("episodes_fast_path");

  // Key MUST include media_type — TMDB IDs are NOT globally unique across movie/tv
  // (e.g. movie 550 = Fight Club, tv 550 = Till Death Us Do Part 1966)
  const titleMap = new Map(
    titles.map((t) => [`${t.tmdb_id}:${t.media_type}`, t]),
  );

  const result = stateRows.map((row) => {
    const titleData = titleMap.get(`${row.tmdb_id}:${row.media_type}`) ?? null;
    const movieRuntime = getTitleRuntime(titleData);
    const runtimeResolution = titleData
      ? resolveRuntimeByMediaType({
          mediaType: row.media_type,
          runtimeMinutes: row.media_type === "movie" ? movieRuntime : titleData.runtime,
          episodeRunTime: titleData.episode_run_time,
          episodes: episodeRuntimesBySeries.get(row.tmdb_id) ?? null,
        })
      : null;
    const runtimeFields = runtimeResolution
      ? resolveLibraryRuntimeFields({
          mediaType: row.media_type,
          runtimeResolution,
          airedEpisodes: row.aired_episodes || null,
          watchedEpisodes: row.watched_episodes,
          totalEpisodes: titleData?.number_of_episodes ?? null,
          knownEpisodeCount: episodeRuntimesBySeries.get(row.tmdb_id)?.length ?? null,
        })
      : null;

    // duration_sort_minutes: fast path — usa o valor já persistido em user_title_state
    // quando disponível (calculado por upsertTitleState em todo evento de escrita).
    // Fallback: valor recalculado em runtime pelo resolveLibraryRuntimeFields
    // (usado para séries recém-adicionadas antes do primeiro upsertTitleState).
    const persistedDurationSort = typeof (row as Record<string, unknown>).duration_sort_minutes === "number"
      ? (row as Record<string, unknown>).duration_sort_minutes as number
      : null;
    const effectiveDurationSortMinutes = persistedDurationSort ?? runtimeFields?.duration_sort_minutes ?? null;

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
      total_episodes: row.total_episodes,
      progress_pct: row.progress_pct,
      duration_sort_minutes: effectiveDurationSortMinutes,
      duration_sort_unavailable: Boolean((row as Record<string, unknown>).duration_sort_unavailable),
      runtime_label: runtimeFields?.runtime_label ?? null,
      remaining_runtime_minutes: runtimeFields?.remaining_runtime_minutes ?? null,
      remaining_runtime_label: runtimeFields?.remaining_runtime_label ?? null,
      remaining_runtime_estimated: runtimeFields?.remaining_runtime_estimated ?? false,
      average_episode_runtime_minutes: runtimeFields?.average_episode_runtime_minutes ?? null,
      average_episode_runtime_label: runtimeFields?.average_episode_runtime_label ?? null,
      total_runtime_minutes: runtimeFields?.total_runtime_minutes ?? null,
      total_runtime_label: runtimeFields?.total_runtime_label ?? null,
      total_runtime_estimated: runtimeFields?.total_runtime_estimated ?? false,
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
            // Fast path: usa o valor materializado em poplog3_titles no carregamento.
            last_air_date: titleData.last_air_date,
            runtime: row.media_type === "movie" ? movieRuntime : titleData.runtime,
            episode_run_time: titleData.episode_run_time,
            runtime_minutes: runtimeFields?.runtime_minutes ?? null,
            runtime_estimated: runtimeFields?.runtime_estimated ?? false,
            total_runtime_minutes: runtimeFields?.total_runtime_minutes ?? null,
            total_runtime_estimated: runtimeFields?.total_runtime_estimated ?? false,
            vote_average: titleData.vote_average,
            popularity: titleData.popularity,
            number_of_episodes: titleData.number_of_episodes,
            number_of_seasons: titleData.number_of_seasons,
          }
        : null,
    } as Poplog3UserLibraryItem;
  });
  mark("response_build");

  logMovieDurationAnalysis(result);
  console.log("[library/perf]", {
    source: "user_title_state",
    rows: stateRows.length,
    tvIds: tvIds.length,
    titles: titles.length,
    ...perf,
    total: Date.now() - totalStartedAt,
  });
  return result;
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
  const tvIds = rows
    .filter((r) => r.media_type === "tv")
    .map((r) => r.tmdb_id as number);

  const { data: titles } = await supabaseAdmin
    .from("poplog3_titles")
    .select(
      "tmdb_id, media_type, title, original_title, poster_path, backdrop_path, year, release_date, first_air_date, last_air_date, runtime, episode_run_time, vote_average, popularity, number_of_episodes, number_of_seasons"
    )
    .in("tmdb_id", tmdbIds)
    .in("media_type", mediaTypes);

  const titleMap = new Map(
    ((titles ?? []) as Array<Record<string, unknown>>).map((t) => [
      `${t.tmdb_id}:${t.media_type}`,
      t,
    ])
  );

  const [episodeRuntimesBySeries, airedEpisodeCountsBySeries] = await Promise.all([
    tvIds.length > 0 ? getSeriesEpisodeRuntimesMap(tvIds, { includeUnaired: true }) : Promise.resolve(new Map()),
    tvIds.length > 0 ? getAiredEpisodeCountsMap(tvIds)    : Promise.resolve(new Map()),
  ]);

  return rows.map((row) => {
    const titleData = titleMap.get(`${row.tmdb_id}:${row.media_type}`) ?? null;
    const movieRuntime = getTitleRuntime(
      titleData
        ? {
            runtime: titleData.runtime as number | null,
          }
        : null,
    );
    const runtimeResolution = titleData
      ? resolveRuntimeByMediaType({
          mediaType: row.media_type as "movie" | "tv",
          runtimeMinutes:
            row.media_type === "movie"
              ? movieRuntime
              : titleData.runtime as number | null,
          episodeRunTime: titleData.episode_run_time as number[] | null,
          episodes: episodeRuntimesBySeries.get(row.tmdb_id as number) ?? null,
        })
      : null;
    const runtimeFields = runtimeResolution
      ? resolveLibraryRuntimeFields({
          mediaType: row.media_type as "movie" | "tv",
          runtimeResolution,
          airedEpisodes: airedEpisodeCountsBySeries.get(row.tmdb_id as number) ?? null,
          watchedEpisodes: 0,
          totalEpisodes: (titleData?.number_of_episodes as number | null) ?? null,
          knownEpisodeCount: episodeRuntimesBySeries.get(row.tmdb_id as number)?.length ?? null,
        })
      : null;

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
      duration_sort_minutes: runtimeFields?.duration_sort_minutes ?? null,
      duration_sort_unavailable: runtimeFields?.duration_sort_minutes === null,
      runtime_label: runtimeFields?.runtime_label ?? null,
      remaining_runtime_minutes: runtimeFields?.remaining_runtime_minutes ?? null,
      remaining_runtime_label: runtimeFields?.remaining_runtime_label ?? null,
      remaining_runtime_estimated: runtimeFields?.remaining_runtime_estimated ?? false,
      average_episode_runtime_minutes: runtimeFields?.average_episode_runtime_minutes ?? null,
      average_episode_runtime_label: runtimeFields?.average_episode_runtime_label ?? null,
      total_runtime_minutes: runtimeFields?.total_runtime_minutes ?? null,
      total_runtime_label: runtimeFields?.total_runtime_label ?? null,
      total_runtime_estimated: runtimeFields?.total_runtime_estimated ?? false,
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
            runtime: row.media_type === "movie" ? movieRuntime : titleData.runtime as number | null,
            episode_run_time: titleData.episode_run_time as number[] | null,
            runtime_minutes: runtimeFields?.runtime_minutes ?? null,
            runtime_estimated: runtimeFields?.runtime_estimated ?? false,
            total_runtime_minutes: runtimeFields?.total_runtime_minutes ?? null,
            total_runtime_estimated: runtimeFields?.total_runtime_estimated ?? false,
            vote_average: titleData.vote_average as number | null,
            popularity: titleData.popularity as number | null,
            number_of_episodes: titleData.number_of_episodes as number | null,
            number_of_seasons: titleData.number_of_seasons as number | null,
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

  await upsertTitleState({
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
  });

  refreshAvailabilityForUserTitle({
    userId: input.userId,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    action: `library_status:${result.status}`,
    endpoint: "/api/library/title",
    contexts: ["library"],
  })
    .then((availabilityResult) => {
      const best = availabilityResult.availability.primaryProvider;
      const providerType: string | null =
        best && "normalizedType" in best
          ? best.normalizedType ?? null
          : best?.type === "streaming"
            ? "subscription"
            : best?.type ?? null;

      return refreshTitleStateAvailability(
        input.userId,
        input.tmdbId,
        input.mediaType,
        best
          ? {
              providerName: best.name,
              providerType,
              providerLogo: best.logoUrl ?? null,
            }
          : null,
      );
    })
    .catch((err) => console.error("[availability] refreshAvailabilityForUserTitle failed", err));

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

  await deleteTitleState(userId, tmdbId, mediaType);
}
