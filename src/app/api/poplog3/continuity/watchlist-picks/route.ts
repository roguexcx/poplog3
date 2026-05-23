import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";
import {
  formatEpisodeRuntimeLabel,
  formatRuntimeLabel,
} from "@/lib/domain-labels";
import { resolveRuntimeByMediaType } from "@/lib/runtime";
import { getSeriesEpisodeRuntimesMap } from "@/server/runtime/series-episode-runtimes";

/**
 * Janela mínima (dias) após release_date sem provider confirmado →
 * item tratado como ainda em cartaz e excluído.
 */
const THEATER_WINDOW_DAYS = 45;
const MAX_PICKS = 9;
const MAX_SERIES_START_PICKS = 5;

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type WatchlistPickItem = {
  content_id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  original_title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  release_year: number | null;
  number_of_episodes: number | null;
  number_of_seasons: number | null;
  runtime: number | null;
  runtime_label: string | null;
  total_runtime_label?: string | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
  days_on_watchlist: number;
  overview?: string | null;
  genres?: string[];
  series_status?: string | null;
  editorial_reason?: string | null;
  contextual_badges?: string[];
  award_badges?: string[];
};

// ── Tipos internos ────────────────────────────────────────────────────────────

type StateRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  watched_episodes: number;
  computed_state?: string | null;
  aired_episodes?: number | null;
  total_episodes?: number | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
  last_event_at: string;
};

type TitleRow = {
  tmdb_id: number;
  media_type: string;
  title: string | null;
  original_title: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  vote_count?: number | null;
  popularity?: number | null;
  release_date: string | null;
  first_air_date: string | null;
  last_air_date?: string | null;
  runtime: number | null;
  episode_run_time: number[] | null;
  number_of_episodes: number | null;
  number_of_seasons: number | null;
  genres?: Array<{ id?: number; name?: string }> | string[] | null;
  tmdb_payload?: Record<string, unknown> | null;
};

type RatingRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  imdb_rating: number | null;
  imdb_votes: number | null;
  rotten_tomatoes_score: number | null;
  metacritic_score: number | null;
  poplog_score: number | null;
  source_payload: Record<string, unknown> | null;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Retorna true se o filme provavelmente ainda está em cartaz:
 * lançado há menos de THEATER_WINDOW_DAYS dias E sem provider de streaming confirmado.
 */
function isInTheaterWindow(
  releaseDate: string | null,
  providerName: string | null,
): boolean {
  if (!releaseDate || providerName) return false;
  const daysSince = (Date.now() - new Date(releaseDate).getTime()) / 86_400_000;
  return daysSince >= 0 && daysSince < THEATER_WINDOW_DAYS;
}

/**
 * Pontuação editorial para priorização ponderada.
 * Itens na excludeSet (recém exibidos) recebem peso quase zero.
 */
function scoreItem(
  state: StateRow,
  daysOnWatchlist: number,
  voteAverage: number | null,
  totalEpisodes: number | null,
  runtime: number | null,
  excludeSet: Set<string>,
  options: { seriesStartOnly?: boolean; status?: string | null } = {},
): number {
  let score = 50;

  // Disponibilidade em streaming → principal sinal de "hora certa"
  switch (state.best_provider_type) {
    case "subscription": score += 60; break;
    case "free":
    case "ads":          score += 35; break;
    case "rent":         score += 10; break;
    // null/buy: sem bônus (mas não excluído)
  }

  // Tempo na watchlist
  if (daysOnWatchlist > 90)      score += 30; // esquecido — hora de resgatar
  else if (daysOnWatchlist > 30) score += 20;
  else if (daysOnWatchlist < 7)  score += 15; // recém adicionado — entusiasmo

  // Qualidade percebida
  if (voteAverage != null) {
    if (voteAverage >= 8.0)      score += 25;
    else if (voteAverage >= 7.0) score += 15;
  }

  // Preferência por conteúdo curto (sessões fáceis)
  if (state.media_type === "movie" && runtime != null && runtime <= 100) score += 15;
  if (totalEpisodes != null && totalEpisodes <= 6) score += 25; // minissérie
  if (totalEpisodes != null && totalEpisodes <= 13) score += 10;

  if (options.seriesStartOnly) {
    if (totalEpisodes != null && totalEpisodes <= 4) score += 30;
    if (totalEpisodes != null && totalEpisodes > 36) score -= 25;
    if (runtime != null && runtime <= 35) score += 18;
    if (runtime != null && runtime > 58) score -= 8;
    if (isFinishedSeriesStatus(options.status)) score += 18;
    if (state.best_provider_name) score += 20;
  }

  // Penalidade para itens recentemente exibidos (cooldown de refresh)
  const contentId = `${state.media_type}-${state.tmdb_id}`;
  if (excludeSet.has(contentId)) score *= 0.05;

  // Jitter editorial (variação a cada requisição)
  score += Math.random() * 40 - 20;

  return Math.max(0.1, score);
}

function isFinishedSeriesStatus(status?: string | null): boolean {
  return /ended|canceled|cancelled|finalizada|encerrada/i.test(status ?? "");
}

function isMiniSeries(title: TitleRow): boolean {
  const status = readSeriesStatus(title);
  return (
    /mini/i.test(status ?? "") ||
    (title.number_of_seasons === 1 &&
      title.number_of_episodes != null &&
      title.number_of_episodes <= 8)
  );
}

function readSeriesStatus(title: TitleRow): string | null {
  const payloadStatus = title.tmdb_payload?.status;
  return typeof payloadStatus === "string" ? payloadStatus : null;
}

function normalizeGenres(title: TitleRow): string[] {
  const genres = title.genres ?? title.tmdb_payload?.genres;
  if (!Array.isArray(genres)) return [];

  return genres
    .map((genre) => {
      if (typeof genre === "string") return genre;
      if (genre && typeof genre === "object" && "name" in genre) {
        const name = (genre as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((name): name is string => Boolean(name))
    .slice(0, 2);
}

function hasValidSeriesShape(title: TitleRow): boolean {
  const totalEpisodes = title.number_of_episodes ?? 0;
  const totalSeasons = title.number_of_seasons ?? 0;
  if (totalEpisodes <= 0 || totalSeasons <= 0) return false;

  const seasons = title.tmdb_payload?.seasons;
  if (!Array.isArray(seasons)) return true;

  const validSeasonEpisodes = seasons
    .filter((season) => {
      if (!season || typeof season !== "object") return false;
      const record = season as Record<string, unknown>;
      const seasonNumber =
        typeof record.season_number === "number" ? record.season_number : null;
      const episodeCount =
        typeof record.episode_count === "number" ? record.episode_count : null;
      return seasonNumber !== null && seasonNumber > 0 && (episodeCount ?? 0) > 0;
    })
    .reduce((sum, season) => {
      const count = (season as Record<string, unknown>).episode_count;
      return sum + (typeof count === "number" ? count : 0);
    }, 0);

  return validSeasonEpisodes > 0;
}

function compactOverview(overview?: string | null): string | null {
  if (!overview) return null;
  const clean = overview.replace(/\s+/g, " ").trim();
  if (clean.length <= 170) return clean;
  const cut = clean.slice(0, 167);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 80 ? lastSpace : 167)}...`;
}

function buildSeriesStatusLabel(title: TitleRow): string | null {
  if (isMiniSeries(title)) return "Minissérie";
  const status = readSeriesStatus(title);
  if (isFinishedSeriesStatus(status)) return "Finalizada";
  if (/returning|em produ/i.test(status ?? "")) return "Em produção";
  return status;
}

function buildContextualBadges(input: {
  state: StateRow;
  title: TitleRow;
  runtime: number | null;
  totalRuntimeMinutes: number | null;
  daysOnWatchlist: number;
}): string[] {
  const badges: string[] = [];
  const { state, title, runtime, totalRuntimeMinutes } = input;
  const episodes = title.number_of_episodes ?? null;
  const isMovie = state.media_type === "movie";

  // Fácil de começar: curto o suficiente
  if (
    (isMovie && runtime != null && runtime <= 105) ||
    (!isMovie && episodes != null && episodes <= 8) ||
    (!isMovie && totalRuntimeMinutes != null && totalRuntimeMinutes <= 420) ||
    (!isMovie && runtime != null && runtime <= 35)
  ) {
    badges.push("Fácil de começar");
  }

  // Disponível no streaming preferido
  if (
    state.best_provider_name &&
    ["subscription", "free", "ads"].includes(state.best_provider_type ?? "")
  ) {
    badges.push("No seu streaming");
  }

  // Série finalizada / minissérie
  if (!isMovie) {
    if (isFinishedSeriesStatus(readSeriesStatus(title)) || isMiniSeries(title)) {
      badges.push(isMiniSeries(title) ? "Minissérie" : "Finalizada");
    }
  }

  // Bem avaliado
  const voteAvg = title.vote_average ?? 0;
  const voteCount = title.vote_count ?? 0;
  if (voteAvg >= 8.5 || (voteAvg >= 8.0 && voteCount >= 3000)) {
    badges.push("Muito bem avaliado");
  } else if (voteAvg >= 7.5 || (voteAvg >= 7.0 && voteCount >= 2000)) {
    badges.push("Bem avaliado");
  }

  // Em alta (lançamento recente ou popularidade alta)
  const airDate = title.first_air_date ?? title.release_date;
  const refDate = airDate ? new Date(airDate).getTime() : null;
  const recentRelease =
    refDate != null &&
    Number.isFinite(refDate) &&
    (Date.now() - refDate) / 86_400_000 <= 180;
  if (recentRelease || (title.popularity ?? 0) >= 80) {
    badges.push("Em alta");
  }

  return Array.from(new Set(badges)).slice(0, 4);
}

function buildEditorialReason(input: {
  state: StateRow;
  title: TitleRow;
  runtime: number | null;
  totalRuntimeLabel: string | null;
  genres: string[];
}): string {
  const { state, title, runtime, totalRuntimeLabel, genres } = input;
  const episodes = title.number_of_episodes ?? null;
  const genre = genres[0];

  if (isMiniSeries(title) && totalRuntimeLabel) {
    return `Uma história fechada para entrar sem compromisso: ${totalRuntimeLabel.replace(" restantes", "")} no total.`;
  }

  if (state.best_provider_name && episodes != null && episodes <= 12) {
    return `${episodes} episódios e já disponível na ${state.best_provider_name}.`;
  }

  if (runtime != null && runtime <= 35 && genre) {
    return `Episódios curtos, ritmo leve e bom encaixe com ${genre.toLowerCase()}.`;
  }

  if (isFinishedSeriesStatus(readSeriesStatus(title))) {
    return "Finalizada, sem espera entre temporadas e com entrada bem definida.";
  }

  return "Uma escolha da sua watchlist com baixo atrito para começar agora.";
}

function buildAwardBadges(rating?: RatingRow | null): string[] {
  const badges: string[] = [];
  const awards =
    typeof rating?.source_payload?.Awards === "string"
      ? rating.source_payload.Awards
      : "";
  const normalized = awards.toLowerCase();

  const emmyWins = awards.match(/Won\s+(\d+)\s+Primetime Emmy/i);
  const emmyNoms = awards.match(/Nominated\s+for\s+(\d+)\s+Primetime Emmy/i);
  const globeWins = awards.match(/Won\s+(\d+)\s+Golden Globe/i);
  const globeNoms = awards.match(/Nominated\s+for\s+(\d+)\s+Golden Globe/i);
  const oscarWins = awards.match(/Won\s+(\d+)\s+Oscar/i);
  const oscarNoms = awards.match(/Nominated\s+for\s+(\d+)\s+Oscar/i);

  if (oscarWins) badges.push(Number(oscarWins[1]) > 1 ? `${oscarWins[1]} Oscars` : "Vencedor do Oscar");
  else if (oscarNoms) badges.push(`${oscarNoms[1]} indicações ao Oscar`);

  if (emmyWins) badges.push(Number(emmyWins[1]) > 1 ? `${emmyWins[1]} Emmys` : "Vencedor do Emmy");
  else if (emmyNoms && badges.length < 2) badges.push(`${emmyNoms[1]} indicações ao Emmy`);

  if (globeWins && badges.length < 2) badges.push("Vencedor do Globo de Ouro");
  else if (globeNoms && badges.length < 2) badges.push("Indicado ao Globo de Ouro");

  if (
    badges.length === 0 &&
    (rating?.metacritic_score ?? 0) >= 85
  ) {
    badges.push("Aclamado pela crítica");
  } else if (
    badges.length === 0 &&
    (rating?.rotten_tomatoes_score ?? 0) >= 92
  ) {
    badges.push("Aprovação quase unânime");
  } else if (
    badges.length === 0 &&
    ((rating?.imdb_rating ?? 0) >= 8.0 && (rating?.imdb_votes ?? 0) >= 100_000)
  ) {
    badges.push("Top IMDB");
  }

  // Badge de nota alta com volume de votos
  if (badges.length === 0 && normalized.includes("critical")) {
    badges.push("Alta aclamação da crítica");
  }

  return badges.slice(0, 2);
}

/**
 * Amostragem ponderada sem reposição.
 * Usa roulette-wheel selection para cada extração.
 */
function weightedSample<T>(items: T[], weights: number[], n: number): T[] {
  const result: T[] = [];
  const pool = [...items];
  const poolWeights = [...weights];

  while (result.length < n && pool.length > 0) {
    const total = poolWeights.reduce((a, b) => a + b, 0);
    let rand = Math.random() * total;
    let idx = pool.length - 1;
    for (let i = 0; i < pool.length; i++) {
      rand -= poolWeights[i];
      if (rand <= 0) { idx = i; break; }
    }
    result.push(pool[idx]);
    pool.splice(idx, 1);
    poolWeights.splice(idx, 1);
  }

  return result;
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }

    // IDs recentemente exibidos (para cooldown de refresh)
    const { searchParams } = new URL(request.url);
    const excludeParam = searchParams.get("exclude") ?? "";
    const excludeSet = new Set(excludeParam.split(",").filter(Boolean));
    const seriesStartOnly = searchParams.get("seriesStart") === "1";
    const maxPicks = seriesStartOnly ? MAX_SERIES_START_PICKS : MAX_PICKS;

    // 1. Busca itens em watchlist pura
    let stateQuery = supabaseAdmin
      .from("user_title_state")
      .select(
        "tmdb_id, media_type, watched_episodes, aired_episodes, total_episodes, computed_state, best_provider_name, best_provider_type, best_provider_logo, last_event_at",
      )
      .eq("user_id", user.id)
      .eq("status", "watchlist")
      .order("last_event_at", { ascending: false });

    if (seriesStartOnly) {
      stateQuery = stateQuery.eq("media_type", "tv").eq("computed_state", "watchlist");
    }

    const { data: statesRaw, error: statesError } = await stateQuery;

    if (statesError) {
      console.error("[watchlist-picks] states query failed", {
        message: statesError.message,
        code: statesError.code,
        details: statesError.details,
      });
      return NextResponse.json({ items: [] });
    }

    if (!statesRaw || statesRaw.length === 0) {
      return NextResponse.json({ items: [] });
    }

    const states = statesRaw as StateRow[];

    // 2. Exclui séries já iniciadas (pertencem ao bloco "Continue de onde parou")
    const eligible = states.filter(
      (s) =>
        (seriesStartOnly ? s.media_type === "tv" : s.media_type === "movie" || s.media_type === "tv") &&
        (s.media_type === "movie" || s.watched_episodes === 0),
    );

    if (eligible.length === 0) return NextResponse.json({ items: [] });

    const tmdbIds = eligible.map((s) => s.tmdb_id);
    const tvIds = eligible
      .filter((s) => s.media_type === "tv")
      .map((s) => s.tmdb_id);
    const episodeRuntimesBySeries =
      tvIds.length > 0 ? await getSeriesEpisodeRuntimesMap(tvIds) : new Map();

    // 3. Metadados em batch
    const { data: titlesRaw } = await supabaseAdmin
      .from("poplog3_titles")
      .select(
        "tmdb_id, media_type, title, original_title, overview, poster_path, backdrop_path, vote_average, vote_count, popularity, release_date, first_air_date, last_air_date, runtime, episode_run_time, number_of_episodes, number_of_seasons, genres, tmdb_payload",
      )
      .in("tmdb_id", tmdbIds);

    // A mesma série pode aparecer como "tv" e o mesmo tmdb_id como "movie" em raros casos;
    // usa chave composta media_type+tmdb_id para evitar colisão.
    const titleMap = new Map<string, TitleRow>(
      ((titlesRaw ?? []) as TitleRow[]).map((t) => [
        `${t.media_type}-${t.tmdb_id}`,
        t,
      ]),
    );

    const now = Date.now();

    // 4. Filtra janela de cinema e calcula scores
    type ScoredEntry = { state: StateRow; title: TitleRow; score: number };
    const scored: ScoredEntry[] = [];

    for (const state of eligible) {
      const key = `${state.media_type}-${state.tmdb_id}`;
      const title = titleMap.get(key);
      if (!title) continue;

      // Filmes: exclui não lançados e janela de cinema
      if (state.media_type === "movie") {
        if (!title.release_date || new Date(title.release_date).getTime() > now) continue;
        if (isInTheaterWindow(title.release_date, state.best_provider_name)) continue;
      }
      // Séries: exclui apenas quando a data de estreia é conhecida E está no futuro.
      // Se first_air_date for null, mantém (série pode já estar em exibição sem data cadastrada).
      if (state.media_type === "tv") {
        if (title.first_air_date && new Date(title.first_air_date).getTime() > now) continue;
        if (seriesStartOnly && !hasValidSeriesShape(title)) continue;
      }

      const daysOnWatchlist = Math.floor(
        (now - new Date(state.last_event_at).getTime()) / 86_400_000,
      );
      const runtime = resolveRuntimeByMediaType({
        mediaType: state.media_type,
        runtimeMinutes: title.runtime,
        episodeRunTime: title.episode_run_time,
        episodes: episodeRuntimesBySeries.get(state.tmdb_id) ?? null,
      }).minutes;

      scored.push({
        state,
        title,
        score: scoreItem(
          state,
          daysOnWatchlist,
          title.vote_average,
          title.number_of_episodes,
          runtime,
          excludeSet,
          {
            seriesStartOnly,
            status: readSeriesStatus(title),
          },
        ),
      });
    }

    if (scored.length === 0) return NextResponse.json({ items: [] });

    // 5. Amostragem ponderada
    const weights = scored.map((x) => x.score);
    const selected = weightedSample(scored, weights, maxPicks);

    // 6. Garante pelo menos 1 slot para item sem provider confirmado
    //    (desde que já tenha passado a janela de cinema)
    const hasNoProvider = selected.some((x) => !x.state.best_provider_name);
    if (!hasNoProvider) {
      const noProviderPool = scored.filter(
        (x) =>
          !x.state.best_provider_name &&
          !selected.includes(x),
      );
      if (noProviderPool.length > 0 && selected.length >= maxPicks) {
        const pick = weightedSample(
          noProviderPool,
          noProviderPool.map((x) => x.score),
          1,
        );
        if (pick.length > 0) selected[selected.length - 1] = pick[0];
      }
    }

    const selectedIds = selected.map((entry) => entry.state.tmdb_id);
    const { data: ratingsRaw } =
      selectedIds.length > 0
        ? await supabaseAdmin
            .from("title_ratings")
            .select(
              "tmdb_id, media_type, imdb_rating, imdb_votes, rotten_tomatoes_score, metacritic_score, poplog_score, source_payload",
            )
            .in("tmdb_id", selectedIds)
        : { data: [] };

    const ratingMap = new Map<number, RatingRow>(
      ((ratingsRaw ?? []) as RatingRow[]).map((rating) => [
        rating.tmdb_id,
        rating,
      ]),
    );

    // 7. Monta resposta
    const items: WatchlistPickItem[] = selected.map(({ state, title }) => {
      const daysOnWatchlist = Math.floor(
        (now - new Date(state.last_event_at).getTime()) / 86_400_000,
      );
      const rawDate = title.release_date ?? title.first_air_date ?? null;
      const releaseYear = rawDate ? new Date(rawDate).getFullYear() : null;
      const runtimeResolution = resolveRuntimeByMediaType({
        mediaType: state.media_type,
        runtimeMinutes: title.runtime,
        episodeRunTime: title.episode_run_time,
        episodes: episodeRuntimesBySeries.get(state.tmdb_id) ?? null,
      });
      const episodeCount =
        state.media_type === "tv" ? title.number_of_episodes ?? null : null;
      const totalRuntimeMinutes =
        state.media_type === "tv" &&
        runtimeResolution.minutes != null &&
        episodeCount != null &&
        episodeCount > 0
          ? runtimeResolution.minutes * episodeCount
          : null;
      const totalRuntimeLabel = formatRuntimeLabel(totalRuntimeMinutes, {
        estimated: runtimeResolution.estimated,
      });
      const runtimeLabel =
        state.media_type === "tv"
          ? formatEpisodeRuntimeLabel(runtimeResolution.minutes, {
              estimated: runtimeResolution.estimated,
            })
          : formatRuntimeLabel(runtimeResolution.minutes, {
              estimated: runtimeResolution.estimated,
            });
      const genres = normalizeGenres(title);
      const contextualBadges = buildContextualBadges({
              state,
              title,
              runtime: runtimeResolution.minutes,
              totalRuntimeMinutes,
              daysOnWatchlist,
            });
      const awardBadges = buildAwardBadges(ratingMap.get(state.tmdb_id));

      return {
        content_id: `${state.media_type}-${state.tmdb_id}`,
        tmdb_id: state.tmdb_id,
        media_type: state.media_type,
        title: title.title ?? `Título ${state.tmdb_id}`,
        original_title: title.original_title ?? null,
        poster_path: title.poster_path ?? null,
        backdrop_path: title.backdrop_path ?? null,
        vote_average: title.vote_average ?? null,
        release_year: releaseYear,
        number_of_episodes: title.number_of_episodes ?? null,
        number_of_seasons: title.number_of_seasons ?? null,
        runtime: runtimeResolution.minutes,
        runtime_label: runtimeLabel,
        total_runtime_label: totalRuntimeLabel,
        best_provider_name: state.best_provider_name,
        best_provider_type: state.best_provider_type,
        best_provider_logo: state.best_provider_logo,
        days_on_watchlist: daysOnWatchlist,
        overview: compactOverview(title.overview),
        genres,
        series_status:
          state.media_type === "tv" ? buildSeriesStatusLabel(title) : null,
        editorial_reason:
          state.media_type === "tv"
            ? buildEditorialReason({
                state,
                title,
                runtime: runtimeResolution.minutes,
                totalRuntimeLabel,
                genres,
              })
            : null,
        contextual_badges: contextualBadges,
        award_badges: awardBadges,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[watchlist-picks] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}
