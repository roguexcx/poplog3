import type { NewEpisodeItem } from "@/app/api/poplog3/continuity/new-episodes/route";
import type { UpcomingEpisodeItem } from "@/app/api/poplog3/continuity/upcoming-episodes/route";
import type { DiscoverMediaItem } from "@/server/agenda/discover-service";
import { normalizeTmdbPopularity, popularityToVisualWeight } from "@/lib/score/tmdb-popularity";
import {
  editorialBalanceEngine,
  type EditorialContext,
} from "@/server/agenda/editorial-balance-engine";
import {
  computeBrazilianProductionBonus,
  applyLegacyBrazilianBonus,
} from "@/server/agenda/editorial-regional-bonus";
import {
  buildTemporalTimeline,
  classifyAirDate,
  daysBetweenDates,
  detectHiatusReturn,
  isSeasonFinale,
} from "@/server/agenda/temporal-layer-engine";
import type {
  AgendaEvent,
  AgendaEventType,
  AgendaV2CompatResponse,
  LegacyAgendaMovie,
  LegacyAgendaTv,
} from "@/server/agenda/types";
import { getCachedEpisode, getCachedSeason } from "@/server/cache/season-cache";
import { db } from "@/server/db/client";
import { getUserTitleStates, type UserTitleState } from "@/server/state/user-title-state";
import { formatEpisodeRuntimeLabel } from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getSeriesEpisodeRuntimesMap } from "@/server/runtime/series-episode-runtimes";
import { getLeavingSoonAvailabilityEvents } from "@/server/streaming/availability-events";
import { editorialCacheTTL } from "@/server/cache/cache-config";

type TmdbPageResult<T> = {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
};

type TmdbMovie = DiscoverMediaItem & {
  title: string;
  release_date: string;
};

type TmdbTv = DiscoverMediaItem & {
  name: string;
  first_air_date: string;
};

type AgendaEngineOptions = {
  region?: string;
};

const DAY_MS = 86_400_000;
const WITHOUT_TALK = "10767,10763";

function dateAdd(days: number, base = new Date()): string {
  return new Date(base.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

function mergeDedup<T extends { id: number }>(
  ...settled: PromiseSettledResult<TmdbPageResult<T>>[]
): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const result of settled) {
    if (result.status !== "fulfilled") continue;
    for (const item of result.value.results) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

function isTalkOrNews(item: { genre_ids: number[] }): boolean {
  return item.genre_ids.some((genreId) => genreId === 10767 || genreId === 10763);
}

function dateOnly(value: Date | null | undefined): string | null {
  return value ? value.toISOString().slice(0, 10) : null;
}

function normalizeMovie(movie: TmdbMovie): LegacyAgendaMovie {
  return {
    id: movie.id,
    media_type: "movie",
    title: movie.title,
    original_language: movie.original_language,
    poster_path: movie.poster_path,
    backdrop_path: movie.backdrop_path,
    release_date: movie.release_date ?? "",
    vote_average: movie.vote_average,
    vote_count: movie.vote_count,
    popularity: movie.popularity,
    overview: movie.overview,
    genre_ids: movie.genre_ids,
  };
}

function normalizeTv(tv: TmdbTv): LegacyAgendaTv {
  return {
    id: tv.id,
    media_type: "tv",
    title: tv.name,
    original_language: tv.original_language,
    poster_path: tv.poster_path,
    backdrop_path: tv.backdrop_path,
    first_air_date: tv.first_air_date ?? "",
    vote_average: tv.vote_average,
    vote_count: tv.vote_count,
    popularity: tv.popularity,
    overview: tv.overview,
    genre_ids: tv.genre_ids,
  };
}

function eventFromLegacyMovie(
  movie: LegacyAgendaMovie,
  type: AgendaEventType,
  baseScore: number,
): AgendaEvent {
  const airDate = movie.release_date || null;
  return {
    id: `${type}-movie-${movie.id}`,
    type,
    tmdbId: movie.id,
    mediaType: "movie",
    title: movie.title,
    posterPath: movie.poster_path,
    backdropPath: movie.backdrop_path,
    layer: classifyAirDate(airDate),
    airDate,
    daysUntil: airDate ? daysBetweenDates(airDate) : null,
    visualWeight:
      movie.vote_count > 1000
        ? "hero"
        : popularityToVisualWeight(movie.popularity, "movie"),
    score: baseScore + normalizeTmdbPopularity(movie.popularity) * 40 + movie.vote_average,
  };
}

async function fetchLegacyAgenda(): Promise<{
  nowPlaying: LegacyAgendaMovie[];
  upcoming: LegacyAgendaMovie[];
  airingToday: LegacyAgendaTv[];
  onTheAir: LegacyAgendaTv[];
  newSeries: LegacyAgendaTv[];
  soonToReturn: LegacyAgendaTv[];
}> {
  return {
    nowPlaying: [],
    upcoming: [],
    airingToday: [],
    onTheAir: [],
    newSeries: [],
    soonToReturn: [],
  };
}

async function fetchUserLibraryIds(userId: string | null): Promise<Record<string, string>> {
  if (!userId) return {};

  const data = await db.userTitle.findMany({
    where: { userId },
    select: {
      tmdbId: true,
      mediaType: true,
      status: true,
    },
  });

  const ids: Record<string, string> = {};
  for (const row of data) {
    ids[`${row.mediaType}-${row.tmdbId}`] = row.status;
  }
  return ids;
}

async function buildNewEpisodeItems(userId: string | null): Promise<NewEpisodeItem[]> {
  if (!userId) return [];

  const states = await getUserTitleStates(userId, {
    mediaType: "tv",
    status: ["watching", "watchlist"],
    limit: 80,
  });
  const active = states.filter((state) => {
    const behind = Math.max(0, state.aired_episodes - state.watched_episodes);
    return (
      state.next_season != null &&
      state.next_episode != null &&
      behind > 0 &&
      behind <= 5
    );
  });

  if (active.length === 0) return [];

  const data = await db.poplog3Title.findMany({
    where: {
      mediaType: "tv",
      tmdbId: { in: active.map((state) => state.tmdb_id) },
    },
  });

  const titleMap = new Map<number, Record<string, unknown>>(
    data.map((title) => [
      title.tmdbId,
      {
        tmdb_id: title.tmdbId,
        title: title.title,
        original_title: title.originalTitle,
        poster_path: title.posterPath,
        backdrop_path: title.backdropPath,
        last_air_date: dateOnly(title.lastAirDate),
        runtime: title.runtime,
        episode_run_time: title.episodeRunTime,
      },
    ]),
  );
  const episodeData = await Promise.all(
    active.map((state) =>
      getCachedEpisode(state.tmdb_id, state.next_season ?? 1, state.next_episode ?? 1),
    ),
  );
  const episodeRuntimesBySeries = await getSeriesEpisodeRuntimesMap(
    active.map((state) => state.tmdb_id),
  );

  return active.slice(0, 12).map((state, index) => {
    const title = titleMap.get(state.tmdb_id);
    const lastAirDate =
      typeof title?.last_air_date === "string" ? title.last_air_date : state.next_episode_air_date;
    const daysSince = lastAirDate
      ? Math.floor((Date.now() - new Date(lastAirDate).getTime()) / DAY_MS)
      : null;
    const episodeRunTime = Array.isArray(title?.episode_run_time)
      ? (title.episode_run_time as number[])
      : null;
    const runtimeResolution = resolveRuntimeByMediaType({
      mediaType: "tv",
      episodeRunTime,
      episodes: episodeRuntimesBySeries.get(state.tmdb_id) ?? null,
    });

    return {
      content_id: `tv-${state.tmdb_id}`,
      tmdb_id: state.tmdb_id,
      title: typeof title?.title === "string" ? title.title : `Série ${state.tmdb_id}`,
      original_title: typeof title?.original_title === "string" ? title.original_title : null,
      poster_path: typeof title?.poster_path === "string" ? title.poster_path : null,
      backdrop_path: typeof title?.backdrop_path === "string" ? title.backdrop_path : null,
      computed_state: state.computed_state,
      watched_episodes: state.watched_episodes,
      aired_episodes: state.aired_episodes,
      episodes_behind: Math.max(0, state.aired_episodes - state.watched_episodes),
      progress_pct: state.progress_pct,
      next_season: state.next_season,
      next_episode: state.next_episode,
      next_episode_name: episodeData[index]?.name ?? null,
      next_episode_still_path: episodeData[index]?.still_path ?? null,
      next_episode_air_date: state.next_episode_air_date,
      last_air_date: lastAirDate ?? null,
      days_since_new_episode: daysSince,
      runtime: runtimeResolution.minutes,
      runtime_label: formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
        estimated: runtimeResolution.estimated,
      }),
      season_watched: null,
      season_total: null,
    };
  });
}

async function buildUpcomingEpisodeItems(userId: string | null): Promise<UpcomingEpisodeItem[]> {
  if (!userId) return [];

  const tomorrow = dateAdd(1);
  const cutoff = dateAdd(30); // 30 dias (era 90) — alinhado com a janela da UI
  const states = (
    await getUserTitleStates(userId, {
      mediaType: "tv",
      status: ["watching", "watchlist"],
      limit: 100,
    })
  )
    .filter(
      (state) =>
        state.next_season != null &&
        state.next_episode != null &&
        state.next_episode_air_date != null &&
        state.next_episode_air_date >= tomorrow &&
        state.next_episode_air_date <= cutoff,
    )
    .sort((a, b) =>
      (a.next_episode_air_date ?? "").localeCompare(b.next_episode_air_date ?? ""),
    )
    .slice(0, 24);

  if (states.length === 0) return [];

  const data = await db.poplog3Title.findMany({
    where: {
      mediaType: "tv",
      tmdbId: { in: states.map((state) => state.tmdb_id) },
    },
  });

  const titleMap = new Map<number, Record<string, unknown>>(
    data.map((title) => [
      title.tmdbId,
      {
        tmdb_id: title.tmdbId,
        title: title.title,
        original_title: title.originalTitle,
        poster_path: title.posterPath,
        backdrop_path: title.backdropPath,
      },
    ]),
  );
  const episodeData = await Promise.all(
    states.map((state) =>
      getCachedEpisode(state.tmdb_id, state.next_season ?? 1, state.next_episode ?? 1),
    ),
  );

  return states.map((state, index) => {
    const title = titleMap.get(state.tmdb_id);
    const airDate = state.next_episode_air_date ?? tomorrow;
    return {
      content_id: `tv-${state.tmdb_id}`,
      tmdb_id: state.tmdb_id,
      title: typeof title?.title === "string" ? title.title : `Série ${state.tmdb_id}`,
      poster_path: typeof title?.poster_path === "string" ? title.poster_path : null,
      backdrop_path: typeof title?.backdrop_path === "string" ? title.backdrop_path : null,
      status: state.status ?? "watching",
      next_season: state.next_season ?? 1,
      next_episode: state.next_episode ?? 1,
      next_episode_name: episodeData[index]?.name ?? null,
      next_episode_still_path: episodeData[index]?.still_path ?? null,
      next_episode_air_date: airDate,
      days_until: Math.ceil((new Date(airDate).getTime() - Date.now()) / DAY_MS),
    };
  });
}

type AvailabilityAgendaRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  provider_name: string;
  provider_logo_path: string | null;
  availability_type: string;
  country: string;
  last_synced_at: string | null;
};

type AvailabilityTitleRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string | null;
  original_title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  first_air_date: string | null;
  popularity: number | null;
  vote_average: number | null;
};

async function fetchAvailabilityAgendaEvents(input: {
  country: "BR" | "US";
  availabilityTypes: string[];
  eventType: AgendaEventType;
  baseScore: number;
  limit?: number;
}): Promise<AgendaEvent[]> {
  const providerTypes = input.availabilityTypes.map((type) =>
    type === "streaming" || type === "flatrate" ? "subscription" : type,
  ) as Array<"subscription" | "rent" | "buy" | "free" | "ads" | "unknown">;
  const availabilityRows = await db.catalogAvailability.findMany({
    where: {
      providerRegion: input.country,
      providerType: { in: providerTypes },
      tmdbId: { not: null },
      expiresAt: { gt: new Date() },
    },
    orderBy: { checkedAt: "desc" },
    take: input.limit ?? 30,
  });

  const rows = availabilityRows.map((row) => ({
    tmdb_id: Number(row.tmdbId),
    media_type: row.mediaType,
    provider_name: row.providerName,
    provider_logo_path: row.providerLogoUrl,
    availability_type: row.providerType,
    country: row.providerRegion,
    last_synced_at: row.checkedAt.toISOString(),
  } satisfies AvailabilityAgendaRow));
  if (!rows.length) return [];

  const titleKeys = rows.map((row) => `${row.media_type}:${row.tmdb_id}`);
  const movieIds = rows.filter((row) => row.media_type === "movie").map((row) => row.tmdb_id);
  const tvIds = rows.filter((row) => row.media_type === "tv").map((row) => row.tmdb_id);

  const [movieTitles, tvTitles] = await Promise.all([
    movieIds.length
      ? db.poplog3Title.findMany({ where: { mediaType: "movie", tmdbId: { in: movieIds } } })
      : Promise.resolve([]),
    tvIds.length
      ? db.poplog3Title.findMany({ where: { mediaType: "tv", tmdbId: { in: tvIds } } })
      : Promise.resolve([]),
  ]);

  const titleMap = new Map<string, AvailabilityTitleRow>(
    [...movieTitles, ...tvTitles].map((title) => [
      `${title.mediaType}:${title.tmdbId}`,
      {
        tmdb_id: title.tmdbId,
        media_type: title.mediaType,
        title: title.title,
        original_title: title.originalTitle,
        poster_path: title.posterPath,
        backdrop_path: title.backdropPath,
        release_date: dateOnly(title.releaseDate),
        first_air_date: dateOnly(title.firstAirDate),
        popularity: title.popularity === null ? null : Number(title.popularity),
        vote_average: title.voteAverage === null ? null : Number(title.voteAverage),
      },
    ]),
  );

  const seen = new Set<string>();

  return rows
    .filter((row) => {
      const key = `${row.media_type}:${row.tmdb_id}:${row.provider_name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return titleKeys.includes(`${row.media_type}:${row.tmdb_id}`);
    })
    .map((row) => {
      const title = titleMap.get(`${row.media_type}:${row.tmdb_id}`);
      const airDate = row.last_synced_at?.slice(0, 10) ?? null;
      return {
        id: `${input.eventType}-${row.country}-${row.media_type}-${row.tmdb_id}-${row.provider_name}`,
        type: input.eventType,
        tmdbId: row.tmdb_id,
        mediaType: row.media_type,
        title: title?.title ?? `Título ${row.tmdb_id}`,
        originalTitle: title?.original_title ?? null,
        posterPath: title?.poster_path ?? null,
        backdropPath: title?.backdrop_path ?? null,
        layer: classifyAirDate(airDate),
        airDate,
        daysUntil: airDate ? daysBetweenDates(airDate) : null,
        provider: {
          name: row.provider_name,
          logo: row.provider_logo_path,
          type: row.availability_type,
        },
        visualWeight: popularityToVisualWeight(title?.popularity ?? 0, row.media_type),
        score: input.baseScore + normalizeTmdbPopularity(title?.popularity ?? 0) * 40 + (title?.vote_average ?? 0),
      } satisfies AgendaEvent;
    });
}

async function enrichPersonalEvents(
  newEpisodes: NewEpisodeItem[],
  upcomingEpisodes: UpcomingEpisodeItem[],
  userStates: UserTitleState[],
): Promise<AgendaEvent[]> {
  const stateMap = new Map(userStates.map((state) => [`tv-${state.tmdb_id}`, state]));

  const recent = await Promise.all(
    newEpisodes.map(async (item) => {
      const season =
        item.next_season != null
          ? await getCachedSeason(item.tmdb_id, item.next_season).catch(() => null)
          : null;
      const finale =
        item.next_episode != null
          ? isSeasonFinale({ episode_number: item.next_episode }, season)
          : false;
      const state = stateMap.get(`tv-${item.tmdb_id}`);
      const eventType: AgendaEventType =
        item.next_season === 1 && item.next_episode === 1
          ? "series_premiere"
          : finale
            ? "season_finale"
            : "episode_new";

      return {
        id: `${eventType}-tv-${item.tmdb_id}-${item.next_season}-${item.next_episode}`,
        type: eventType,
        tmdbId: item.tmdb_id,
        mediaType: "tv" as const,
        title: item.title,
        originalTitle: item.original_title ?? null,
        posterPath: item.poster_path,
        backdropPath: item.backdrop_path,
        layer: classifyAirDate(item.next_episode_air_date),
        airDate: item.next_episode_air_date,
        daysUntil: item.next_episode_air_date ? daysBetweenDates(item.next_episode_air_date) : null,
        seasonNumber: item.next_season ?? undefined,
        episodeNumber: item.next_episode ?? undefined,
        episodeName: item.next_episode_name,
        episodeStillPath: item.next_episode_still_path,
        runtime: item.runtime,
        isSeasonFinale: finale,
        userState: state?.computed_state,
        episodesBehind: item.episodes_behind,
        visualWeight: finale ? "hero" : "card",
        score:
          100 +
          (state?.status === "watching" ? 30 : 0) +
          (state?.computed_state === "up_to_date" ? 50 : 0) +
          (item.episodes_behind > 0 ? 20 : 0) -
          (item.days_since_new_episode ?? 0) * 0.5,
      } satisfies AgendaEvent;
    }),
  );

  const upcoming = upcomingEpisodes.map((item) => {
    const state = stateMap.get(`tv-${item.tmdb_id}`);
    const hiatus = detectHiatusReturn(null, item.next_episode_air_date);
    const type: AgendaEventType =
      item.next_season === 1 && item.next_episode === 1
        ? "series_premiere"
        : hiatus
          ? "hiatus_return"
          : "episode_new";

    return {
      id: `${type}-tv-${item.tmdb_id}-${item.next_season}-${item.next_episode}`,
      type,
      tmdbId: item.tmdb_id,
      mediaType: "tv" as const,
      title: item.title,
      originalTitle: item.original_title ?? null,
      posterPath: item.poster_path,
      backdropPath: item.backdrop_path,
      layer: classifyAirDate(item.next_episode_air_date),
      airDate: item.next_episode_air_date,
      daysUntil: item.days_until,
      seasonNumber: item.next_season,
      episodeNumber: item.next_episode,
      episodeName: item.next_episode_name,
      episodeStillPath: item.next_episode_still_path,
      userState: state?.computed_state,
      episodesBehind: Math.max(0, (state?.aired_episodes ?? 0) - (state?.watched_episodes ?? 0)),
      visualWeight: type === "hiatus_return" ? "hero" : "card",
      score: 80 + (state?.status === "watching" ? 30 : 0) - item.days_until * 0.2,
    } satisfies AgendaEvent;
  });

  return [...recent, ...upcoming].sort((a, b) => b.score - a.score);
}

export class AgendaEngine {
  async compose(
    userId: string | null,
    options: AgendaEngineOptions = {},
  ): Promise<AgendaV2CompatResponse> {
    const region = (options.region ?? "BR") as "BR" | "US";
    const now = new Date();

    const [
      legacy,
      streamingArrivals,
      digitalRadar,
      userStates,
      userLibraryIds,
      newEpisodes,
      upcomingEpisodes,
      leavingSoonItems,
    ] = await Promise.all([
      fetchLegacyAgenda(),
      fetchAvailabilityAgendaEvents({
        country: region,
        availabilityTypes: ["streaming", "subscription", "free", "ads"],
        eventType: "movie_streaming",
        baseScore: 70,
      }),
      fetchAvailabilityAgendaEvents({
        country: "US",
        availabilityTypes: ["rent", "buy"],
        eventType: "movie_digital",
        baseScore: 62,
      }),
      userId ? getUserTitleStates(userId, { limit: 250 }) : Promise.resolve([]),
      fetchUserLibraryIds(userId),
      buildNewEpisodeItems(userId),
      buildUpcomingEpisodeItems(userId),
      getLeavingSoonAvailabilityEvents(),
    ]);

    const personalEvents = await enrichPersonalEvents(
      newEpisodes,
      upcomingEpisodes,
      userStates,
    );
    const leavingEvents = leavingSoonItems.map((item) => ({
      id: `leaving-${item.media_type}-${item.id}-${item.platform_name}`,
      type: "leaving_soon" as const,
      tmdbId: item.id,
      mediaType: item.media_type,
      title: item.title,
      posterPath: null,
      backdropPath: null,
      layer: classifyAirDate(item.leaving_date),
      airDate: item.leaving_date,
      daysUntil: item.days_left,
      provider: {
        name: item.platform_name,
        logo: item.platform_logo,
        type: "flatrate",
      },
      visualWeight: item.days_left <= 7 ? "hero" : "row",
      score: 90 - item.days_left,
    })) satisfies AgendaEvent[];

    // ── Bônus regional BR nos eventos de cinema e streaming ───────────────────
    // Os eventos legados carregam original_language via LegacyAgendaTv/Movie.
    // Aplicamos o bônus antes do balanceamento editorial para que ele
    // influencie a ordenação sem distorcer o score base de outros eventos.
    const rawCinemaHighlights = legacy.nowPlaying
      .slice(0, 12)
      .map((movie) => {
        const event = eventFromLegacyMovie(movie, "movie_theatrical", 50);
        const brBonus = computeBrazilianProductionBonus({
          originalLanguage: movie.original_language,
          genreIds: movie.genre_ids,
          voteAverage: movie.vote_average,
          voteCount: movie.vote_count,
        });
        return { ...event, score: event.score + brBonus.bonus };
      });

    const rawSoonOnStreaming = [...streamingArrivals, ...digitalRadar]
      .map((event) => {
        // streamingArrivals / digitalRadar vêm de fetchAvailabilityAgendaEvents
        // sem original_language — o bônus não é aplicável aqui sem payload extra.
        // Mantemos o score como está; produções BR aparecem via bônus nos legados.
        return event;
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, 24);

    // ── Balanceamento editorial global ────────────────────────────────────────
    // Aplicamos penalidades de diversidade/repetição nos eventos editoriais
    // (cinema + streaming), preservando o score dos eventos pessoais intacto.
    const editorialCtx: EditorialContext = {
      composedInThisCycle: new Set(),
      diversity: editorialBalanceEngine.createDiversityContext(),
      now: now.getTime(),
    };

    const balancedCinema = editorialBalanceEngine
      .rankEditorial(rawCinemaHighlights, editorialCtx)
      .map((e) => {
        editorialBalanceEngine.recordExposure(e, editorialCtx, {
          isHero: e.visualWeight === "hero",
        });
        // Preserva score original no objeto AgendaEvent; editorialScore é interno.
        return { ...e, score: e.editorialScore } as AgendaEvent;
      });

    const balancedStreaming = editorialBalanceEngine
      .rankEditorial(rawSoonOnStreaming, editorialCtx)
      .map((e) => {
        editorialBalanceEngine.recordExposure(e, editorialCtx, {
          isHero: e.visualWeight === "hero",
        });
        return { ...e, score: e.editorialScore } as AgendaEvent;
      });

    const cinemaHighlights = balancedCinema;
    const soonOnStreaming = balancedStreaming;

    const byProvider = Object.fromEntries(
      [...streamingArrivals, ...digitalRadar].reduce((groups, event) => {
        const key = event.provider?.name ?? "Disponibilidade";
        const list = groups.get(key) ?? [];
        list.push(event);
        groups.set(key, list);
        return groups;
      }, new Map<string, AgendaEvent[]>()),
    );

    const personal = [...personalEvents, ...leavingEvents].sort((a, b) => b.score - a.score);
    const allEvents = [
      ...personal,
      ...cinemaHighlights,
      ...soonOnStreaming,
    ];

    return {
      personal: {
        today: personal.filter((event) => event.layer === "today" || event.layer === "tonight"),
        thisWeek: personal.filter((event) =>
          ["tomorrow", "this_week"].includes(event.layer),
        ),
        upcoming: personal.filter((event) =>
          ["next_week", "this_month", "beyond"].includes(event.layer),
        ),
        leavingSoon: leavingEvents,
        delayed: personalEvents.filter((event) => (event.episodesBehind ?? 0) > 1),
      },
      calendar: {
        byProvider,
        cinemaHighlights,
        soonOnStreaming,
      },
      timeline: buildTemporalTimeline(allEvents),
      meta: {
        generatedAt: new Date().toISOString(),
        userHasLibrary: userStates.length > 0,
        cacheStrategy: "fresh",
      },
      ...legacy,
      userLibraryIds,
      newEpisodes,
      upcomingEpisodes,
      leavingSoonItems,
    };
  }
}

export const agendaEngine = new AgendaEngine();
