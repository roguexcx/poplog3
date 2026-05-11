import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { tmdbFetch } from "@/lib/tmdb";

type MediaType = "movie" | "tv";
type AgendaEventType = "episode" | "season" | "movie_release" | "cinema_release" | "related";
type AgendaPriority = "high" | "medium" | "silent";
type CacheKind = "detail" | "season" | "upcoming" | "recommendations";

type UserTitleRow = {
  id: number;
  tmdb_id: number;
  media_type: MediaType;
  status: string | null;
  favorite: boolean;
  fridge?: boolean | null;
  created_at: string;
  watched_at?: string | null;
  release_year?: number | null;
  title?: string | null;
};

type EpisodeProgressRow = {
  tmdb_id: number;
  season: number;
  episode: number;
  watched_at: string | null;
};

type TmdbGenre = { id: number; name: string };

type MovieDetail = {
  id: number;
  title?: string;
  original_title?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  runtime?: number | null;
  popularity?: number;
  vote_average?: number;
  genres?: TmdbGenre[];
};

type TvSeasonSummary = {
  id: number;
  name: string;
  season_number: number;
  episode_count: number;
  air_date?: string | null;
  poster_path?: string | null;
};

type TvDetail = {
  id: number;
  name?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  first_air_date?: string | null;
  episode_run_time?: number[];
  number_of_episodes?: number;
  popularity?: number;
  vote_average?: number;
  genres?: TmdbGenre[];
  seasons?: TvSeasonSummary[];
  next_episode_to_air?: {
    air_date?: string | null;
    episode_number: number;
    season_number: number;
    name?: string | null;
    still_path?: string | null;
  } | null;
};

type SeasonEpisode = {
  id: number;
  episode_number: number;
  name?: string | null;
  air_date?: string | null;
  runtime?: number | null;
  still_path?: string | null;
};

type SeasonDetail = {
  season_number: number;
  episodes?: SeasonEpisode[];
};

type AgendaTitle = {
  id: number;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  originalTitle: string | null;
  status: string | null;
  favorite: boolean;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  runtime: number | null;
  popularity: number;
  voteAverage: number;
  progressPercent: number | null;
  remainingEpisodes: number | null;
  remainingMinutes: number | null;
};

type AgendaEvent = {
  id: string;
  type: AgendaEventType;
  priority: AgendaPriority;
  date: string;
  timeLabel: string | null;
  title: string;
  subtitle: string;
  status: string;
  countdown: string;
  badge: string;
  description: string;
  titleRef: AgendaTitle;
  season?: number;
  episode?: number;
  progressLabel?: string | null;
};

type DebugInfo = {
  processedTitles: Array<{ tmdbId: number; mediaType: MediaType; reason: string; rank: number }>;
  skippedTitles: Array<{ tmdbId: number; mediaType: MediaType; reason: string; rank: number }>;
  tmdbCallsUsed: number;
  cacheHits: number;
  cacheMisses: number;
  cacheUnavailable: boolean;
  skippedBecauseBudget: number;
  skippedBecauseNoRealDate: Array<{ tmdbId: number; mediaType: MediaType; reason: string }>;
};

type Budget = {
  total: number;
  detailsSeries: number;
  detailsMovies: number;
  seasons: number;
  used: number;
  usedDetailsSeries: number;
  usedDetailsMovies: number;
  usedSeasons: number;
};

const DAY = 86_400_000;
const TIMEZONE = "America/Sao_Paulo";
const DETAIL_TTL_HOURS = 24;
const SEASON_TTL_HOURS = 6;
const UPCOMING_TTL_HOURS = 12;
const RECOMMENDATIONS_TTL_HOURS = 48;
const MAX_SERIES_PER_RUN = 16;
const MAX_MOVIES_PER_RUN = 24;

function nowInTimezone(timezone = TIMEZONE): Date {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = Number(parts.find((part) => part.type === "year")?.value);
  const month = Number(parts.find((part) => part.type === "month")?.value);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function parseAgendaDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value: string, timezone = TIMEZONE): number {
  const date = parseAgendaDate(value);
  if (!date) return 9999;
  return Math.round((date.getTime() - nowInTimezone(timezone).getTime()) / DAY);
}

function formatAgendaDate(value: string, timezone = TIMEZONE): string {
  const diff = daysUntil(value, timezone);
  const date = parseAgendaDate(value);
  if (!date) return "Data indefinida";
  if (diff === 0) return "Hoje";
  if (diff === 1) return "AmanhÃ£";
  if (diff > 1 && diff <= 6) return `Em ${diff} dias`;
  if (diff >= 7 && diff <= 13) return "Semana que vem";
  if (diff > 13 && diff <= 45) return `Em ${diff} dias`;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "short",
    year: diff > 180 ? "numeric" : undefined,
  }).format(date);
}

function cacheTtl(kind: CacheKind): number {
  if (kind === "season") return SEASON_TTL_HOURS;
  if (kind === "upcoming") return UPCOMING_TTL_HOURS;
  if (kind === "recommendations") return RECOMMENDATIONS_TTL_HOURS;
  return DETAIL_TTL_HOURS;
}

function cacheKey(kind: CacheKind, mediaType: MediaType | "movie", tmdbId: number | string, suffix = "detail") {
  return `${kind}:${mediaType}:${tmdbId}:${suffix}`;
}

function titleName(detail: MovieDetail | TvDetail, mediaType: MediaType): string {
  if (mediaType === "movie") return (detail as MovieDetail).title ?? (detail as MovieDetail).original_title ?? "Sem tÃ­tulo";
  return (detail as TvDetail).name ?? (detail as TvDetail).original_name ?? "Sem tÃ­tulo";
}

function averageRuntime(detail: TvDetail): number {
  const runtimes = detail.episode_run_time?.filter((runtime) => runtime > 0) ?? [];
  return runtimes.length ? Math.round(runtimes.reduce((sum, runtime) => sum + runtime, 0) / runtimes.length) : 45;
}

function eventId(parts: Array<string | number | null | undefined>) {
  return parts.filter((part) => part !== null && part !== undefined).join("-");
}

function isFutureOrToday(value: string): boolean {
  return daysUntil(value) >= 0;
}

function isWithinFuture(value: string, days: number): boolean {
  const diff = daysUntil(value);
  return diff >= 0 && diff <= days;
}

function rankAgendaTitles(rows: UserTitleRow[], progressRows: EpisodeProgressRow[]): Array<UserTitleRow & { agendaRank: number; rankReason: string }> {
  const progressByTitle = new Map<number, number>();
  progressRows.forEach((progress) => progressByTitle.set(progress.tmdb_id, (progressByTitle.get(progress.tmdb_id) ?? 0) + 1));
  const now = Date.now();

  return rows
    .filter((row) => row.tmdb_id && (row.media_type === "tv" || row.media_type === "movie"))
    .map((row) => {
      const progressCount = progressByTitle.get(row.tmdb_id) ?? 0;
      const savedDays = Math.max(0, Math.floor((now - new Date(row.created_at).getTime()) / DAY));
      let score = 0;
      const reasons: string[] = [];

      if (row.media_type === "tv" && row.status === "watching") { score += 120; reasons.push("serie_watching"); }
      if (row.media_type === "tv" && progressCount > 0) { score += 90; reasons.push("episode_progress"); }
      if (row.media_type === "tv" && row.favorite) { score += 70; reasons.push("favorite_series"); }
      if (row.media_type === "tv" && row.status !== "watched") { score += 45; reasons.push("series_not_finished"); }
      if (row.media_type === "movie" && row.status === "watchlist") { score += 80; reasons.push("movie_watchlist"); }
      if (row.media_type === "movie" && row.favorite) { score += 55; reasons.push("favorite_movie"); }
      if (savedDays <= 30) { score += 35; reasons.push("recently_saved"); }
      if (row.fridge) { score -= 25; reasons.push("fridge_lower"); }
      if (row.media_type === "movie" && row.status === "watched" && !row.favorite) { score -= 70; reasons.push("old_watched_movie_lower"); }
      if (row.media_type === "tv" && row.status === "watched") { score -= 45; reasons.push("completed_series_lower"); }

      return { ...row, agendaRank: score, rankReason: reasons.join(",") || "saved_title" };
    })
    .sort((a, b) => b.agendaRank - a.agendaRank);
}

function createBudget(): Budget {
  return {
    total: 38,
    detailsSeries: MAX_SERIES_PER_RUN,
    detailsMovies: MAX_MOVIES_PER_RUN,
    seasons: 12,
    used: 0,
    usedDetailsSeries: 0,
    usedDetailsMovies: 0,
    usedSeasons: 0,
  };
}

function canUseBudget(budget: Budget, bucket: keyof Pick<Budget, "usedDetailsSeries" | "usedDetailsMovies" | "usedSeasons">): boolean {
  if (budget.used >= budget.total) return false;
  if (bucket === "usedDetailsSeries") return budget.usedDetailsSeries < budget.detailsSeries;
  if (bucket === "usedDetailsMovies") return budget.usedDetailsMovies < budget.detailsMovies;
  return budget.usedSeasons < budget.seasons;
}

function spendBudget(budget: Budget, bucket: keyof Pick<Budget, "usedDetailsSeries" | "usedDetailsMovies" | "usedSeasons">) {
  budget.used += 1;
  budget[bucket] += 1;
}

async function cachedTmdbFetch<T>(
  supabase: SupabaseClient,
  debug: DebugInfo,
  budget: Budget,
  bucket: keyof Pick<Budget, "usedDetailsSeries" | "usedDetailsMovies" | "usedSeasons">,
  key: string,
  kind: CacheKind,
  tmdbId: number | string,
  mediaType: MediaType,
  endpoint: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<{ payload: T | null; fromCache: boolean; skippedByBudget: boolean; stale: boolean }> {
  try {
    const { data } = await supabase
      .from("agenda_tmdb_cache")
      .select("payload, expires_at")
      .eq("cache_key", key)
      .maybeSingle();

    if (data?.payload && data.expires_at && new Date(data.expires_at).getTime() > Date.now()) {
      debug.cacheHits += 1;
      return { payload: data.payload as T, fromCache: true, skippedByBudget: false, stale: false };
    }

    if (data?.payload && !canUseBudget(budget, bucket)) {
      debug.cacheHits += 1;
      debug.skippedBecauseBudget += 1;
      return { payload: data.payload as T, fromCache: true, skippedByBudget: true, stale: true };
    }
  } catch {
    debug.cacheUnavailable = true;
  }

  if (!canUseBudget(budget, bucket)) {
    debug.skippedBecauseBudget += 1;
    return { payload: null, fromCache: false, skippedByBudget: true, stale: false };
  }

  debug.cacheMisses += 1;
  spendBudget(budget, bucket);
  debug.tmdbCallsUsed += 1;

  const payload = await tmdbFetch<T>(endpoint, params, 0);
  try {
    const expires = new Date(Date.now() + cacheTtl(kind) * 60 * 60 * 1000).toISOString();
    await supabase.from("agenda_tmdb_cache").upsert({
      cache_key: key,
      tmdb_id: Number(tmdbId) || null,
      media_type: mediaType,
      payload,
      expires_at: expires,
      updated_at: new Date().toISOString(),
    }, { onConflict: "cache_key" });
  } catch {
    debug.cacheUnavailable = true;
  }

  return { payload, fromCache: false, skippedByBudget: false, stale: false };
}

function buildAgendaTitle(row: UserTitleRow, detail: MovieDetail | TvDetail, progressRows: EpisodeProgressRow[]): AgendaTitle {
  const mediaType = row.media_type;
  const watchedEpisodes = progressRows.filter((progress) => Number(progress.tmdb_id) === Number(row.tmdb_id)).length;
  const totalEpisodes = mediaType === "tv" ? ((detail as TvDetail).number_of_episodes ?? 0) : null;
  const runtime = mediaType === "movie" ? ((detail as MovieDetail).runtime ?? null) : averageRuntime(detail as TvDetail);
  const remainingEpisodes = mediaType === "tv" && totalEpisodes ? Math.max(0, totalEpisodes - watchedEpisodes) : null;
  const progressPercent = mediaType === "tv" && totalEpisodes
    ? Math.round((watchedEpisodes / totalEpisodes) * 100)
    : row.status === "watched" ? 100 : null;

  return {
    id: row.id,
    tmdbId: row.tmdb_id,
    mediaType,
    title: titleName(detail, mediaType),
    originalTitle: mediaType === "movie" ? ((detail as MovieDetail).original_title ?? null) : ((detail as TvDetail).original_name ?? null),
    status: row.status,
    favorite: row.favorite,
    posterPath: detail.poster_path ?? null,
    backdropPath: detail.backdrop_path ?? null,
    genres: (detail.genres ?? []).map((genre) => genre.name).slice(0, 4),
    runtime,
    popularity: detail.popularity ?? 0,
    voteAverage: detail.vote_average ?? 0,
    progressPercent,
    remainingEpisodes,
    remainingMinutes: remainingEpisodes !== null && runtime ? remainingEpisodes * runtime : null,
  };
}

function priorityFor(title: AgendaTitle, type: AgendaEventType, date: string): AgendaPriority {
  const diff = daysUntil(date);
  if (type === "episode" && title.status === "watching" && diff <= 7) return "high";
  if (type === "movie_release" && (title.status === "watchlist" || title.favorite) && diff <= 30) return "high";
  if (type === "season" && diff <= 30) return "high";
  if (title.favorite || title.status === "watching") return "medium";
  return "silent";
}

function priorityScore(event: AgendaEvent): number {
  const base = event.priority === "high" ? 1000 : event.priority === "medium" ? 500 : 100;
  const soon = Math.max(0, 120 - Math.max(0, daysUntil(event.date)));
  const type = event.type === "episode" ? 300 : event.type === "movie_release" ? 240 : event.type === "season" ? 220 : event.type === "cinema_release" ? 180 : 40;
  return base + type + soon + (event.titleRef.favorite ? 80 : 0) + (event.titleRef.progressPercent ?? 0);
}

function createEvent(input: Omit<AgendaEvent, "priority" | "countdown"> & { priority?: AgendaPriority }): AgendaEvent {
  return {
    ...input,
    priority: input.priority ?? priorityFor(input.titleRef, input.type, input.date),
    countdown: formatAgendaDate(input.date),
  };
}

function futureEpisodesFromSeason(title: AgendaTitle, season: SeasonDetail, summary: TvSeasonSummary | undefined, watched: Set<string>): AgendaEvent[] {
  const events: AgendaEvent[] = [];
  for (const episode of season.episodes ?? []) {
    if (!episode.air_date || !isFutureOrToday(episode.air_date)) continue;
    const watchedKey = `${season.season_number}-${episode.episode_number}`;
    if (watched.has(watchedKey)) continue;
    const isFinale = episode.episode_number === (summary?.episode_count ?? -1);
    events.push(createEvent({
      id: eventId(["episode", title.tmdbId, season.season_number, episode.episode_number, episode.air_date]),
      type: "episode",
      date: episode.air_date,
      timeLabel: null,
      title: title.title,
      subtitle: `T${season.season_number}E${episode.episode_number}${episode.name ? ` Â· ${episode.name}` : ""}`,
      status: isFinale ? "Final de temporada" : "Novo episÃ³dio",
      badge: isFinale ? "Season finale" : "EpisÃ³dio",
      description: `EpisÃ³dio com air_date real confirmado pelo TMDB.`,
      titleRef: title,
      season: season.season_number,
      episode: episode.episode_number,
      progressLabel: title.remainingEpisodes ? `Faltam ${title.remainingEpisodes} ep${title.remainingEpisodes === 1 ? "" : "s"}` : null,
    }));
  }
  return events;
}

async function buildTvEvents(
  supabase: SupabaseClient,
  debug: DebugInfo,
  budget: Budget,
  row: UserTitleRow,
  detail: TvDetail,
  progressRows: EpisodeProgressRow[],
): Promise<AgendaEvent[]> {
  const title = buildAgendaTitle(row, detail, progressRows);
  const watched = new Set(
    progressRows
      .filter((progress) => Number(progress.tmdb_id) === Number(row.tmdb_id))
      .map((progress) => `${progress.season}-${progress.episode}`),
  );
  const events: AgendaEvent[] = [];
  const seasonsWithFutureDate = (detail.seasons ?? [])
    .filter((season) => season.season_number > 0 && season.air_date && daysUntil(season.air_date) >= -3 && daysUntil(season.air_date) <= 180)
    .sort((a, b) => daysUntil(a.air_date!) - daysUntil(b.air_date!))
    .slice(0, 3);

  if (detail.next_episode_to_air?.air_date && isFutureOrToday(detail.next_episode_to_air.air_date)) {
    const next = detail.next_episode_to_air;
    const nextAirDate = next.air_date;
    if (!nextAirDate) return events;
    events.push(createEvent({
      id: eventId(["next-episode", row.tmdb_id, next.season_number, next.episode_number, nextAirDate]),
      type: "episode",
      date: nextAirDate,
      timeLabel: null,
      title: title.title,
      subtitle: `T${next.season_number}E${next.episode_number}${next.name ? ` Â· ${next.name}` : ""}`,
      status: "PrÃ³ximo episÃ³dio",
      badge: "EpisÃ³dio",
      description: "PrÃ³ximo episÃ³dio confirmado pelo TMDB.",
      titleRef: title,
      season: next.season_number,
      episode: next.episode_number,
      progressLabel: title.remainingEpisodes ? `Faltam ${title.remainingEpisodes} ep${title.remainingEpisodes === 1 ? "" : "s"}` : null,
    }));
  }

  for (const season of seasonsWithFutureDate) {
    const result = await cachedTmdbFetch<SeasonDetail>(
      supabase,
      debug,
      budget,
      "usedSeasons",
      cacheKey("season", "tv", row.tmdb_id, `s${season.season_number}`),
      "season",
      row.tmdb_id,
      "tv",
      `/tv/${row.tmdb_id}/season/${season.season_number}`,
    );

    if (!result.payload) continue;
    const episodeEvents = futureEpisodesFromSeason(title, result.payload, season, watched);
    events.push(...episodeEvents);

    if (episodeEvents.length > 0) {
      const firstEpisode = episodeEvents[0];
      events.push(createEvent({
        id: eventId(["season", row.tmdb_id, season.season_number, firstEpisode.date]),
        type: "season",
        date: firstEpisode.date,
        timeLabel: null,
        title: title.title,
        subtitle: `Temporada ${season.season_number}`,
        status: "Nova temporada com data confirmada",
        badge: "Temporada",
        description: "Temporada entrou na Agenda porque hÃ¡ episÃ³dios futuros com air_date real.",
        titleRef: title,
        season: season.season_number,
      }));
    }
  }

  if (events.length === 0) {
    debug.skippedBecauseNoRealDate.push({ tmdbId: row.tmdb_id, mediaType: "tv", reason: "TMDB nÃ£o retornou episÃ³dio futuro com air_date real" });
  }

  return events;
}

function buildMovieEvents(row: UserTitleRow, detail: MovieDetail): AgendaEvent[] {
  const title = buildAgendaTitle(row, detail, []);
  const events: AgendaEvent[] = [];
  const release = detail.release_date ?? null;

  if (release && isFutureOrToday(release)) {
    events.push(createEvent({
      id: eventId(["movie-release", row.tmdb_id, release]),
      type: "movie_release",
      date: release,
      timeLabel: null,
      title: title.title,
      subtitle: row.status === "watchlist" ? "Filme da sua Watchlist" : "Filme salvo na sua biblioteca",
      status: "Filme estreando",
      badge: "Estreia",
      description: "Release_date futuro confirmado pelo TMDB.",
      titleRef: title,
    }));
  }

  return events;
}

function byDate(events: AgendaEvent[]): Record<string, AgendaEvent[]> {
  return events.reduce<Record<string, AgendaEvent[]>>((acc, event) => {
    acc[event.date] = [...(acc[event.date] ?? []), event];
    return acc;
  }, {});
}

function byMonth(events: AgendaEvent[]): Record<string, AgendaEvent[]> {
  return events.reduce<Record<string, AgendaEvent[]>>((acc, event) => {
    const key = event.date.slice(0, 7);
    acc[key] = [...(acc[key] ?? []), event];
    return acc;
  }, {});
}

export async function GET() {
  const debug: DebugInfo = {
    processedTitles: [],
    skippedTitles: [],
    tmdbCallsUsed: 0,
    cacheHits: 0,
    cacheMisses: 0,
    cacheUnavailable: false,
    skippedBecauseBudget: 0,
    skippedBecauseNoRealDate: [],
  };
  const budget = createBudget();

  try {
    const supabase = await createSupabaseServerClient();
    const { data: auth } = await supabase.auth.getUser();
    const user = auth.user;
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const { data: rows, error } = await supabase
      .from("user_titles")
      .select("id, tmdb_id, media_type, status, favorite, fridge, created_at, watched_at, release_year, title")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (error) throw error;

    const { data: progressData } = await supabase
      .from("episode_progress")
      .select("tmdb_id, season, episode, watched_at")
      .eq("user_id", user.id);

    const titles = (rows ?? []) as UserTitleRow[];
    const progressRows = (progressData ?? []) as EpisodeProgressRow[];
    const ranked = rankAgendaTitles(titles, progressRows);
    const seriesQueue = ranked.filter((row) => row.media_type === "tv").slice(0, MAX_SERIES_PER_RUN);
    const movieQueue = ranked.filter((row) => row.media_type === "movie").slice(0, MAX_MOVIES_PER_RUN);
    const skipped = ranked.slice(MAX_SERIES_PER_RUN + MAX_MOVIES_PER_RUN);
    skipped.forEach((row) => debug.skippedTitles.push({ tmdbId: row.tmdb_id, mediaType: row.media_type, reason: "below_budget_cut", rank: row.agendaRank }));

    const events: AgendaEvent[] = [];

    for (const row of seriesQueue) {
      const result = await cachedTmdbFetch<TvDetail>(
        supabase,
        debug,
        budget,
        "usedDetailsSeries",
        cacheKey("detail", "tv", row.tmdb_id, "detail"),
        "detail",
        row.tmdb_id,
        "tv",
        `/tv/${row.tmdb_id}`,
        { append_to_response: "genres,seasons" },
      );
      if (!result.payload) {
        debug.skippedTitles.push({ tmdbId: row.tmdb_id, mediaType: row.media_type, reason: result.skippedByBudget ? "budget" : "missing_detail", rank: row.agendaRank });
        continue;
      }
      debug.processedTitles.push({ tmdbId: row.tmdb_id, mediaType: row.media_type, reason: row.rankReason, rank: row.agendaRank });
      events.push(...await buildTvEvents(supabase, debug, budget, row, result.payload, progressRows));
    }

    for (const row of movieQueue) {
      const result = await cachedTmdbFetch<MovieDetail>(
        supabase,
        debug,
        budget,
        "usedDetailsMovies",
        cacheKey("detail", "movie", row.tmdb_id, "detail"),
        "detail",
        row.tmdb_id,
        "movie",
        `/movie/${row.tmdb_id}`,
        { append_to_response: "genres" },
      );
      if (!result.payload) {
        debug.skippedTitles.push({ tmdbId: row.tmdb_id, mediaType: row.media_type, reason: result.skippedByBudget ? "budget" : "missing_detail", rank: row.agendaRank });
        continue;
      }
      debug.processedTitles.push({ tmdbId: row.tmdb_id, mediaType: row.media_type, reason: row.rankReason, rank: row.agendaRank });
      const movieEvents = buildMovieEvents(row, result.payload);
      if (movieEvents.length === 0) {
        debug.skippedBecauseNoRealDate.push({ tmdbId: row.tmdb_id, mediaType: "movie", reason: "filme sem release_date futura real" });
      }
      events.push(...movieEvents);
    }

    const relatedFutureMovies: AgendaEvent[] = [];
    const realDatedEvents = events
      .filter((event) => Boolean(event.date && parseAgendaDate(event.date)))
      .filter((event, index, list) => list.findIndex((candidate) => candidate.id === event.id) === index)
      .sort((a, b) => daysUntil(a.date) - daysUntil(b.date) || priorityScore(b) - priorityScore(a));

    const episodeEvents = realDatedEvents.filter((event) => event.type === "episode");
    const movieReleaseEvents = realDatedEvents.filter((event) => event.type === "movie_release" || event.type === "cinema_release");
    const savedFutureMovies = movieReleaseEvents.filter((event) => event.type === "movie_release");
    const watchlistFutureMovies = savedFutureMovies.filter((event) => event.titleRef.status === "watchlist");
    const cinemaSoon = movieReleaseEvents.filter((event) => isWithinFuture(event.date, 45));
    const thisWeekEpisodes = episodeEvents.filter((event) => isWithinFuture(event.date, 7));
    const thisMonthEpisodes = episodeEvents.filter((event) => isWithinFuture(event.date, 31));
    const trackedSeriesWithoutDates = debug.skippedBecauseNoRealDate.filter((item) => item.mediaType === "tv");
    const partial = debug.skippedBecauseBudget > 0 || debug.cacheUnavailable;
    const hero = realDatedEvents
      .filter((event) => event.type !== "related" || isWithinFuture(event.date, 45))
      .sort((a, b) => priorityScore(b) - priorityScore(a))
      .slice(0, 8);

    const response = {
      generatedAt: new Date().toISOString(),
      partial,
      refreshRecommended: partial,
      cacheStatus: {
        hits: debug.cacheHits,
        misses: debug.cacheMisses,
        unavailable: debug.cacheUnavailable,
      },
      requestBudget: {
        limit: budget.total,
        used: budget.used,
        detailsSeries: `${budget.usedDetailsSeries}/${budget.detailsSeries}`,
        detailsMovies: `${budget.usedDetailsMovies}/${budget.detailsMovies}`,
        seasons: `${budget.usedSeasons}/${budget.seasons}`,
        related: "0/0",
      },
      hero,
      events: realDatedEvents.slice(0, 120),
      episodeCalendar: {
        byDate: byDate(episodeEvents),
        upcomingEpisodes: episodeEvents.slice(0, 32),
        thisWeek: thisWeekEpisodes,
        thisMonth: thisMonthEpisodes,
        trackedSeriesWithoutDates,
      },
      upcomingMovies: {
        savedFutureMovies,
        watchlistFutureMovies,
        cinemaSoon,
        relatedFutureMovies,
        byMonth: byMonth([...savedFutureMovies, ...relatedFutureMovies]),
      },
      timeline: realDatedEvents.filter((event) => daysUntil(event.date) >= 0).slice(0, 40),
      alerts: realDatedEvents
        .filter((event) => event.priority !== "silent")
        .sort((a, b) => priorityScore(b) - priorityScore(a))
        .slice(0, 12),
      ecosystem: {
        continueWatching: [],
        nextEpisodes: episodeEvents.slice(0, 8),
        movieReleases: savedFutureMovies.slice(0, 8),
        related: relatedFutureMovies.slice(0, 8),
      },
      summary: {
        upcomingEpisodesThisWeek: thisWeekEpisodes.length,
        upcomingEpisodesThisMonth: thisMonthEpisodes.length,
        futureMoviesSaved: savedFutureMovies.length,
        futureMoviesWatchlist: watchlistFutureMovies.length,
        cinemaReleasesSoon: cinemaSoon.length,
        lastUpdatedAt: new Date().toISOString(),
        partial,
        // Backward-compatible aliases used by the current UI.
        episodesThisWeek: thisWeekEpisodes.length,
        seriesUpToDate: 0,
        waitingSeasons: realDatedEvents.filter((event) => event.type === "season").length,
        pendingMinutes: 0,
        importantPremieres: realDatedEvents.filter((event) => event.priority === "high" && isWithinFuture(event.date, 7)).length,
        intensity: thisWeekEpisodes.length >= 8 ? "intensa" : thisWeekEpisodes.length >= 4 ? "movimentada" : "leve",
      },
      ...(process.env.NODE_ENV === "development" ? { debug } : {}),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[agenda]", error);
    return NextResponse.json({ error: "agenda_failed" }, { status: 500 });
  }
}

