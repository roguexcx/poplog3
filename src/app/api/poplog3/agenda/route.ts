import { NextRequest, NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";
import { applyLegacyBrazilianBonus } from "@/server/agenda/editorial-regional-bonus";
import { normalizeTmdbPopularity } from "@/lib/score/tmdb-popularity";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";
import { normalizeProvider } from "@/server/streaming/provider-normalization";
import { hydrateManyTitleAvailability } from "@/server/availability";
import { resolveDisplayTitle } from "@/lib/titles/display-title";
import {
  getLocalUserLibraryIds,
  getLocalAgendaStateBatch,
} from "@/server/local-services/continuity-local.service";
import {
  catalogGetTrending,
  isBalloonerismTrendingEnabled,
} from "@/server/source-engine/engine";
import type { CatalogSearchResult } from "@/server/source-engine/types/catalog.types";

// ── Canonical agenda shapes ───────────────────────────────────────────────────

export type AgendaMovie = {
  id: number;
  media_type: "movie";
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
  user_status?: string | null;
  user_computed_state?: string | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  is_preferred_provider?: boolean;
  availability_scope?: "preferred" | "streaming" | "digital" | "none";
  /** Score editorial: popularidade normalizada + bônus BR (quando aplicável). */
  editorial_score?: number;
  /** Bônus BR concedido — 0 se não for produção brasileira elegível. */
  br_bonus?: number;
};

export type AgendaTv = {
  id: number;
  media_type: "tv";
  title: string;
  original_language?: string;
  poster_path: string | null;
  backdrop_path: string | null;
  first_air_date: string;
  vote_average: number;
  vote_count: number;
  popularity: number;
  overview: string;
  genre_ids: number[];
  user_status?: string | null;
  user_computed_state?: string | null;
  best_provider_name?: string | null;
  best_provider_type?: string | null;
  best_provider_logo?: string | null;
  is_preferred_provider?: boolean;
  availability_scope?: "preferred" | "streaming" | "digital" | "none";
  /** Score editorial: popularidade normalizada + bônus BR (quando aplicável). */
  editorial_score?: number;
  /** Bônus BR concedido — 0 se não for produção brasileira elegível. */
  br_bonus?: number;
};

export type AgendaResponse = {
  nowPlaying: AgendaMovie[];
  upcoming: AgendaMovie[];
  airingToday: AgendaTv[];      // hoje (p1+p2 mergeados)
  onTheAir: AgendaTv[];         // próximos 7 dias (p1+p2 mergeados)
  newSeries: AgendaTv[];        // estreias: first_air_date nos últimos 45 dias
  soonToReturn: AgendaTv[];     // retornos: air_date nos próximos 8–30 dias
  trendingMovies: AgendaMovie[];
  trendingTv: AgendaTv[];
  userLibraryIds: Record<string, string>; // "movie-123" => status
};

// ── Filters ───────────────────────────────────────────────────────────────────

// Gêneros a excluir de séries: Talk Show (10767) e Notícias (10763)
const EXCLUDED_TV_GENRES = new Set([10767, 10763]);
const STREAMING_TYPES = new Set(["streaming", "subscription", "flatrate", "free", "ads"]);

function isTalkOrNews(item: { genre_ids: number[] }): boolean {
  return item.genre_ids.some((g) => EXCLUDED_TV_GENRES.has(g));
}

// ── Genre extraction from DB JSON ─────────────────────────────────────────────

function extractGenreIds(genres: unknown): number[] {
  if (!Array.isArray(genres)) return [];
  return genres.flatMap((g) => {
    if (typeof g === "number") return [g];
    if (g && typeof g === "object" && typeof (g as { id?: unknown }).id === "number") {
      return [(g as { id: number }).id];
    }
    return [];
  });
}

// ── DB row → agenda item converters ──────────────────────────────────────────

type TitleRow = Awaited<ReturnType<typeof db.poplog3Title.findMany>>[number];

function rowToMovie(row: TitleRow): AgendaMovie {
  return {
    id: row.tmdbId,
    media_type: "movie",
    title: resolveDisplayTitle({
      title: row.title,
      originalTitle: row.originalTitle,
      tmdbId: row.tmdbId,
      imdbId: row.imdbId,
      mediaType: "movie",
    }),
    poster_path: row.posterPath,
    backdrop_path: row.backdropPath,
    release_date: row.releaseDate ? row.releaseDate.toISOString().slice(0, 10) : "",
    vote_average: row.voteAverage !== null ? Number(row.voteAverage) : 0,
    vote_count: row.voteCount ?? 0,
    popularity: row.popularity !== null ? Number(row.popularity) : 0,
    overview: row.overview ?? "",
    genre_ids: extractGenreIds(row.genres),
  };
}

function rowToTv(row: TitleRow): AgendaTv {
  return {
    id: row.tmdbId,
    media_type: "tv",
    title: resolveDisplayTitle({
      title: row.title,
      originalTitle: row.originalTitle,
      tmdbId: row.tmdbId,
      imdbId: row.imdbId,
      mediaType: "tv",
    }),
    original_language: row.originalLanguage ?? undefined,
    poster_path: row.posterPath,
    backdrop_path: row.backdropPath,
    first_air_date: row.firstAirDate ? row.firstAirDate.toISOString().slice(0, 10) : "",
    vote_average: row.voteAverage !== null ? Number(row.voteAverage) : 0,
    vote_count: row.voteCount ?? 0,
    popularity: row.popularity !== null ? Number(row.popularity) : 0,
    overview: row.overview ?? "",
    genre_ids: extractGenreIds(row.genres),
  };
}

// ── Balloonerismm result → agenda item converters ─────────────────────────────

function catalogResultToMovie(r: CatalogSearchResult): AgendaMovie | null {
  const id = r.ids.tmdbId;
  if (!id) return null;
  return {
    id,
    media_type: "movie",
    title: r.title,
    poster_path: r.posterPath ?? null,
    backdrop_path: r.backdropPath ?? null,
    release_date: r.releaseDate ?? "",
    vote_average: r.voteAverage ?? 0,
    vote_count: r.voteCount ?? 0,
    popularity: 0,
    overview: r.overview ?? "",
    genre_ids: r.genreIds ?? [],
  };
}

function catalogResultToTv(r: CatalogSearchResult): AgendaTv | null {
  const id = r.ids.tmdbId;
  if (!id) return null;
  return {
    id,
    media_type: "tv",
    title: r.title,
    poster_path: r.posterPath ?? null,
    backdrop_path: r.backdropPath ?? null,
    first_air_date: r.firstAirDate ?? "",
    vote_average: r.voteAverage ?? 0,
    vote_count: r.voteCount ?? 0,
    popularity: 0,
    overview: r.overview ?? "",
    genre_ids: r.genreIds ?? [],
  };
}

// ── Local DB section queries ──────────────────────────────────────────────────

async function getLocalNowPlaying(ninetyDaysAgo: Date, today: Date): Promise<AgendaMovie[]> {
  try {
    const rows = await db.poplog3Title.findMany({
      where: {
        mediaType: "movie",
        releaseDate: { gte: ninetyDaysAgo, lte: today },
        posterPath: { not: null },
      },
      orderBy: [{ popularity: "desc" }, { releaseDate: "desc" }],
      take: 20,
    });
    return rows.map(rowToMovie);
  } catch {
    return [];
  }
}

async function getLocalUpcoming(tomorrow: Date, ninetyDaysAhead: Date): Promise<AgendaMovie[]> {
  try {
    const rows = await db.poplog3Title.findMany({
      where: {
        mediaType: "movie",
        releaseDate: { gte: tomorrow, lte: ninetyDaysAhead },
        posterPath: { not: null },
      },
      orderBy: { releaseDate: "asc" },
      take: 20,
    });
    return rows.map(rowToMovie);
  } catch {
    return [];
  }
}

async function getLocalNewSeries(fortyFiveDaysAgo: Date, today: Date): Promise<AgendaTv[]> {
  try {
    const rows = await db.poplog3Title.findMany({
      where: {
        mediaType: "tv",
        firstAirDate: { gte: fortyFiveDaysAgo, lte: today },
        posterPath: { not: null },
        voteCount: { gte: 3 },
      },
      orderBy: { popularity: "desc" },
      take: 20,
    });
    return rows
      .filter((r) => !isTalkOrNews({ genre_ids: extractGenreIds(r.genres) }))
      .map(rowToTv);
  } catch {
    return [];
  }
}

async function getTrendingMovies(): Promise<{ movies: AgendaMovie[]; source: string }> {
  if (isBalloonerismTrendingEnabled()) {
    try {
      const raw = await catalogGetTrending({ mediaType: "movie", limit: 20 });
      const movies = raw.map(catalogResultToMovie).filter((m): m is AgendaMovie => m !== null);
      if (movies.length >= 5) return { movies, source: "balloonerismm" };
    } catch (err) {
      console.warn("[agenda] balloonerismm trending movies failed", err instanceof Error ? err.message : err);
    }
  }
  try {
    const rows = await db.poplog3Title.findMany({
      where: { mediaType: "movie", posterPath: { not: null }, popularity: { not: null } },
      orderBy: { popularity: "desc" },
      take: 20,
    });
    return { movies: rows.map(rowToMovie), source: "local_db" };
  } catch {
    return { movies: [], source: "empty" };
  }
}

async function getTrendingTv(): Promise<{ shows: AgendaTv[]; source: string }> {
  if (isBalloonerismTrendingEnabled()) {
    try {
      const raw = await catalogGetTrending({ mediaType: "show", limit: 20 });
      const shows = raw.map(catalogResultToTv).filter((s): s is AgendaTv => s !== null);
      if (shows.length >= 5) return { shows, source: "balloonerismm" };
    } catch (err) {
      console.warn("[agenda] balloonerismm trending tv failed", err instanceof Error ? err.message : err);
    }
  }
  try {
    const rows = await db.poplog3Title.findMany({
      where: { mediaType: "tv", posterPath: { not: null }, popularity: { not: null } },
      orderBy: { popularity: "desc" },
      take: 20,
    });
    const shows = rows
      .filter((r) => !isTalkOrNews({ genre_ids: extractGenreIds(r.genres) }))
      .map(rowToTv);
    return { shows, source: "local_db" };
  } catch {
    return { shows: [], source: "empty" };
  }
}

// ── Availability + user state enrichment (local DB only) ──────────────────────

type StateRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  status: string | null;
  computed_state: string | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
};

type EnrichableAgendaItem = AgendaMovie | AgendaTv;

function normalizeProviderType(type?: string | null) {
  if (!type) return null;
  if (type === "flatrate" || type === "subscription") return "streaming";
  return type;
}

/**
 * P4: disponibilidade da Agenda agora vem do FLUXO CANÔNICO
 * (hydrateManyTitleAvailability, cacheOnly + warmCold) — sem ler poplog3_title_availability.
 * User state (status/computed_state + best_provider_* materializado) segue como fallback.
 */
async function enrichAgendaItems(input: {
  userId: string | null;
  items: EnrichableAgendaItem[];
}) {
  const { userId, items } = input;
  if (items.length === 0) return;

  const movieIds = Array.from(new Set(items.filter((i) => i.media_type === "movie").map((i) => i.id)));
  const tvIds = Array.from(new Set(items.filter((i) => i.media_type === "tv").map((i) => i.id)));
  const preferences = await getUserProviderPreferences();
  const region = preferences.region ?? "BR";
  const preferredRoots = new Set(
    (preferences.displayPreferences ?? []).map((preference) => preference.rootKey),
  );

  // Disponibilidade canônica (cache-first; aquece em background os frios/negativos legados).
  const availabilityMap = await hydrateManyTitleAvailability(
    items.map((item) => ({
      key: `${item.media_type}-${item.id}`,
      input: {
        mediaType: item.media_type,
        // tmdbId positivo (TMDB) ou sintético negativo — a camada resolve o imdbId.
        tmdbId: item.id,
        region,
      },
    })),
    { cacheOnly: true, warmCold: true },
  );

  const stateRows = userId ? await getLocalAgendaStateBatch(userId, movieIds, tvIds) : [];
  const stateMap = new Map<string, StateRow>();
  for (const row of stateRows) {
    stateMap.set(`${row.media_type}-${row.tmdb_id}`, row as StateRow);
  }

  for (const item of items) {
    const key = `${item.media_type}-${item.id}`;
    const state = stateMap.get(key);
    const best = availabilityMap.get(key)?.bestProvider ?? null;

    // Prioridade: camada canônica (mais fresca) → best_provider materializado no state.
    const providerName = best?.name ?? state?.best_provider_name ?? null;
    const providerType = normalizeProviderType(best?.type ?? state?.best_provider_type ?? null);
    const providerLogo = best?.logoUrl ?? state?.best_provider_logo ?? null;

    const fallbackRootKey = providerName ? normalizeProvider(providerName)?.rootKey : null;
    const isPreferred = best?.isPreferred ?? Boolean(fallbackRootKey && preferredRoots.has(fallbackRootKey));
    const isStreaming = STREAMING_TYPES.has(providerType ?? "");

    item.user_status = state?.status ?? null;
    item.user_computed_state = state?.computed_state ?? null;
    item.best_provider_name = providerName;
    item.best_provider_type = providerType;
    item.best_provider_logo = providerLogo;
    item.is_preferred_provider = isPreferred;
    item.availability_scope = isPreferred ? "preferred" : isStreaming ? "streaming" : providerName ? "digital" : "none";
  }
}

// ── Route ─────────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const debugSource = request.nextUrl.searchParams.get("debugSource") === "1";

  try {
    const now = new Date();
    const today = new Date(now.toISOString().slice(0, 10));
    const ninetyDaysAgo    = new Date(today.getTime() - 90 * 86_400_000);
    const fortyFiveDaysAgo = new Date(today.getTime() - 45 * 86_400_000);
    const tomorrow         = new Date(today.getTime() + 86_400_000);
    const ninetyDaysAhead  = new Date(today.getTime() + 90 * 86_400_000);

    const [
      nowPlayingRaw,
      upcomingRaw,
      newSeriesRaw,
      { movies: trendingMoviesRaw, source: trendingMoviesSource },
      { shows: trendingTvRaw,   source: trendingTvSource },
    ] = await Promise.all([
      getLocalNowPlaying(ninetyDaysAgo, today),
      getLocalUpcoming(tomorrow, ninetyDaysAhead),
      getLocalNewSeries(fortyFiveDaysAgo, today),
      getTrendingMovies(),
      getTrendingTv(),
    ]);

    // Apply BR editorial bonus to TV sections only (matches original behaviour)
    const nowPlaying     = nowPlayingRaw;
    const upcoming       = upcomingRaw;
    const newSeries      = applyLegacyBrazilianBonus(newSeriesRaw, normalizeTmdbPopularity);
    const trendingMovies = trendingMoviesRaw;
    const trendingTv     = applyLegacyBrazilianBonus(trendingTvRaw, normalizeTmdbPopularity);

    // Calendar-based sections — deferred to ICS/Radar/TVDB etapa
    const airingToday: AgendaTv[]   = [];
    const onTheAir: AgendaTv[]      = [];
    const soonToReturn: AgendaTv[]  = [];

    // User library (optional — auth failure is non-fatal)
    const userLibraryIds: Record<string, string> = {};
    let userId: string | null = null;
    try {
      const user = await getCurrentUser();
      if (user) {
        userId = user.id;
        Object.assign(userLibraryIds, await getLocalUserLibraryIds(user.id));
      }
    } catch {
      // non-fatal
    }

    // Enrich all items with local availability + user state
    try {
      await enrichAgendaItems({
        userId,
        items: [
          ...nowPlaying,
          ...upcoming,
          ...newSeries,
          ...trendingMovies,
          ...trendingTv,
        ],
      });
    } catch (err) {
      console.warn("[agenda] enrichment failed", err);
    }

    // Source accounting
    const localDbCount =
      nowPlayingRaw.length +
      upcomingRaw.length +
      newSeriesRaw.length +
      (trendingMoviesSource === "local_db" ? trendingMoviesRaw.length : 0) +
      (trendingTvSource    === "local_db" ? trendingTvRaw.length    : 0);
    const balloonerismmCount =
      (trendingMoviesSource === "balloonerismm" ? trendingMoviesRaw.length : 0) +
      (trendingTvSource    === "balloonerismm" ? trendingTvRaw.length    : 0);

    const agendaSource =
      balloonerismmCount > 0 && localDbCount > 0 ? "mixed"
      : balloonerismmCount > 0                   ? "balloonerismm"
      : localDbCount > 0                         ? "local_db"
      :                                            "empty_controlled";

    const skippedReasons = [
      "airing_today_requires_episode_calendar_source",
      "on_the_air_requires_episode_calendar_source",
      "soon_to_return_requires_episode_calendar_source",
    ];

    return NextResponse.json(
      {
        nowPlaying,
        upcoming,
        airingToday,
        onTheAir,
        newSeries,
        soonToReturn,
        trendingMovies,
        trendingTv,
        userLibraryIds,
        usedTmdbApi: false,
        agendaSource,
        sourceCounts: { local_db: localDbCount, balloonerismm: balloonerismmCount },
        skippedReasons,
        ...(debugSource && {
          debugSource: {
            trendingMoviesSource,
            trendingTvSource,
            sectionCounts: {
              nowPlaying:     nowPlaying.length,
              upcoming:       upcoming.length,
              newSeries:      newSeries.length,
              trendingMovies: trendingMovies.length,
              trendingTv:     trendingTv.length,
            },
          },
        }),
      },
      { headers: { "Cache-Control": "private, max-age=300" } },
    );
  } catch (err) {
    console.error("[agenda] route error:", err);
    return NextResponse.json(
      { error: "Falha ao carregar a agenda." },
      { status: 500 },
    );
  }
}
