import {
  createUserEvent,
  deleteUserTitleState,
  getExternalIdsCache,
  getCachedTitleRow,
  getUserLibraryItems,
  getUserTitle,
  removeUserTitle as removeUserTitleRow,
  upsertUserTitle,
  upsertCachedTitleRow,
  type TitleCacheRow,
} from "@/server/repositories";
import type {
  Poplog3LibraryStatus,
  Poplog3UserTitle,
  UpsertUserTitleInput,
} from "@/server/library/types";
import type { MediaType, UserTitle } from "@prisma/client";
import {
  isSyntheticTmdbId,
  imdbIdFromSyntheticTmdbId,
} from "@/lib/ids/synthetic-tmdb-id";
import { recoverTitleFromRowSync } from "@/server/titles/recover-canonical-title";
import { isTechnicalIdLike } from "@/lib/titles/display-title";
import {
  hydrateManyTitleAvailability,
  type TitleAvailabilitySummary,
} from "@/server/availability";
import { calculateRemainingSeriesRuntime } from "@/server/library/runtime-calculator";
import {
  formatEpisodeRuntimeLabel,
  formatRemainingRuntimeLabel,
  formatRuntimeLabel,
} from "@/lib/domain-labels";

export type Poplog3UserLibraryItem = Poplog3UserTitle & {
  poplogId?: string | number | null;
  externalIds?: {
    tmdbId?: number;
    imdbId?: string;
    tvdbId?: number;
    traktId?: number | string;
    balloonerismmId?: string;
  };
  identityUsed?: string;
  linkIdUsed?: string | number;
  computed_state?: string | null;
  watched_episodes?: number;
  aired_episodes?: number;
  total_episodes?: number | null;
  progress_pct?: number;
  duration_sort_minutes?: number | null;
  duration_sort_unavailable?: boolean | null;
  /** Campos calculados de runtime (não pertencem ao tipo Prisma) — preenchidos por attachProgressData. */
  remaining_runtime_minutes?: number | null;
  remaining_runtime_label?: string | null;
  remaining_runtime_estimated?: boolean;
  average_episode_runtime_minutes?: number | null;
  average_episode_runtime_label?: string | null;
  total_runtime_minutes?: number | null;
  total_runtime_label?: string | null;
  total_runtime_estimated?: boolean;
  runtime_label?: string | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  /** Disponibilidade normalizada (camada global) — providers + status temporal. */
  availability?: TitleAvailabilitySummary | null;
  availability_us?: TitleAvailabilitySummary | null;
  /** IMDb ID derivado quando tmdb_id é sintético negativo — usado para links e display. */
  imdb_id?: string | null;
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

function dateTime(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function readNumberArray(value: unknown): number[] | null {
  return Array.isArray(value) && value.every((item) => typeof item === "number")
    ? value
    : null;
}

function mapUserTitle(row: UserTitle): Poplog3UserTitle {
  return {
    id: row.id,
    user_id: row.userId,
    tmdb_id: row.tmdbId,
    media_type: row.mediaType,
    status: row.status as Poplog3LibraryStatus,
    rating: row.rating,
    liked: row.liked,
    favorite: row.favorite,
    notes: row.notes,
    started_at: dateTime(row.startedAt),
    finished_at: dateTime(row.finishedAt),
    abandoned_at: dateTime(row.abandonedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function titleRowToLibraryTitle(title: TitleCacheRow): Poplog3UserLibraryItem["title"] {
  // Recuperação canônica LOCAL (sem rede): payload/originalTitle se `title` for
  // técnico/vazio. Background hydration (enrich*) trata os casos restantes.
  const recovered = recoverTitleFromRowSync({
    id: title.id,
    tmdbId: title.tmdbId,
    imdbId: title.imdbId,
    traktId: title.traktId,
    slug: title.slug,
    mediaType: title.mediaType,
    title: title.title,
    originalTitle: title.originalTitle,
    tmdbPayload: title.tmdbPayload,
    sourcePayload: title.sourcePayload,
  });
  return {
    tmdb_id: title.tmdbId,
    media_type: title.mediaType,
    title: recovered.title ?? title.title,
    original_title: title.originalTitle,
    poster_path: title.posterPath,
    backdrop_path: title.backdropPath,
    year: title.year,
    release_date: dateOnly(title.releaseDate),
    first_air_date: dateOnly(title.firstAirDate),
    last_air_date: dateOnly(title.lastAirDate),
    runtime: title.runtime,
    episode_run_time: readNumberArray(title.episodeRunTime),
    runtime_minutes: title.runtime,
    runtime_estimated: false,
    total_runtime_minutes:
      title.mediaType === "tv" && title.runtime != null && title.numberOfEpisodes != null && title.numberOfEpisodes > 0
        ? title.runtime * title.numberOfEpisodes
        : title.runtime,
    total_runtime_estimated: false,
    vote_average: title.voteAverage === null ? null : Number(title.voteAverage),
    popularity: title.popularity === null ? null : Number(title.popularity),
    number_of_episodes: title.numberOfEpisodes,
    number_of_seasons: title.numberOfSeasons,
  };
}

/**
 * Para IDs TMDB positivos sem cache local: busca via Trakt /search/tmdb/{id},
 * persiste em poplog3Title e retorna o row cacheado.
 * Usado como fallback para entradas de biblioteca órfãs (tmdbId positivo sem registro no DB).
 */
async function fetchAndCacheTitleByTmdbId(
  mediaType: MediaType,
  tmdbId: number,
): Promise<TitleCacheRow | null> {
  try {
    const { traktGet, isTraktActive } = await import("@/server/api-clients/trakt/client");
    if (!isTraktActive()) return null;

    const traktType = mediaType === "movie" ? "movie" : "show";
    const results = await traktGet<Array<{
      type?: string;
      movie?: { title?: string; year?: number; runtime?: number | null; ids: { trakt?: number; slug?: string; imdb?: string; tmdb?: number }; images?: { poster?: string[] | null; fanart?: string[] | null } };
      show?: { title?: string; year?: number; runtime?: number | null; ids: { trakt?: number; slug?: string; imdb?: string; tvdb?: number; tmdb?: number }; images?: { poster?: string[] | null; fanart?: string[] | null } };
    }>>(`/search/tmdb/${tmdbId}`, {
      params: { type: traktType, extended: "full,images" },
      ttlSeconds: 7 * 86400,
    });

    const hit = results?.find((r) => r.type === traktType || r[traktType as "movie" | "show"]);
    const item = mediaType === "movie" ? hit?.movie : hit?.show;
    if (!item?.title) return null;

    await upsertCachedTitleRow({
      tmdbId,
      mediaType,
      title: item.title,
      year: item.year ?? null,
      posterPath: item.images?.poster?.[0] ?? null,
      backdropPath: item.images?.fanart?.[0] ?? null,
      runtime: item.runtime && item.runtime > 0 ? item.runtime : null,
      releaseDate: mediaType === "movie" ? null : null,
    });

    return getCachedTitleRow(mediaType, tmdbId);
  } catch {
    return null;
  }
}

/**
 * Para IDs sintéticos negativos: busca dados via Balloonerismm, persiste em poplog3Title
 * com o ID sintético como chave, e retorna o row cacheado para uso imediato.
 *
 * A próxima requisição de biblioteca encontrará os dados direto no DB via getCachedTitleRow.
 */
async function fetchAndCacheSyntheticTitle(
  mediaType: MediaType,
  syntheticTmdbId: number,
  imdbId: string,
): Promise<TitleCacheRow | null> {
  try {
    const { getPoplogTitleDetails } = await import("@/server/titles/poplog-title-details");
    const details = await getPoplogTitleDetails({ mediaType, id: imdbId, sourceHint: "imdb" });
    if (!details?.title) return null;

    await upsertCachedTitleRow({
      tmdbId: syntheticTmdbId,
      mediaType,
      title: details.title,
      originalTitle: details.originalTitle ?? null,
      overview: details.overview ?? null,
      posterPath: details.posterUrl ?? null,
      backdropPath: details.backdropUrl ?? null,
      year: details.year ?? null,
      runtime: details.runtime ?? null,
      voteAverage: details.voteAverage ?? null,
      voteCount: details.voteCount ?? null,
      numberOfSeasons: details.numberOfSeasons ?? null,
      numberOfEpisodes: details.numberOfEpisodes ?? null,
      releaseDate: mediaType === "movie" ? (details.releaseDate ?? null) : null,
      firstAirDate: mediaType === "tv" ? (details.releaseDate ?? null) : null,
      lastAirDate: details.lastAirDate ?? null,
    });

    return getCachedTitleRow(mediaType, syntheticTmdbId);
  } catch {
    return null;
  }
}

async function enrichLibraryItem(row: UserTitle): Promise<Poplog3UserLibraryItem> {
  const base = mapUserTitle(row);
  let titleRow = await getCachedTitleRow(row.mediaType, row.tmdbId);
  let imdbId: string | null = null;

  // Considera a linha INCOMPLETA quando falta poster ou o título é técnico/vazio.
  // (Antes só hidratava quando a linha não existia — então linhas com título mas
  // sem poster, ex.: após correção de mediaType, nunca buscavam a imagem.)
  const needsHydration = (r: TitleCacheRow | null) =>
    !r ||
    !r.posterPath ||
    !r.runtime ||
    isTechnicalIdLike(r.title, { tmdbId: row.tmdbId, imdbId: r.imdbId, poplogId: r.id });

  // Synthetic negative IDs (IMDb-first titles): enrich via Balloonerismm + cache
  if (needsHydration(titleRow) && isSyntheticTmdbId(row.tmdbId)) {
    imdbId = imdbIdFromSyntheticTmdbId(row.tmdbId);
    if (imdbId) {
      const fetched = await fetchAndCacheSyntheticTitle(row.mediaType, row.tmdbId, imdbId);
      if (fetched) titleRow = fetched;
    }
  }

  // Positive tmdbIds incompletos: tenta cross-reference via Trakt.
  if (needsHydration(titleRow) && row.tmdbId > 0) {
    const fetched = await fetchAndCacheTitleByTmdbId(row.mediaType, row.tmdbId);
    if (fetched) titleRow = fetched;
  }

  const externalRow = await getExternalIdsCache(row.mediaType, row.tmdbId);
  const tvdbId = externalRow?.tvdbId ? Number(externalRow.tvdbId) : undefined;
  const externalImdbId = externalRow?.imdbId ?? imdbId ?? undefined;
  const externalIds = {
    tmdbId: row.tmdbId,
    ...(externalImdbId ? { imdbId: externalImdbId, balloonerismmId: externalImdbId } : {}),
    ...(Number.isFinite(tvdbId) ? { tvdbId } : {}),
    ...(externalRow?.traktId ? { traktId: externalRow.traktId } : {}),
  };
  const linkIdUsed = titleRow?.id ?? externalImdbId ?? row.tmdbId;

  return {
    ...base,
    poplogId: titleRow?.id ?? null,
    externalIds,
    identityUsed: titleRow?.id ? "poplog_id" : externalImdbId ? "imdb_id" : "tmdb_id_alias",
    linkIdUsed,
    imdb_id: externalImdbId ?? null,
    title: titleRow ? titleRowToLibraryTitle(titleRow) : null,
  };
}

async function attachProgressData(userId: string, items: Poplog3UserLibraryItem[]): Promise<void> {
  const tvItems = items.filter((i) => i.media_type === "tv");

  for (const item of items.filter((i) => i.media_type === "movie")) {
    const runtime = item.title?.runtime ?? item.title?.runtime_minutes ?? null;
    const validRuntime = runtime != null && Number.isFinite(runtime) && runtime > 0 ? runtime : null;
    item.duration_sort_minutes = validRuntime;
    item.duration_sort_unavailable = validRuntime === null;
    item.runtime_label = formatRuntimeLabel(validRuntime);
    item.total_runtime_minutes = validRuntime;
    item.total_runtime_label = formatRuntimeLabel(validRuntime);
    item.total_runtime_estimated = false;
  }

  try {
    const { db: database } = await import("@/server/db/client");
    await Promise.all(
      items.filter((item) => item.media_type === "movie").map((item) =>
        database.userTitleState.updateMany({
          where: { userId, tmdbId: item.tmdb_id, mediaType: "movie" },
          data: {
            durationSortMinutes: item.duration_sort_minutes ?? null,
            durationSortUnavailable: item.duration_sort_unavailable === true,
          },
        })
      ),
    );
  } catch (err) {
    console.warn("[library] falha ao materializar duração de filmes:", err);
  }

  if (tvItems.length === 0) return;
  try {
    const { db: database } = await import("@/server/db/client");
    const tvIds = tvItems.map((i) => i.tmdb_id);
    const [states, episodes] = await Promise.all([
      database.userTitleState.findMany({
        where: { userId, mediaType: "tv", tmdbId: { in: tvIds } },
        select: {
          tmdbId: true,
          watchedEpisodes: true,
          airedEpisodes: true,
          watchedKeys: true,
          progressPct: true,
          computedState: true,
        },
      }),
      database.poplog3Episode.findMany({
        where: { seriesTmdbId: { in: tvIds }, seasonNumber: { gt: 0 } },
        select: {
          seriesTmdbId: true,
          seasonNumber: true,
          episodeNumber: true,
          airDate: true,
          runtime: true,
        },
      }),
    ]);
    const stateMap = new Map(states.map((s) => [s.tmdbId, s]));
    const episodesBySeries = new Map<number, typeof episodes>();
    for (const episode of episodes) {
      const list = episodesBySeries.get(episode.seriesTmdbId) ?? [];
      list.push(episode);
      episodesBySeries.set(episode.seriesTmdbId, list);
    }

    for (const item of tvItems) {
      const state = stateMap.get(item.tmdb_id);
      const watched = state?.watchedEpisodes ?? 0;
      const aired   = state?.airedEpisodes ?? 0;
      const total   = item.title?.number_of_episodes ?? (aired > 0 ? aired : null);
      const epRuntime = item.title?.runtime ?? item.title?.runtime_minutes ?? null;
      item.watched_episodes = watched;
      item.total_episodes   = total != null && total > 0 ? total : null;
      item.progress_pct = state?.progressPct ?? (aired > 0 ? Math.min(100, Math.round((watched / aired) * 100)) : 0);

      const watchedKeys = Array.isArray(state?.watchedKeys)
        ? state.watchedKeys.filter((key): key is string => typeof key === "string")
        : [];
      const seriesEpisodes = episodesBySeries.get(item.tmdb_id) ?? [];
      const runtime = calculateRemainingSeriesRuntime({
        episodes: seriesEpisodes,
        watchedKeys,
        fallbackEpisodeRuntime: epRuntime,
      });
      item.aired_episodes = runtime.airedEpisodes > 0 ? runtime.airedEpisodes : aired;
      item.computed_state = state?.computedState ?? null;

      // Quando o catálogo de episódios ainda não está hidratado, usa apenas os
      // episódios já exibidos informados pelo estado — nunca o total futuro.
      const fallbackRemainingEpisodes = Math.max(0, aired - watched);
      const fallbackMinutes =
        seriesEpisodes.length === 0 && aired > 0 && fallbackRemainingEpisodes > 0 && epRuntime && epRuntime > 0
          ? fallbackRemainingEpisodes * epRuntime
          : null;
      const remainingMinutes = fallbackMinutes ?? runtime.minutes;
      const estimated = runtime.estimated || fallbackMinutes !== null;
      const pendingEpisodes = seriesEpisodes.length > 0
        ? runtime.remainingEpisodes
        : aired > 0
          ? fallbackRemainingEpisodes
          : null;

      if (
        pendingEpisodes !== null &&
        item.status !== "abandoned" &&
        item.status !== "fridge" &&
        (item.status === "watching" || item.status === "watched" || watched > 0)
      ) {
        item.computed_state = pendingEpisodes > 0
          ? "in_progress"
          : item.status === "watched"
            ? "completed"
            : "up_to_date";
      }

      item.remaining_runtime_minutes = remainingMinutes;
      item.remaining_runtime_estimated = estimated;
      item.remaining_runtime_label = remainingMinutes === 0
        ? "Em dia"
        : formatRemainingRuntimeLabel(remainingMinutes, { estimated });
      item.duration_sort_minutes = remainingMinutes;
      item.duration_sort_unavailable = runtime.unavailable && fallbackMinutes === null;
      item.average_episode_runtime_minutes = runtime.averageEpisodeMinutes ?? epRuntime;
      item.average_episode_runtime_label = formatEpisodeRuntimeLabel(
        item.average_episode_runtime_minutes,
        { estimated: runtime.averageEpisodeMinutes === null && epRuntime != null },
      );

      if (total != null && total > 0 && epRuntime != null && epRuntime > 0) {
        item.total_runtime_minutes = total * epRuntime;
        item.total_runtime_label = formatRuntimeLabel(item.total_runtime_minutes, { estimated: true });
        item.total_runtime_estimated = true;
      }
    }

    await Promise.all(
      tvItems.map((item) =>
        database.userTitleState.updateMany({
          where: { userId, tmdbId: item.tmdb_id, mediaType: "tv" },
          data: {
            durationSortMinutes: item.duration_sort_minutes ?? null,
            durationSortUnavailable: item.duration_sort_unavailable === true,
          },
        })
      ),
    );
  } catch (err) {
    console.warn("[library] falha ao enriquecer progresso:", err);
  }
}

/**
 * Hidrata disponibilidade (providers + status) para todos os itens da biblioteca.
 *
 * Usa cacheOnly=true para não disparar chamadas ao vivo ao Balloonerismm durante listas
 * (evita tempestades de requisição). warmCold=true agenda aquecimento em background
 * dos itens sem cache — o próximo reload já terá os dados.
 *
 * Prioridade do badge:
 *   1. catalog_availability (hydrateManyTitleAvailability) — mais fresco.
 *   2. user_title_state.bestProvider* — materializado no upsert, usado como fallback.
 *
 * Motivos possíveis de badge ausente (todos logados):
 *   - "state:unavailable" → cache diz que não há provider BR (pode ser sentinela stale).
 *   - "state:unresolved"  → sem imdbId resolvível; warm foi agendado.
 *   - "no-best-provider"  → summary veio mas bestProvider é null.
 */
async function attachAvailabilityData(
  userId: string,
  items: Poplog3UserLibraryItem[],
): Promise<void> {
  if (items.length === 0) return;

  // --- Passo 1: batch read user_title_state para fallback de best_provider_* ---
  try {
    const { db: database } = await import("@/server/db/client");
    const states = await database.userTitleState.findMany({
      where: { userId, tmdbId: { in: items.map((i) => i.tmdb_id) } },
      select: {
        tmdbId: true, mediaType: true,
        bestProviderName: true, bestProviderType: true, bestProviderLogo: true,
      },
    });
    const stateMap = new Map(
      states.map((s) => [`${s.mediaType}:${s.tmdbId}`, s]),
    );
    for (const item of items) {
      const s = stateMap.get(`${item.media_type}:${item.tmdb_id}`);
      if (!s) continue;
      // Preenche apenas se ainda não foi definido (será sobrescrito pelo hydrate abaixo)
      item.best_provider_name ??= s.bestProviderName ?? null;
      item.best_provider_type ??= s.bestProviderType ?? null;
      item.best_provider_logo ??= s.bestProviderLogo ?? null;
    }
  } catch (err) {
    console.warn("[library] falha ao ler user_title_state providers:", err);
  }

  // --- Passo 2: hydrate via catalog_availability (cache-first, warm em background) ---
  try {
    const hydrationInputs = items.map((item) => ({
      key: `${item.media_type}:${item.tmdb_id}`,
      input: {
        mediaType: item.media_type as "movie" | "tv",
        imdbId: item.imdb_id ?? null,
        tmdbId: item.tmdb_id > 0 ? item.tmdb_id : null,
        releaseDate: item.title?.release_date ?? null,
        firstAirDate: item.title?.first_air_date ?? null,
        title: item.title?.title ?? null,
        year: item.title?.year ?? null,
      },
    }));

    const [availabilityMap, availabilityUsMap] = await Promise.all([
      hydrateManyTitleAvailability(
        hydrationInputs.map(({ key, input }) => ({ key, input: { ...input, region: "BR" } })),
        { cacheOnly: true, warmCold: true },
      ),
      hydrateManyTitleAvailability(
        hydrationInputs.map(({ key, input }) => ({ key, input: { ...input, region: "US" } })),
        { cacheOnly: true, warmCold: true },
      ),
    ]);

    const uid = userId.slice(0, 8);
    let resolved = 0; let unavailable = 0; let unresolved = 0;

    for (const item of items) {
      const key = `${item.media_type}:${item.tmdb_id}`;
      const summary = availabilityMap.get(key);
      item.availability_us = availabilityUsMap.get(key) ?? null;
      if (!summary) continue;

      item.availability = summary;

      if (summary.bestProvider) {
        // Override com dado mais fresco do catalog_availability
        item.best_provider_name = summary.bestProvider.name;
        item.best_provider_type = summary.bestProvider.type;
        item.best_provider_logo = summary.bestProvider.logoUrl ?? null;
        resolved++;
      } else {
        // Log de diagnóstico para badges ausentes
        const title = item.title?.title ?? `${item.media_type}:${item.tmdb_id}`;
        const reason = !item.imdb_id ? "no-imdbId" : summary.state !== "available" ? `state:${summary.state}` : "no-best-provider";
        console.log(
          `[library:availability] sem badge | "${title}" imdb=${item.imdb_id ?? "?"} tmdb=${item.tmdb_id} state=${summary.state} reason=${reason}`,
        );
        if (summary.state === "unavailable") unavailable++;
        else unresolved++;
      }
    }

    console.log(
      `[library:availability] uid=${uid} total=${items.length} resolved=${resolved} unavailable=${unavailable} unresolved=${unresolved}`,
    );
  } catch (err) {
    console.warn("[library] falha ao hidratar availability:", err);
  }
}

export async function getUserLibrary(
  userId: string,
  status?: string,
): Promise<Poplog3UserLibraryItem[]> {
  const result = await getUserLibraryItems({
    userId,
    status: status as Poplog3LibraryStatus | undefined,
  });
  if (!result.ok) throw new Error(result.error);

  const items = await Promise.all(result.data.map(enrichLibraryItem));

  await attachProgressData(userId, items);
  await attachAvailabilityData(userId, items);

  const withTitle  = items.filter((i) => i.title !== null).length;
  const noTitle    = items.length - withTitle;
  const withImages = items.filter((i) => !!(i.title?.backdrop_path || i.title?.poster_path)).length;
  const uid = userId.slice(0, 8);
  console.log(
    `[library] loaded | uid=${uid} total=${items.length} with-title=${withTitle} no-title=${noTitle} with-images=${withImages}${status ? ` status=${status}` : ""}`,
  );
  if (noTitle > 0) {
    const missing = items
      .filter((i) => i.title === null)
      .map((i) => `${i.media_type}:${i.tmdb_id}`)
      .join(", ");
    console.warn(`[library] sem cache de título | ${missing}`);
  }

  return items;
}

export async function getUserLibraryState(
  userId: string,
  status?: string,
): Promise<Poplog3UserLibraryItem[] | null> {
  const rows = await getUserLibrary(userId, status);
  return rows.length > 0 ? rows : null;
}

/**
 * Identificadores da biblioteca do usuário (apenas IDs) para filtros de descoberta —
 * leitura barata, SEM enriquecer título nem hidratar disponibilidade.
 *
 * Retorna dois conjuntos com chaves no formato consumido por get-title-page-data:
 *   - tmdbKeys: `${mediaType}:${tmdbId}` (cobre IDs positivos e sintéticos negativos)
 *   - imdbKeys: `${mediaType}:${imdbId}` (sintético → derivado; positivo → external-ids em lote)
 */
export async function getUserLibraryIdentifiers(
  userId: string,
): Promise<{ tmdbKeys: Set<string>; imdbKeys: Set<string> }> {
  const tmdbKeys = new Set<string>();
  const imdbKeys = new Set<string>();

  const result = await getUserLibraryItems({ userId });
  if (!result.ok) return { tmdbKeys, imdbKeys };

  const positiveTmdbIds: number[] = [];
  for (const row of result.data) {
    const mt = row.mediaType;
    tmdbKeys.add(`${mt}:${row.tmdbId}`);

    if (isSyntheticTmdbId(row.tmdbId)) {
      const imdbId = imdbIdFromSyntheticTmdbId(row.tmdbId);
      if (imdbId) imdbKeys.add(`${mt}:${imdbId}`);
    } else if (row.tmdbId > 0) {
      positiveTmdbIds.push(row.tmdbId);
    }
  }

  // External-ids em UMA query em lote para os tmdbIds positivos.
  if (positiveTmdbIds.length > 0) {
    try {
      const { db: database } = await import("@/server/db/client");
      const rows = await database.titleExternalId.findMany({
        where: { tmdbId: { in: positiveTmdbIds } },
        select: { tmdbId: true, mediaType: true, imdbId: true },
      });
      for (const r of rows) {
        if (r.imdbId) imdbKeys.add(`${r.mediaType}:${r.imdbId}`);
      }
    } catch (err) {
      console.warn("[library] getUserLibraryIdentifiers external-ids batch falhou:", err);
    }
  }

  return { tmdbKeys, imdbKeys };
}

export async function getUserTitleStatus(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv",
): Promise<Poplog3UserTitle | null> {
  const result = await getUserTitle({ userId, tmdbId, mediaType });
  if (!result.ok) throw new Error(result.error);
  return result.data ? mapUserTitle(result.data) : null;
}

export async function upsertUserTitleStatus(
  input: UpsertUserTitleInput,
): Promise<Poplog3UserTitle> {
  const result = await upsertUserTitle(input);
  if (!result.ok) throw new Error(result.error);

  const mapped = mapUserTitle(result.data);
  const { upsertTitleState } = await import("@/server/state/user-title-state");
  await upsertTitleState({
    userId: input.userId,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    libraryEntry: {
      status: input.status,
      favorite: input.favorite ?? false,
      liked: input.liked ?? null,
    },
  });
  await createUserEvent({
    userId: input.userId,
    tmdbId: input.tmdbId,
    mediaType: input.mediaType,
    eventType: input.mediaType === "movie" && input.status === "watched"
      ? "movie_watched"
      : "status_changed",
    payload: { status: input.status, source: "local-service" },
  });

  return mapped;
}

export async function removeUserTitle(
  userId: string,
  tmdbId: number,
  mediaType: "movie" | "tv",
): Promise<void> {
  const result = await removeUserTitleRow({ userId, tmdbId, mediaType });
  if (!result.ok) throw new Error(result.error);
  await deleteUserTitleState({ userId, tmdbId, mediaType });
  await createUserEvent({
    userId,
    tmdbId,
    mediaType,
    eventType: "status_changed",
    payload: { removed: true, source: "local-service" },
  });
}
