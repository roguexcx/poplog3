import type { LeavingItem } from "@/app/api/poplog3/agenda/leaving-soon/route";
import type { NewEpisodeItem } from "@/app/api/poplog3/continuity/new-episodes/route";
import type { UpcomingEpisodeItem } from "@/app/api/poplog3/continuity/upcoming-episodes/route";
import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { discoverService, type DiscoverMediaItem } from "@/server/agenda/discover-service";
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
  DateRange,
  LegacyAgendaMovie,
  LegacyAgendaTv,
} from "@/server/agenda/types";
import { getCachedEpisode, getCachedSeason } from "@/server/cache/season-cache";
import { getUserTitleStates, type UserTitleState } from "@/server/state/user-title-state";
import { supabaseAdmin } from "@/server/supabase/admin";

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

const PROVIDERS = [
  { id: 8, name: "Netflix", logo: null, type: "flatrate" },
  { id: 119, name: "Prime Video", logo: null, type: "flatrate" },
  { id: 337, name: "Disney+", logo: null, type: "flatrate" },
  { id: 1899, name: "Max", logo: null, type: "flatrate" },
];

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

function normalizeMovie(movie: TmdbMovie): LegacyAgendaMovie {
  return {
    id: movie.id,
    media_type: "movie",
    title: movie.title,
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
    visualWeight: movie.popularity > 500 || movie.vote_count > 1000 ? "hero" : "card",
    score: baseScore + movie.popularity / 20 + movie.vote_average,
  };
}

function eventFromLegacyTv(
  tv: LegacyAgendaTv,
  type: AgendaEventType,
  baseScore: number,
): AgendaEvent {
  const airDate = tv.first_air_date || null;
  return {
    id: `${type}-tv-${tv.id}`,
    type,
    tmdbId: tv.id,
    mediaType: "tv",
    title: tv.title,
    posterPath: tv.poster_path,
    backdropPath: tv.backdrop_path,
    layer: classifyAirDate(airDate),
    airDate,
    daysUntil: airDate ? daysBetweenDates(airDate) : null,
    visualWeight: tv.popularity > 250 ? "hero" : "card",
    score: baseScore + tv.popularity / 15 + tv.vote_average,
  };
}

function eventFromDiscover(
  item: DiscoverMediaItem,
  mediaType: "movie" | "tv",
  type: AgendaEventType,
  baseScore: number,
  provider?: AgendaEvent["provider"],
): AgendaEvent {
  const title = mediaType === "movie" ? item.title : item.name;
  const airDate =
    mediaType === "movie" ? item.release_date ?? null : item.first_air_date ?? null;

  return {
    id: `${type}-${mediaType}-${item.id}${provider ? `-${provider.name}` : ""}`,
    type,
    tmdbId: item.id,
    mediaType,
    title: title ?? `Título ${item.id}`,
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    layer: classifyAirDate(airDate),
    airDate,
    daysUntil: airDate ? daysBetweenDates(airDate) : null,
    provider,
    visualWeight: item.popularity > 300 ? "hero" : "card",
    score: baseScore + item.popularity / 20 + item.vote_average,
  };
}

async function fetchLegacyAgenda() {
  const now = new Date();
  const today = dateAdd(0, now);
  const fortyFiveDaysAgo = dateAdd(-45, now);
  const eightDaysAhead = dateAdd(8, now);
  const ninetyDaysAhead = dateAdd(90, now);

  const [
    nowPlayingRes,
    upcomingRes,
    airingTodayRes1,
    airingTodayRes2,
    onTheAirRes1,
    onTheAirRes2,
    newSeriesRes,
    soonToReturnRes1,
    soonToReturnRes2,
  ] = await Promise.allSettled([
    tmdbFetch<TmdbPageResult<TmdbMovie>>("/movie/now_playing", {
      params: { region: "BR", page: 1 },
      revalidate: 3600 * 6,
    }),
    tmdbFetch<TmdbPageResult<TmdbMovie>>("/movie/upcoming", {
      params: { region: "BR", page: 1 },
      revalidate: 3600 * 6,
    }),
    tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/airing_today", {
      params: { page: 1 },
      revalidate: 3600 * 2,
    }),
    tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/airing_today", {
      params: { page: 2 },
      revalidate: 3600 * 2,
    }),
    tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/on_the_air", {
      params: { page: 1 },
      revalidate: 3600 * 4,
    }),
    tmdbFetch<TmdbPageResult<TmdbTv>>("/tv/on_the_air", {
      params: { page: 2 },
      revalidate: 3600 * 4,
    }),
    tmdbFetch<TmdbPageResult<TmdbTv>>("/discover/tv", {
      params: {
        "first_air_date.gte": fortyFiveDaysAgo,
        "first_air_date.lte": today,
        sort_by: "popularity.desc",
        "vote_count.gte": "3",
        without_genres: WITHOUT_TALK,
        page: 1,
      },
      revalidate: 3600 * 6,
    }),
    tmdbFetch<TmdbPageResult<TmdbTv>>("/discover/tv", {
      params: {
        "air_date.gte": eightDaysAhead,
        "air_date.lte": ninetyDaysAhead,
        sort_by: "popularity.desc",
        "vote_count.gte": "20",
        without_genres: WITHOUT_TALK,
        page: 1,
      },
      revalidate: 3600 * 6,
    }),
    tmdbFetch<TmdbPageResult<TmdbTv>>("/discover/tv", {
      params: {
        "air_date.gte": eightDaysAhead,
        "air_date.lte": ninetyDaysAhead,
        sort_by: "popularity.desc",
        "vote_count.gte": "20",
        without_genres: WITHOUT_TALK,
        page: 2,
      },
      revalidate: 3600 * 6,
    }),
  ]);

  return {
    nowPlaying:
      nowPlayingRes.status === "fulfilled"
        ? nowPlayingRes.value.results.map(normalizeMovie)
        : [],
    upcoming:
      upcomingRes.status === "fulfilled" ? upcomingRes.value.results.map(normalizeMovie) : [],
    airingToday: mergeDedup(airingTodayRes1, airingTodayRes2)
      .filter((item) => !isTalkOrNews(item))
      .map(normalizeTv),
    onTheAir: mergeDedup(onTheAirRes1, onTheAirRes2)
      .filter((item) => !isTalkOrNews(item))
      .map(normalizeTv),
    newSeries:
      newSeriesRes.status === "fulfilled"
        ? newSeriesRes.value.results.filter((item) => !isTalkOrNews(item)).map(normalizeTv)
        : [],
    soonToReturn: mergeDedup(soonToReturnRes1, soonToReturnRes2).map(normalizeTv),
  };
}

async function fetchUserLibraryIds(userId: string | null): Promise<Record<string, string>> {
  if (!userId) return {};

  const { data } = await supabaseAdmin
    .from("user_titles")
    .select("tmdb_id, media_type, status")
    .eq("user_id", userId);

  const ids: Record<string, string> = {};
  for (const row of data ?? []) {
    ids[`${row.media_type}-${row.tmdb_id}`] = row.status;
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

  const { data } = await supabaseAdmin
    .from("poplog3_titles")
    .select("tmdb_id, title, poster_path, backdrop_path, last_air_date, runtime, episode_run_time")
    .in(
      "tmdb_id",
      active.map((state) => state.tmdb_id),
    )
    .eq("media_type", "tv");

  const titleMap = new Map<number, Record<string, unknown>>(
    (data ?? []).map((title) => [(title as { tmdb_id: number }).tmdb_id, title]),
  );
  const episodeData = await Promise.all(
    active.map((state) =>
      getCachedEpisode(state.tmdb_id, state.next_season ?? 1, state.next_episode ?? 1),
    ),
  );

  return active.slice(0, 12).map((state, index) => {
    const title = titleMap.get(state.tmdb_id);
    const lastAirDate =
      typeof title?.last_air_date === "string" ? title.last_air_date : state.next_episode_air_date;
    const daysSince = lastAirDate
      ? Math.floor((Date.now() - new Date(lastAirDate).getTime()) / DAY_MS)
      : null;
    const episodeRunTime = Array.isArray(title?.episode_run_time)
      ? (title.episode_run_time[0] as number | undefined)
      : undefined;

    return {
      content_id: `tv-${state.tmdb_id}`,
      tmdb_id: state.tmdb_id,
      title: typeof title?.title === "string" ? title.title : `Série ${state.tmdb_id}`,
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
      runtime: episodeRunTime ?? (typeof title?.runtime === "number" ? title.runtime : null),
    };
  });
}

async function buildUpcomingEpisodeItems(userId: string | null): Promise<UpcomingEpisodeItem[]> {
  if (!userId) return [];

  const tomorrow = dateAdd(1);
  const cutoff = dateAdd(90);
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

  const { data } = await supabaseAdmin
    .from("poplog3_titles")
    .select("tmdb_id, title, poster_path, backdrop_path")
    .in(
      "tmdb_id",
      states.map((state) => state.tmdb_id),
    )
    .eq("media_type", "tv");

  const titleMap = new Map<number, Record<string, unknown>>(
    (data ?? []).map((title) => [(title as { tmdb_id: number }).tmdb_id, title]),
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

async function fetchLeavingSoon(): Promise<LeavingItem[]> {
  const apiKey = process.env.MOVIEOFTHENIGHT_API_KEY;
  if (!apiKey) return [];

  try {
    const url = new URL("https://api.movieofthenight.com/v4/changes");
    url.searchParams.set("country", "br");
    url.searchParams.set("change_type", "expiring");
    for (const catalog of ["netflix", "prime", "disney", "paramount", "apple", "hbo"]) {
      url.searchParams.append("catalogs", catalog);
    }

    const response = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
      next: { revalidate: 86_400 },
    });
    if (!response.ok) return [];

    const data = (await response.json()) as {
      changes?: Array<{
        showId?: string;
        service?: {
          id?: string;
          name?: string;
          imageSet?: { lightThemeImage?: string };
        };
        expiresOn?: number;
      }>;
      shows?: Record<
        string,
        {
          title?: string;
          showType?: string;
          tmdbId?: string;
          imageSet?: {
            verticalPoster?: { w240?: string; w360?: string };
            horizontalBackdrop?: { w720?: string };
          };
        }
      >;
    };

    const items: LeavingItem[] = [];
    const seen = new Set<string>();
    for (const change of data.changes ?? []) {
      if (!change.showId || !change.expiresOn) continue;
      const show = data.shows?.[change.showId];
      const tmdbId = show?.tmdbId ? Number(show.tmdbId) : null;
      if (!show || !tmdbId) continue;
      const daysLeft = Math.ceil((change.expiresOn * 1000 - Date.now()) / DAY_MS);
      if (daysLeft < 0 || daysLeft > 30) continue;
      const key = `${change.showId}-${change.service?.id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: tmdbId,
        media_type: show.showType === "movie" ? "movie" : "tv",
        title: show.title ?? `Título ${tmdbId}`,
        poster_url: show.imageSet?.verticalPoster?.w360 ?? show.imageSet?.verticalPoster?.w240 ?? null,
        backdrop_url: show.imageSet?.horizontalBackdrop?.w720 ?? null,
        platform_name: change.service?.name ?? change.service?.id ?? "Streaming",
        platform_logo: change.service?.imageSet?.lightThemeImage ?? null,
        leaving_date: new Date(change.expiresOn * 1000).toISOString().slice(0, 10),
        days_left: daysLeft,
      });
    }
    return items.sort((a, b) => a.days_left - b.days_left).slice(0, 20);
  } catch {
    return [];
  }
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
    const region = options.region ?? "BR";
    const now = new Date();
    const weekRange: DateRange = { start: dateAdd(0, now), end: dateAdd(7, now) };

    const providerTasks = PROVIDERS.map(async (provider) => {
      const items = await discoverService
        .discoverByProvider([provider.id], region, weekRange, "tv")
        .catch(() => []);
      return {
        provider,
        events: items
          .slice(0, 12)
          .map((item) => eventFromDiscover(item, "tv", "episode_new", 45, provider)),
      };
    });

    const [
      legacy,
      providerResults,
      userStates,
      userLibraryIds,
      newEpisodes,
      upcomingEpisodes,
      leavingSoonItems,
    ] = await Promise.all([
      fetchLegacyAgenda(),
      Promise.all(providerTasks),
      userId ? getUserTitleStates(userId, { limit: 250 }) : Promise.resolve([]),
      fetchUserLibraryIds(userId),
      buildNewEpisodeItems(userId),
      buildUpcomingEpisodeItems(userId),
      fetchLeavingSoon(),
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

    const cinemaHighlights = legacy.nowPlaying
      .slice(0, 12)
      .map((movie) => eventFromLegacyMovie(movie, "movie_theatrical", 50));
    const soonOnStreaming = legacy.upcoming
      .slice(0, 12)
      .map((movie) => eventFromLegacyMovie(movie, "movie_streaming", 35));

    const byProvider = Object.fromEntries(
      providerResults.map(({ provider, events }) => [provider.name, events]),
    );

    const personal = [...personalEvents, ...leavingEvents].sort((a, b) => b.score - a.score);
    const allEvents = [
      ...personal,
      ...cinemaHighlights,
      ...soonOnStreaming,
      ...providerResults.flatMap((result) => result.events),
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
