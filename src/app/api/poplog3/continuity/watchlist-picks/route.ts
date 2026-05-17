import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { supabaseAdmin } from "@/server/supabase/admin";

/**
 * Janela mínima (dias) após release_date sem provider confirmado →
 * item tratado como ainda em cartaz e excluído.
 */
const THEATER_WINDOW_DAYS = 45;
const MAX_PICKS = 9;

// ── Tipos públicos ────────────────────────────────────────────────────────────

export type WatchlistPickItem = {
  content_id: string;
  tmdb_id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  release_year: number | null;
  number_of_episodes: number | null;
  number_of_seasons: number | null;
  runtime: number | null;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
  days_on_watchlist: number;
};

// ── Tipos internos ────────────────────────────────────────────────────────────

type StateRow = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  watched_episodes: number;
  best_provider_name: string | null;
  best_provider_type: string | null;
  best_provider_logo: string | null;
  last_event_at: string;
};

type TitleRow = {
  tmdb_id: number;
  media_type: string;
  title: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  vote_average: number | null;
  release_date: string | null;
  first_air_date: string | null;
  runtime: number | null;
  episode_run_time: number[] | null;
  number_of_episodes: number | null;
  number_of_seasons: number | null;
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

  // Penalidade para itens recentemente exibidos (cooldown de refresh)
  const contentId = `${state.media_type}-${state.tmdb_id}`;
  if (excludeSet.has(contentId)) score *= 0.05;

  // Jitter editorial (variação a cada requisição)
  score += Math.random() * 40 - 20;

  return Math.max(0.1, score);
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

    // 1. Busca itens em watchlist pura
    const { data: statesRaw, error: statesError } = await supabaseAdmin
      .from("user_title_state")
      .select(
        "tmdb_id, media_type, watched_episodes, best_provider_name, best_provider_type, best_provider_logo, last_event_at",
      )
      .eq("user_id", user.id)
      .eq("status", "watchlist")
      .order("last_event_at", { ascending: false });

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
      (s) => s.media_type === "movie" || s.watched_episodes === 0,
    );

    if (eligible.length === 0) return NextResponse.json({ items: [] });

    const tmdbIds = eligible.map((s) => s.tmdb_id);

    // 3. Metadados em batch
    const { data: titlesRaw } = await supabaseAdmin
      .from("poplog3_titles")
      .select(
        "tmdb_id, media_type, title, poster_path, backdrop_path, vote_average, release_date, first_air_date, runtime, episode_run_time, number_of_episodes, number_of_seasons",
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
      }

      const daysOnWatchlist = Math.floor(
        (now - new Date(state.last_event_at).getTime()) / 86_400_000,
      );
      const runtime = title.episode_run_time?.[0] ?? title.runtime ?? null;

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
        ),
      });
    }

    if (scored.length === 0) return NextResponse.json({ items: [] });

    // 5. Amostragem ponderada
    const weights = scored.map((x) => x.score);
    const selected = weightedSample(scored, weights, MAX_PICKS);

    // 6. Garante pelo menos 1 slot para item sem provider confirmado
    //    (desde que já tenha passado a janela de cinema)
    const hasNoProvider = selected.some((x) => !x.state.best_provider_name);
    if (!hasNoProvider) {
      const noProviderPool = scored.filter(
        (x) =>
          !x.state.best_provider_name &&
          !selected.includes(x),
      );
      if (noProviderPool.length > 0 && selected.length >= MAX_PICKS) {
        const pick = weightedSample(
          noProviderPool,
          noProviderPool.map((x) => x.score),
          1,
        );
        if (pick.length > 0) selected[selected.length - 1] = pick[0];
      }
    }

    // 7. Monta resposta
    const items: WatchlistPickItem[] = selected.map(({ state, title }) => {
      const daysOnWatchlist = Math.floor(
        (now - new Date(state.last_event_at).getTime()) / 86_400_000,
      );
      const rawDate = title.release_date ?? title.first_air_date ?? null;
      const releaseYear = rawDate ? new Date(rawDate).getFullYear() : null;
      const runtime = title.episode_run_time?.[0] ?? title.runtime ?? null;

      return {
        content_id: `${state.media_type}-${state.tmdb_id}`,
        tmdb_id: state.tmdb_id,
        media_type: state.media_type,
        title: title.title ?? `Título ${state.tmdb_id}`,
        poster_path: title.poster_path ?? null,
        backdrop_path: title.backdrop_path ?? null,
        vote_average: title.vote_average ?? null,
        release_year: releaseYear,
        number_of_episodes: title.number_of_episodes ?? null,
        number_of_seasons: title.number_of_seasons ?? null,
        runtime,
        best_provider_name: state.best_provider_name,
        best_provider_type: state.best_provider_type,
        best_provider_logo: state.best_provider_logo,
        days_on_watchlist: daysOnWatchlist,
      };
    });

    return NextResponse.json({ items });
  } catch (err) {
    console.error("[watchlist-picks] unhandled error", err);
    return NextResponse.json({ items: [] });
  }
}
