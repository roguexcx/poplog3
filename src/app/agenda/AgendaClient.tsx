"use client";

import {
  useCallback, useEffect, useMemo, useRef, useState,
} from "react";
import { useRouter } from "next/navigation";
import ContextualAttribution from "@/components/attribution/ContextualAttribution";
import PageShell from "@/components/layout/PageShell";
import type { IcsSeriesGroup, MovieGroup, ContentCategory } from "@/lib/ics-engine";
import { filterEnrichedGroup, CATEGORY_PRIORITY } from "@/lib/ics-engine";
import type { IcsAgendaResponse } from "@/app/api/ics/agenda/route";

// ── Constantes ─────────────────────────────────────────────────────────────────

const TMDB_IMG = (path: string | null, size: string) =>
  path ? `https://image.tmdb.org/t/p/${size}${path}` : null;

// Idiomas com texto não-latino nos posters — preferir backdrop nesses casos
const POSTER_TEXT_LANGS = new Set(["ja","ko","zh","th","hi","ar","he","ru","uk","vi","id"]);

// Retorna a melhor imagem para cards HORIZONTAIS (hero, wide, square)
// Sempre backdrop; nunca poster com texto estrangeiro
function bestHorizontalImg(
  tmdb: { backdrop_path: string | null; poster_path: string | null; clean_backdrop_path?: string | null },
  size = "w780",
): string | null {
  // Cards horizontais: NUNCA usar poster — só backdrop limpo ou backdrop padrão
  const path = tmdb.clean_backdrop_path ?? tmdb.backdrop_path;
  if (!path) return null;
  return TMDB_IMG(path, size);
}

// Retorna a melhor imagem para cards VERTICAIS (poster, tall)
// Usa poster se for idioma com texto legível; caso contrário usa backdrop
function bestVerticalImg(
  tmdb: { backdrop_path: string | null; poster_path: string | null; clean_backdrop_path?: string | null; original_language?: string },
): string | null {
  const lang        = tmdb.original_language ?? "";
  const cleanBd     = tmdb.clean_backdrop_path ?? tmdb.backdrop_path;
  if (POSTER_TEXT_LANGS.has(lang)) {
    // Idioma não-latino: usar backdrop limpo (sem caracteres)
    return TMDB_IMG(cleanBd, "w780") || TMDB_IMG(tmdb.poster_path, "w342");
  }
  // Para idiomas latinos: poster ok; fallback pro backdrop limpo
  return TMDB_IMG(tmdb.poster_path, "w342") || TMDB_IMG(cleanBd, "w780");
}


const ENRICH_BATCH   = 10;
const ENRICH_PAUSE   = 700;
const SPOTLIGHT_MS   = 6000; // ms entre slides do spotlight

// ── Fases do carregamento ──────────────────────────────────────────────────────

type Phase =
  | "idle"
  | "fetching_ics"
  | "grouping"
  | "cache_check"
  | "enriching"
  | "done";

const PHASE_LABELS: Record<Phase, string> = {
  idle:         "Iniciando radar…",
  fetching_ics: "Lendo sinais…",
  grouping:     "Agrupando séries…",
  cache_check:  "Consultando cache…",
  enriching:    "Enriquecendo dados…",
  done:         "Radar ativo",
};

// ── Tipos de view ──────────────────────────────────────────────────────────────

type ViewMode = "day" | "week" | "month";

// ── Helpers de data ────────────────────────────────────────────────────────────

function toLocalDateStr(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayStr() { return toLocalDateStr(new Date()); }

function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatMonthYear(y: number, m: number) {
  return new Date(y, m, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

function formatWeekRange(start: Date) {
  const end = new Date(start); end.setDate(end.getDate() + 6);
  const o: Intl.DateTimeFormatOptions = { day: "2-digit", month: "short" };
  return `${start.toLocaleDateString("pt-BR", o)} – ${end.toLocaleDateString("pt-BR", o)}`;
}

function formatDayFull(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });
}

function formatTime(isoStr: string): string {
  // isoStr is like "2025-05-20T01:00:00.000Z"
  const d = new Date(isoStr);
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function daysUntilDate(dateStr: string): number {
  const date = new Date(`${dateStr}T12:00:00`);
  const today = new Date(`${todayStr()}T12:00:00`);
  return Math.ceil((date.getTime() - today.getTime()) / 86_400_000);
}

function dateLabelFromDays(days: number): string {
  if (days <= 0) return "Hoje";
  if (days === 1) return "Amanhã";
  if (days <= 7) return `Em ${days} dias`;
  // Mais de 7 dias: mostra data formatada (ex: "12 de jun.")
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString("pt-BR", { day: "numeric", month: "short" });
}

function getDaysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }

function getFirstDayOfMonth(y: number, m: number) {
  const d = new Date(y, m, 1).getDay();
  return d === 0 ? 6 : d - 1; // 0=Seg
}

// ── Janela ativa de 30 dias a partir de hoje ──────────────────────────────────
// Usado pelo modo "month" como feed editorial contínuo (não calendário fixo).

function activeWindow(): { start: string; end: string } {
  const now = new Date();
  const start = toLocalDateStr(now);
  const end30 = new Date(now);
  end30.setDate(end30.getDate() + 30);
  return { start, end: toLocalDateStr(end30) };
}

// ── Filtro: só mostra grupos com poster + nome TMDB ───────────────────────────

function hasValidTmdb(g: IcsSeriesGroup): boolean {
  // Precisa ter nome E pelo menos uma imagem (poster ou backdrop)
  return !!(g.tmdb?.name && (g.tmdb?.poster_path || g.tmdb?.backdrop_path));
}

function firstEpisodeOnDay(group: IcsSeriesGroup, dateStr: string) {
  return group.episodes
    .filter((ep) => ep.startAt.slice(0, 10) === dateStr)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))[0] ?? null;
}

function episodesOnDay(group: IcsSeriesGroup, dateStr: string) {
  return group.episodes
    .filter((ep) => ep.startAt.slice(0, 10) === dateStr)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

function isPremiereEpisode(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  if (!ep || ep.season !== 1 || ep.episode !== 1) return false;
  // Não é estreia se o TMDB já indica múltiplas temporadas (série estabelecida)
  const numSeasons = group.tmdb?.number_of_seasons;
  if (numSeasons && numSeasons > 1) return false;
  // Grupos sintéticos TMDB (key começa com "tmdb-") têm number_of_seasons=null
  // mas podem ser séries estabelecidas. Verificamos first_air_date:
  // se a série estreou há mais de 180 dias, não tratamos como estreia nova.
  if (group.key.startsWith("tmdb-") && group.tmdb?.first_air_date) {
    const airMs = new Date(group.tmdb.first_air_date).getTime();
    const nowMs  = Date.now();
    if (nowMs - airMs > 180 * 24 * 3600 * 1000) return false;
  }
  return true;
}

function isSeasonStart(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  return !!ep && ep.episode === 1;
}

function isSeasonFinaleGuess(group: IcsSeriesGroup, dateStr: string): boolean {
  const ep = firstEpisodeOnDay(group, dateStr);
  if (!ep) return false;
  const seasonEps = group.episodes.filter((item) => item.season === ep.season);
  const maxEp = Math.max(...seasonEps.map((item) => item.episode));
  return maxEp > 1 && ep.episode === maxEp;
}

// ── Helpers de normalização editorial ─────────────────────────────────────────

/** Normaliza popularity TMDB com curva log + teto para evitar que títulos virais
 *  (popularity > 500) monopolizem o feed. Cap efetivo: ~28 pontos. */
function normalizePopularity(raw: number): number {
  if (!raw || raw <= 0) return 0;
  const capped = Math.min(raw, 500);          // teto: pop 500 → mesmo peso que 3000
  return Math.log10(capped + 1) * 10;         // log10(501) ≈ 2.7 → ~27 pts
}

/** Bônus para produções brasileiras que não sejam novela/reality/talk show. */
function brazilBonus(group: IcsSeriesGroup): number {
  const tmdb = group.tmdb;
  if (!tmdb) return 0;
  const countries: string[] = (tmdb as unknown as Record<string, unknown>).origin_country as string[] ?? [];
  if (!countries.includes("BR")) return 0;
  // Categorias bloqueadas para bônus BR
  const cat = group.category;
  if (cat === "REALITY" || cat === "PODCAST" || cat === "DAILY_SOAP") return 0;
  // Penalidade leve em vez de bloqueio para SOAP / formatos de novela
  const genres: number[] = (tmdb as unknown as Record<string, unknown>).genre_ids as number[] ?? [];
  const isSoap = genres.includes(10766);  // TMDB genre 10766 = Soap
  return isSoap ? 5 : 18;  // +18 pts para produções BR legítimas, +5 para ambíguas
}

function groupEditorialScore(
  group: IcsSeriesGroup,
  dateStr: string,
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
): number {
  const tmdbId = group.tmdb?.tmdb_id;
  const days = daysUntilDate(dateStr);
  const timeBoost = days <= 0 ? 18 : days === 1 ? 12 : days <= 7 ? 7 : Math.max(0, 6 - Math.floor(days / 5));
  // Penalidade para quem não tem imagem — não deve ocupar slots de destaque
  const hasBackdrop = !!(group.tmdb?.clean_backdrop_path ?? group.tmdb?.backdrop_path);
  const hasPoster   = !!group.tmdb?.poster_path;
  const imgPenalty  = hasBackdrop ? 0 : hasPoster ? -25 : -60;
  return (
    (group.relevanceScore ?? 0) +
    normalizePopularity(group.tmdb?.popularity ?? 0) +   // log-normalizado (era /10 linear)
    // K-dramas (ko/zh/th) sem boost trending — TMDB trending global é distorcido
    ((() => { const l = group.tmdb?.original_language ?? ""; const asian = new Set(["ko","zh","th","hi","tl"]); if (asian.has(l)) return 0; if (l === "ja") return (trendingDay.has(tmdbId ?? -1) || trendingWeek.has(tmdbId ?? -1)) ? 5 : 0; return trendingDay.has(tmdbId ?? -1) ? 38 : trendingWeek.has(tmdbId ?? -1) ? 20 : 0; })()) +
    (isPremiereEpisode(group, dateStr) ? 34 : 0) +
    (isSeasonFinaleGuess(group, dateStr) ? 30 : 0) +
    (isSeasonStart(group, dateStr) ? 12 : 0) +
    (group.episodeCount > 1 ? Math.min(12, group.episodeCount * 2) : 0) +
    brazilBonus(group) +
    timeBoost +
    imgPenalty
  );
}

function editorialSignal(
  group: IcsSeriesGroup,
  dateStr: string,
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
  movie?: MovieGroup,
) {
  // Sinais para filmes
  if (movie) {
    const tmdbId = movie.movie.tmdb_id;
    if (trendingDay.has(tmdbId))  return { label: "Explodindo agora",  color: "rose" as const };
    const releaseDate = movie.movie.release_date ?? dateStr;
    const days = daysUntilDate(releaseDate);
    if (days === 0)                return { label: "Estreia hoje",       color: "emerald" as const };
    if (days > 0 && days <= 3)    return { label: "Em breve",            color: "cyan" as const };
    if (days > 3 && days <= 14)   return { label: `Estreia em ${days}d`, color: "cyan" as const };
    if (days > 14)                 return { label: "Próxima estreia",     color: "slate" as const };
    // Passou: estreou recentemente (days < 0 = já nos cinemas)
    if (trendingWeek.has(tmdbId)) return { label: "Trending",            color: "amber" as const };
    if ((movie.relevanceScore ?? 0) >= 65) return { label: "Imperdível", color: "sky" as const };
    return { label: "Nos cinemas",  color: "slate" as const };
  }

  // Sinais para séries
  const tmdbId = group.tmdb?.tmdb_id;
  if (trendingDay.has(tmdbId ?? -1))   return { label: "Explodindo agora",   color: "rose" as const };
  if (isSeasonFinaleGuess(group, dateStr)) return { label: "Final de temporada", color: "violet" as const };
  // "Estreia de série" só para S01E01 — série completamente nova
  if (isPremiereEpisode(group, dateStr))   return { label: "Estreia de série",   color: "emerald" as const };
  // Nova temporada: E01 de qualquer season > 1
  if (isSeasonStart(group, dateStr))       return { label: "Nova temporada",      color: "cyan" as const };
  if (trendingWeek.has(tmdbId ?? -1))      return { label: "Trending",            color: "amber" as const };
  if ((group.relevanceScore ?? 0) >= 70)   return { label: "Hype alto",           color: "sky" as const };
  return { label: "Novo episódio", color: "slate" as const };
}

type EditorialGroup = {
  group: IcsSeriesGroup;
  /** Presente quando o item é um filme (não uma série) */
  movie?: MovieGroup;
  dateStr: string;
  score: number;
  visualWeight: "hero" | "wide" | "poster" | "compact";
};

// Score editorial para filmes — com fator de equalização para não dominar séries.
// Filmes têm popularidade estruturalmente maior; o cap (×0.72) nivela o campo.
function movieEditorialScore(
  movie: MovieGroup,
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
): number {
  const m = movie.movie;
  const tmdbId = m.tmdb_id;
  const releaseDate = m.release_date ?? todayStr();
  const days = daysUntilDate(releaseDate);

  // Boost temporal: filmes lançados hoje ou recentemente são mais relevantes
  const timeBoost = days <= 0 ? 20 : days <= 3 ? 14 : days <= 7 ? 8 : Math.max(0, 5 - Math.floor(days / 7));

  // Penalidade de imagem
  const hasBackdrop = !!(m.clean_backdrop_path ?? m.backdrop_path);
  const hasPoster   = !!m.poster_path;
  const imgPenalty  = hasBackdrop ? 0 : hasPoster ? -20 : -50;

  // Boost estreia (hoje)
  const isPremiereToday = days >= -3 && days <= 1;

  const rawScore =
    (movie.relevanceScore ?? 0) +
    normalizePopularity(m.popularity ?? 0) +   // log-normalizado
    (trendingDay.has(tmdbId)  ? 35 : 0) +
    (trendingWeek.has(tmdbId) ? 18 : 0) +
    (isPremiereToday          ? 28 : 0) +
    timeBoost +
    imgPenalty;

  // Fator de equalização: reduz score de filmes para que não dominem séries.
  // Cap: máximo ~40% dos itens do feed podem ser filmes — controlado pelo caller.
  return rawScore * 0.72;
}

function buildEditorialGroups(
  sourceGroups: IcsSeriesGroup[],
  sourceMovies: MovieGroup[],
  options: {
    mode: ViewMode;
    selectedDay: string;
    weekStart: Date;
    year: number;
    month: number;
    trendingDay: Set<number>;
    trendingWeek: Set<number>;
  },
): EditorialGroup[] {
  const today = todayStr();
  // "month" agora é um feed editorial contínuo de 30 dias a partir de hoje.
  // "day" e "week" mantêm a lógica de navegação por datas existente.
  const { start: windowStart, end: windowEnd } = activeWindow();
  const rangeStart =
    options.mode === "day" ? options.selectedDay :
    options.mode === "week" ? toLocalDateStr(options.weekStart) :
    /* month */ windowStart;
  const rangeEnd = (() => {
    if (options.mode === "day") return options.selectedDay;
    if (options.mode === "week") {
      const end = new Date(options.weekStart);
      end.setDate(end.getDate() + 6);
      return toLocalDateStr(end);
    }
    // month → 30-day rolling window
    return windowEnd;
  })();

  const seen = new Set<string>();
  const items: EditorialGroup[] = [];

  // ── Contadores de diversidade (decay editorial) ───────────────────────────
  // Usados para penalizar repetição de provider, idioma e gênero no feed final.
  const providerCount = new Map<string, number>();   // e.g. "Netflix" → 3
  const langCount     = new Map<string, number>();   // e.g. "ko" → 2
  const genreCount    = new Map<number, number>();   // e.g. 18 (drama) → 5
  // Hard cap: idiomas asiáticos (ko/ja/zh/th) — máx 2 itens no feed completo
  const ASIAN_LANGS   = new Set(["ko", "ja", "zh", "th", "hi", "tl"]);
  const asianLangCount = new Map<string, number>();

  // ── Séries ──────────────────────────────────────────────────────────────────
  for (const group of sourceGroups) {
    if (!hasValidTmdb(group)) continue;
    const ep = group.episodes
      .filter((item) => {
        const day = item.startAt.slice(0, 10);
        return day >= rangeStart && day <= rangeEnd;
      })
      .sort((a, b) => a.startAt.localeCompare(b.startAt))[0];
    if (!ep) continue;
    const key = `${group.key}-${ep.startAt.slice(0, 10)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const dateStr = ep.startAt.slice(0, 10);
    const score = groupEditorialScore(group, dateStr, options.trendingDay, options.trendingWeek);
    // ── Decay editorial por diversidade ──────────────────────────────────────
    const provider   = group.streamingProvider?.name ?? "_";
    const lang       = group.tmdb?.original_language ?? "_";
    const genres     = ((group.tmdb as unknown as Record<string,unknown>)?.genre_ids as number[]) ?? [];
    const pCount     = providerCount.get(provider) ?? 0;
    const lCount     = langCount.get(lang) ?? 0;
    const maxGCount  = genres.reduce((mx, g) => Math.max(mx, genreCount.get(g) ?? 0), 0);
    // Idiomas asiáticos: hard cap de 2 itens — excedente bloqueado completamente
    if (ASIAN_LANGS.has(lang)) {
      const aCount = asianLangCount.get(lang) ?? 0;
      if (aCount >= 2) continue;
      asianLangCount.set(lang, aCount + 1);
    }
    // Penalty de diversidade: provider (8pt×n, cap 32), idioma (10pt×n, cap 30), gênero (4pt×n, cap 16)
    const diversityPenalty = Math.min(pCount * 8, 32) + Math.min(lCount * 10, 30) + Math.min(maxGCount * 4, 16);
    providerCount.set(provider, pCount + 1);
    langCount.set(lang, lCount + 1);
    genres.forEach(g => genreCount.set(g, (genreCount.get(g) ?? 0) + 1));

    items.push({ group, dateStr, score: score - diversityPenalty, visualWeight: "compact" });
  }

  // ── Filmes — incluídos SOMENTE se a data de lançamento cair dentro do range ──
  // Um filme aparece na posição da sua data de estreia no Brasil (release_date).
  // Nunca aparece como "em cartaz recorrente" — apenas na semana/dia/mês em que estreou.
  // O pipeline backend (route.ts) já filtra filmes com release_date > 14 dias atrás,
  // então cabe ao frontend posicionar corretamente dentro do range visível.
  for (const movie of sourceMovies) {
    if (!movie.isRelevant) continue;
    const releaseDate = movie.movie.release_date ?? todayStr();
    // O filme só aparece se a data de estreia está dentro do range atual (dia/semana/mês)
    if (releaseDate < rangeStart || releaseDate > rangeEnd) continue;
    const key = movie.key;
    if (seen.has(key)) continue;
    seen.add(key);
    const score = movieEditorialScore(movie, options.trendingDay, options.trendingWeek);
    items.push({ group: {} as IcsSeriesGroup, movie, dateStr: releaseDate, score, visualWeight: "compact" });
  }

  items.sort((a, b) => b.score - a.score);

  // Cap de filmes: no máximo 1 filme a cada 3 itens (33%) para distribuição equilibrada.
  // Reordena para intercalar filmes entre séries em vez de empilhá-los.
  const series = items.filter(i => !i.movie);
  const movies  = items.filter(i =>  i.movie);
  const movieCap = Math.ceil(series.length / 2.5); // máx ~40% do total
  const cappedMovies = movies.slice(0, movieCap);

  // Intercala: a cada 3 séries, insere 1 filme (pelo score mais alto disponível)
  const merged: EditorialGroup[] = [];
  let mi = 0;
  for (let si = 0; si < series.length; si++) {
    merged.push(series[si]);
    // Insere filme após a 3ª, 6ª, 9ª... série SE o filme tiver score razoável
    if ((si + 1) % 3 === 0 && mi < cappedMovies.length) {
      merged.push(cappedMovies[mi++]);
    }
  }
  // Filmes restantes vão ao final (mas limitados)
  while (mi < cappedMovies.length) merged.push(cappedMovies[mi++]);

  // Distribui pesos visuais: últimos 25% viram compact
  const len = merged.length;
  return merged.map((item, index) => {
    if (index >= len - Math.max(3, Math.floor(len * 0.25))) return { ...item, visualWeight: "compact" as const };
    return { ...item, visualWeight: "poster" as const };
  });
}

// ── Agrupamento por dia para o calendário ──────────────────────────────────────

function buildDayMap(groups: IcsSeriesGroup[]): Map<string, IcsSeriesGroup[]> {
  const map = new Map<string, IcsSeriesGroup[]>();
  for (const g of groups) {
    if (!hasValidTmdb(g)) continue;
    for (const ep of g.episodes) {
      const day = ep.startAt.slice(0, 10);
      const arr = map.get(day) ?? [];
      if (!arr.find((x) => x.key === g.key)) arr.push(g);
      map.set(day, arr);
    }
  }
  return map;
}

// ── Categoria label ────────────────────────────────────────────────────────────

const CAT_LABEL: Partial<Record<ContentCategory, string>> = {
  MOVIE:           "Filme",
  // CINEMATIC: label dinâmico via resolveCinematicLabel()
  SERIES:          "Série",  ANIMATION: "Animação",
  DOCUMENTARY:     "Doc", REALITY_PREMIUM: "Reality", REALITY: "Reality",
  DAILY_SOAP:      "Soap", VARIETY: "Variedade", KIDS: "Kids",
};

const CAT_COLOR: Partial<Record<ContentCategory, string>> = {
  MOVIE:           "bg-rose-500/20 text-rose-300/80 border-rose-500/20",
  // CINEMATIC: cor dinâmica via resolveCinematicLabel()
  SERIES:          "bg-sky-500/20 text-sky-300/80 border-sky-500/20",
  ANIMATION:       "bg-teal-500/20 text-teal-300/80 border-teal-500/20",
  DOCUMENTARY:     "bg-cyan-500/20 text-cyan-300/80 border-cyan-500/20",
  REALITY_PREMIUM: "bg-amber-500/20 text-amber-300/80 border-amber-500/20",
  REALITY:         "bg-orange-500/15 text-orange-300/60 border-orange-500/15",
  DAILY_SOAP:      "bg-white/[0.04] text-white/25 border-white/[0.07]",
  VARIETY:         "bg-white/[0.04] text-white/25 border-white/[0.07]",
};

/** Grupos CINEMATIC com score >= 70 E rede/produtora de prestígio são "Prestige". */
function isCinematicPrestige(group: IcsSeriesGroup): boolean {
  if ((group.relevanceScore ?? 0) < 70) return false;
  const networks = group.tmdb?.networks ?? [];
  const companies = group.tmdb?.production_companies ?? [];
  // Redes/produtoras consideradas prestige (HBO, A24, Apple TV+, Netflix, Amazon, etc.)
  const prestigeNetworkIds = new Set([49, 2552, 213, 1024, 453, 2739, 3353, 6, 67, 41077, 3268]);
  return (
    networks.some((n) => prestigeNetworkIds.has(n.id)) ||
    companies.some((c) => prestigeNetworkIds.has(c.id))
  );
}

/** Retorna label de fallback para CINEMATIC: usa gênero quando disponível. */
function cinematicFallbackLabel(group: IcsSeriesGroup): string {
  const genres = group.tmdb?.genres ?? [];
  if (genres.some((g) => /crime|mistério|thriller/i.test(g))) return "Crime / Mistério";
  if (genres.some((g) => /drama/i.test(g)))                   return "Drama";
  if (genres.some((g) => /ficção|sci.fi|fantasy/i.test(g)))   return "Ficção";
  return "Cinematic";
}

/** Resolve label e cor para grupos CINEMATIC com dois tiers:
 *  - Prestige (violeta): score alto + rede/produtora reconhecida
 *  - Crime/Mistério (azul serie): todo o resto
 */
function resolveCinematicLabel(group: IcsSeriesGroup): { label: string; color: string } {
  if (isCinematicPrestige(group)) {
    return { label: "Prestige", color: "bg-violet-500/20 text-violet-300/80 border-violet-500/20" };
  }
  return { label: cinematicFallbackLabel(group), color: "bg-sky-500/20 text-sky-300/80 border-sky-500/10" };
}

/** Retorna label e cor de categoria para qualquer grupo. */
function resolveCatLabel(group: IcsSeriesGroup): { label: string; color: string } {
  if (group.category === "CINEMATIC") return resolveCinematicLabel(group);
  const label = CAT_LABEL[group.category] ?? group.category;
  const color = CAT_COLOR[group.category] ?? "bg-white/[0.05] text-white/30 border-white/[0.08]";
  return { label, color };
}

// ── Componentes visuais ────────────────────────────────────────────────────────

function SectionEyebrow({ children, color = "sky" }: {
  children: React.ReactNode;
  color?: "sky" | "rose" | "cyan" | "violet" | "teal" | "amber";
}) {
  const colors = {
    sky:    "bg-sky-400/60 text-sky-400/80",
    rose:   "bg-rose-400/60 text-rose-400/80",
    cyan:   "bg-cyan-400/60 text-cyan-400/80",
    violet: "bg-violet-400/60 text-violet-400/80",
    teal:   "bg-teal-400/60 text-teal-400/80",
    amber:  "bg-amber-400/60 text-amber-400/80",
  };
  const [bg, text] = colors[color].split(" ");
  return (
    <div className="flex items-center gap-2 mb-1.5">
      <span className={`block h-px w-5 rounded-full ${bg}`} />
      <p className={`text-[9.5px] font-bold uppercase tracking-[0.22em] ${text}`}>{children}</p>
    </div>
  );
}

function SectionDivider() {
  return <div className="h-px w-full bg-gradient-to-r from-transparent via-white/[0.06] to-transparent my-10" />;
}

// ── Phase indicator ────────────────────────────────────────────────────────────

function PhaseBar({ phase, enrichProgress }: { phase: Phase; enrichProgress: number }) {
  if (phase === "done") return null;
  return (
    <div className="flex items-center gap-3 mb-6 px-4 py-3 rounded-[22px] border border-white/[0.08] bg-white/[0.035] backdrop-blur-xl">
      <span className="w-1.5 h-1.5 rounded-full bg-sky-400/80 animate-pulse shrink-0" />
      <span className="text-[11px] font-bold text-white/40">{PHASE_LABELS[phase]}</span>
      {phase === "enriching" && enrichProgress > 0 && (
        <>
          <div className="flex-1 h-px bg-white/[0.06] rounded-full overflow-hidden">
            <div
              className="h-full bg-sky-500/50 rounded-full transition-all duration-500"
              style={{ width: `${Math.min(100, enrichProgress)}%` }}
            />
          </div>
          <span className="text-[9px] font-bold text-white/20">{Math.round(enrichProgress)}%</span>
        </>
      )}
    </div>
  );
}

// ── Série card ─────────────────────────────────────────────────────────────────

function SeriesCard({
  group, href, compact = false,
}: {
  group: IcsSeriesGroup;
  href: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const tmdb = group.tmdb;
  // Language-aware: JP/KR/CN series get backdrop instead of logo-heavy poster
  const poster   = tmdb ? bestVerticalImg({ ...tmdb, poster_path: tmdb.poster_path ?? null, backdrop_path: tmdb.backdrop_path ?? null }) : null;
  const backdrop = tmdb ? TMDB_IMG(tmdb.backdrop_path, "w780") : null;
  const name     = tmdb?.name ?? group.rawTitle;
  const { label: catLabel, color: catColor } = resolveCatLabel(group);

  const nextDate = new Date(group.nextAirDate);
  const daysUntil = Math.ceil((nextDate.getTime() - Date.now()) / 86_400_000);
  const dateLabel =
    daysUntil <= 0 ? "Hoje" :
    daysUntil === 1 ? "Amanhã" :
    daysUntil <= 7 ? `Em ${daysUntil} dias` :
    nextDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const dateFull = nextDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });

  const urgencyColor =
    daysUntil <= 0  ? "text-rose-400" :
    daysUntil <= 1  ? "text-amber-400" :
    daysUntil <= 7  ? "text-sky-400" :
    "text-white/30";

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    router.push(href);
  };

  if (compact) {
    return (
      <a
        href={href}
        onClick={handleClick}
        className="group relative w-full text-left rounded-2xl border border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.075] hover:border-white/[0.18] hover:-translate-y-0.5 transition-all duration-300 overflow-hidden p-3.5 block"
      >
        {backdrop && (
          <div className="absolute inset-0 opacity-[0.07]">
            <img src={backdrop} alt="" className="h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/80 to-transparent" />
          </div>
        )}
        <div className="relative flex items-center gap-3.5">
          <div className="relative w-[46px] h-[68px] rounded-2xl overflow-hidden bg-white/[0.05] shrink-0 border border-white/[0.08]">
            {poster ? (
              <img src={poster} alt={name} className="h-full w-full object-cover" loading="lazy" />
            ) : (
              <div className="h-full w-full flex items-center justify-center">
                <span className="text-[9px] font-black text-white/15 text-center leading-tight px-1">
                  {name.slice(0, 3).toUpperCase()}
                </span>
              </div>
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 mb-1.5">
              <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${catColor}`}>
                {catLabel}
              </span>
            </div>
            <p className="text-[14px] font-black tracking-[-0.02em] text-white/88 leading-tight truncate">
              {name}
            </p>
            <p className="text-[11px] text-white/35 mt-1">
              {group.episodeCount} ep · S{group.seasons[0] ?? 1}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className={`text-[12px] font-black tabular-nums ${urgencyColor}`}>{dateLabel}</p>
            <p className="text-[9px] text-white/20 tabular-nums mt-0.5">{dateFull}</p>
          </div>
        </div>
      </a>
    );
  }

  // Card grande (carrossel) — poster is already language-aware via bestVerticalImg
  const cardImg = poster ?? backdrop;
  return (
    <a
      href={href}
      onClick={handleClick}
      className="group relative w-[160px] sm:w-[176px] text-left shrink-0 block"
    >
      <div className="relative aspect-[2/3] rounded-2xl overflow-hidden border border-white/[0.08] mb-3 bg-white/[0.04]">
        {cardImg ? (
          <img
            src={cardImg} alt={name}
            className="h-full w-full object-cover object-center transition-transform duration-500 group-hover:scale-[1.05]"
            loading="lazy"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-3 p-4">
            <div className="w-10 h-10 rounded-2xl border border-white/[0.08] bg-white/[0.04] flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-white/20">
                <rect x="2" y="3" width="20" height="14" rx="2" />
                <path d="M8 21h8M12 17v4" />
              </svg>
            </div>
            <p className="text-[11px] font-bold text-white/25 text-center leading-tight line-clamp-3">{name}</p>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
        <div className="absolute top-2.5 left-2.5 flex flex-col gap-1">
          <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${catColor}`}>
            {catLabel}
          </span>
          {group.streamingProvider && (
            <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border bg-emerald-500/15 text-emerald-300/80 border-emerald-500/20 self-start">
              {group.streamingProvider.name}
            </span>
          )}
        </div>
        {tmdb?.vote_average && tmdb.vote_average > 0 && (
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1 bg-black/40 rounded-lg px-1.5 py-0.5">
            <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
            </svg>
            <span className="text-[10px] font-bold text-amber-300">{tmdb.vote_average.toFixed(1)}</span>
          </div>
        )}
        <div className="absolute bottom-2.5 left-2.5 right-2.5">
          <p className={`text-[10px] font-black ${urgencyColor}`}>{dateLabel}</p>
          <p className="text-[9px] text-white/30 tabular-nums mt-0.5">{dateFull}</p>
        </div>
      </div>
      <div className="px-0.5">
        <p className="text-[13px] font-bold text-white/88 leading-tight tracking-[-0.02em] line-clamp-2 mb-1">{name}</p>
        <p className="text-[11px] text-white/35">
          {group.episodeCount} ep{group.episodeCount !== 1 ? "s" : ""} · S{group.seasons[0] ?? 1}
        </p>
      </div>
    </a>
  );
}


// ── ScrollRail ─────────────────────────────────────────────────────────────────

function ScrollRail({ children }: { children: React.ReactNode }) {
  const railRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft]   = useState(false);
  const [canRight, setCanRight] = useState(false);

  const sync = useCallback(() => {
    const el = railRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 4);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    sync();
    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    return () => { el.removeEventListener("scroll", sync); ro.disconnect(); };
  }, [sync]);

  const nudge = (dir: 1 | -1) => {
    const el = railRef.current;
    if (el) el.scrollBy({ left: dir * Math.round(el.clientWidth * 0.65), behavior: "smooth" });
  };

  return (
    <div className="relative group/rail -mx-4 sm:-mx-6 md:-mx-8 lg:mx-0">
      <div className="absolute left-0 top-0 bottom-3 w-14 pointer-events-none z-10 transition-opacity duration-200"
        style={{ opacity: canLeft ? 1 : 0, background: "linear-gradient(to right, #020617 25%, transparent)" }} />
      {canLeft && (
        <button type="button" onClick={() => nudge(-1)} aria-label="Anterior"
          className="absolute left-2 top-1/2 -translate-y-[calc(50%+6px)] z-20 w-8 h-8 rounded-full border border-white/[0.12] bg-zinc-900/95 flex items-center justify-center text-white/60 hover:text-white hover:bg-zinc-800 transition-all duration-200 opacity-0 group-hover/rail:opacity-100 shadow-lg">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
      <div ref={railRef} className="flex gap-3.5 overflow-x-auto px-4 sm:px-6 md:px-8 lg:px-0 pb-3 no-scrollbar [&>*]:shrink-0">
        {children}
      </div>
      <div className="absolute right-0 top-0 bottom-3 w-14 pointer-events-none z-10 transition-opacity duration-200"
        style={{ opacity: canRight ? 1 : 0, background: "linear-gradient(to left, #020617 25%, transparent)" }} />
      {canRight && (
        <button type="button" onClick={() => nudge(1)} aria-label="Próximo"
          className="absolute right-2 top-1/2 -translate-y-[calc(50%+6px)] z-20 w-8 h-8 rounded-full border border-white/[0.12] bg-zinc-900/95 flex items-center justify-center text-white/60 hover:text-white hover:bg-zinc-800 transition-all duration-200 opacity-0 group-hover/rail:opacity-100 shadow-lg">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5">
            <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

// ── Spotlight Hero ─────────────────────────────────────────────────────────────
// Seção que substitui o "Estreando hoje / Na agenda hoje" com um slide hero
// auto-rotativo mostrando destaques do dia + semana, priorizando estreias/finais/trending.

interface SpotlightItem {
  group: IcsSeriesGroup;
  dateStr: string;   // dia do episódio em destaque
  isPremiere: boolean;
  isFinale: boolean;
  isTrendingDay: boolean;
  isTrendingWeek: boolean;
  label: string;     // "Hoje", "Amanhã", "5 de jun." etc.
}

function buildSpotlightItems(
  featuredGroups: IcsSeriesGroup[],
  trendingDay: Set<number>,
  trendingWeek: Set<number>,
): SpotlightItem[] {
  const today = todayStr();
  const nextWeek = new Date(); nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = toLocalDateStr(nextWeek);

  const items: SpotlightItem[] = [];
  const seen = new Set<string>();

  for (const g of featuredGroups) {
    if (!hasValidTmdb(g)) continue;
    if (seen.has(g.key)) continue;

    // Encontra o episódio mais próximo nos próximos 7 dias
    const upcomingEp = g.episodes.find(
      (ep) => ep.startAt.slice(0, 10) >= today && ep.startAt.slice(0, 10) <= nextWeekStr,
    );
    if (!upcomingEp) continue;

    const dateStr = upcomingEp.startAt.slice(0, 10);
    const daysUntil = Math.ceil(
      (new Date(dateStr + "T12:00:00").getTime() - Date.now()) / 86_400_000,
    );
    const label =
      daysUntil <= 0 ? "Hoje" :
      daysUntil === 1 ? "Amanhã" :
      new Date(dateStr + "T12:00:00").toLocaleDateString("pt-BR", { day: "numeric", month: "short" });

    const tmdbId = g.tmdb?.tmdb_id;
    const isTrendingDay  = tmdbId != null ? trendingDay.has(tmdbId)  : false;
    const isTrendingWeek = tmdbId != null ? trendingWeek.has(tmdbId) : false;

    // Detecta estreias (S01E01 ou E01) e finais (último ep da temporada)
    const seasonEps = g.episodes.filter((ep) => ep.season === upcomingEp.season);
    const isPremiere = upcomingEp.episode === 1;
    const maxEp = Math.max(...seasonEps.map((e) => e.episode));
    const isFinale = upcomingEp.episode === maxEp && maxEp > 1;

    items.push({ group: g, dateStr, isPremiere, isFinale, isTrendingDay, isTrendingWeek, label });
    seen.add(g.key);
  }

  // Ordena: trending_day > premiere > finale > trending_week > score > popularidade
  items.sort((a, b) => {
    const scoreA =
      (a.isTrendingDay  ? 100 : 0) +
      (a.isPremiere     ? 50  : 0) +
      (a.isFinale       ? 40  : 0) +
      (a.isTrendingWeek ? 30  : 0) +
      (a.group.relevanceScore ?? 0);
    const scoreB =
      (b.isTrendingDay  ? 100 : 0) +
      (b.isPremiere     ? 50  : 0) +
      (b.isFinale       ? 40  : 0) +
      (b.isTrendingWeek ? 30  : 0) +
      (b.group.relevanceScore ?? 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    return (b.group.tmdb?.popularity ?? 0) - (a.group.tmdb?.popularity ?? 0);
  });

  // ── Filtro de diversidade no spotlight ──────────────────────────────────────
  // Idiomas asiáticos: máx 1 item por idioma no hero (ko, ja, zh, th, hi, tl)
  // Garante que o carrossel seja dominantemente ocidental/BR.
  const ASIAN_SPOTLIGHT = new Set(["ko", "ja", "zh", "th", "hi", "tl"]);
  const asianSpotCount  = new Map<string, number>();
  const filtered: SpotlightItem[] = [];
  for (const item of items) {
    const lang = item.group.tmdb?.original_language ?? "";
    if (ASIAN_SPOTLIGHT.has(lang)) {
      const c = asianSpotCount.get(lang) ?? 0;
      if (c >= 1) continue;                     // bloqueia 2º+ item do mesmo idioma asiático
      asianSpotCount.set(lang, c + 1);
    }
    filtered.push(item);
    if (filtered.length >= 20) break;
  }

  // Máx 20 itens no spotlight
  return filtered;
}


// ── Vista Mensal ───────────────────────────────────────────────────────────────

// ── RadarHero — painel unificado: identidade + métricas + tabs + hero cinematográfico ──
// Substitui AgendaHero (separado) + SpotlightHero (separado) por um único bloco premium.

// ── Editorial feed ────────────────────────────────────────────────────────────

const SIGNAL_STYLES = {
  rose:    "border-rose-400/25 bg-rose-500/15 text-rose-200",
  violet:  "border-violet-400/25 bg-violet-500/15 text-violet-200",
  emerald: "border-emerald-400/25 bg-emerald-500/15 text-emerald-200",
  cyan:    "border-cyan-400/25 bg-cyan-500/15 text-cyan-200",
  amber:   "border-amber-400/25 bg-amber-500/15 text-amber-200",
  sky:     "border-sky-400/25 bg-sky-500/15 text-sky-200",
  slate:   "border-white/[0.08] bg-white/[0.05] text-white/50",
};

function SignalBadge({
  label,
  color,
}: {
  label: string;
  color: keyof typeof SIGNAL_STYLES;
}) {
  return (
    <span className={`inline-flex items-center rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${SIGNAL_STYLES[color]}`}>
      {label}
    </span>
  );
}

// ── Normalização de item (série ou filme) para uso nos cards ──────────────────
// Abstrai as diferenças entre IcsSeriesGroup e MovieGroup para os card components.

interface NormalizedItem {
  tmdbId: number;
  name: string;
  overview: string | null;
  backdrop: string | null;
  poster: string | null;
  voteAvg: number;
  category: ContentCategory;
  href: string;
  /** Para séries: label de episódio (S2E4). Para filmes: runtime ou gênero. */
  subLabel: string;
  /** Data label: "Hoje", "Amanhã", "Em 3 dias", etc. */
  dateLabel: string;
  days: number;
  isMovie: boolean;
}

function resolveItemData(item: EditorialGroup): NormalizedItem {
  const { movie, group, dateStr } = item;

  if (movie) {
    const m = movie.movie;
    const days = daysUntilDate(m.release_date ?? dateStr);
    const dateLabel = days < -7 ? "Nos cinemas" : days < 0 ? `Estreou há ${Math.abs(days)} dias` : days === 0 ? "Estreia hoje" : days === 1 ? "Amanhã" : `Em ${days} dias`;
    const backdrop = m.clean_backdrop_path != null
      ? TMDB_IMG(m.clean_backdrop_path, "w1280")
      : TMDB_IMG(m.backdrop_path ?? null, "w1280");
    const subLabel = (m.genres ?? []).slice(0, 2).join(" · ") || "Cinema";
    return {
      tmdbId:    m.tmdb_id,
      name:      m.name ?? "",
      overview:  m.overview ?? null,
      backdrop,
      poster:    TMDB_IMG(m.poster_path ?? null, "w342"),
      voteAvg:   m.vote_average ?? 0,
      category:  "MOVIE",
      href:      `/title/movie/${m.tmdb_id}`,
      subLabel,
      dateLabel,
      days,
      isMovie:   true,
    };
  }

  // Série
  const tmdb = group.tmdb!;
  const days = daysUntilDate(dateStr);
  const dateLabel = days <= 0 ? "Hoje" : days === 1 ? "Amanhã" : days <= 7 ? `Em ${days} dias` : `Em ${days} dias`;
  const eps = episodesOnDay(group, dateStr);
  const firstEp = eps[0];
  const subLabel = firstEp
    ? `S${firstEp.season}E${firstEp.episode}${firstEp.episodeName && firstEp.episodeName.toLowerCase() !== "tba" ? ` · ${firstEp.episodeName}` : ""}`
    : "";
  const backdrop = bestHorizontalImg(tmdb, "w1280");
  return {
    tmdbId:    tmdb.tmdb_id,
    name:      tmdb.name,
    overview:  tmdb.overview ?? null,
    backdrop,
    // Language-aware: non-latin series get backdrop to avoid logo-heavy posters
    poster:    bestVerticalImg(tmdb),
    voteAvg:   tmdb.vote_average ?? 0,
    category:  group.category,
    href:      `/title/tv/${tmdb.tmdb_id}`,
    subLabel,
    dateLabel,
    days,
    isMovie:   false,
  };
}

function AgendaEditorialHeroCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);
  const { label: catLabel, color: catColor } = d.isMovie
    ? { label: CAT_LABEL[d.category] ?? d.category, color: CAT_COLOR[d.category] ?? "bg-white/[0.05] text-white/30 border-white/[0.08]" }
    : resolveCatLabel(item.group);
  // Série: info de episódio; Filme: gênero
  const firstEp = !item.movie ? (episodesOnDay(item.group, item.dateStr)[0] ?? null) : null;
  const showTime = firstEp && !firstEp.startAt.endsWith("T00:00:00.000Z");

  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[26px] border border-white/[0.08] bg-zinc-950/80 text-left shadow-[0_18px_44px_rgba(0,0,0,0.34)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.16] block"
    >
      {d.backdrop && (
        <img src={d.backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.72] transition-transform duration-700 group-hover:scale-[1.03]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/80 via-zinc-950/38 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/70 via-transparent to-transparent" />

      <div className="relative flex h-full flex-col justify-between p-5 sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <SignalBadge label={signal.label} color={signal.color} />
            <span className={`rounded-lg border px-2 py-1 text-[9px] font-black uppercase ${catColor}`}>{catLabel}</span>
            {!item.movie && item.group.streamingProvider && (
              <span className="rounded-lg border border-emerald-500/20 bg-emerald-500/15 px-2 py-1 text-[9px] font-black uppercase text-emerald-300/80">
                {item.group.streamingProvider.name}
              </span>
            )}
            <span className="rounded-lg border border-white/[0.08] bg-black/20 px-2 py-1 text-[9px] font-black uppercase text-white/45">
              {d.dateLabel}
            </span>
          </div>
          {d.voteAvg > 0 && (
            <span className="rounded-lg border border-amber-400/20 bg-amber-500/10 px-2 py-1 text-[11px] font-black text-amber-200">
              ★ {d.voteAvg.toFixed(1)}
            </span>
          )}
        </div>

        <div className="flex items-end gap-5">
          {d.poster && (
            <div className="hidden w-[104px] overflow-hidden rounded-2xl border border-white/[0.10] bg-white/[0.04] shadow-[0_14px_32px_rgba(0,0,0,0.30)] sm:block">
              <img src={d.poster} alt={d.name} className="aspect-[2/3] w-full object-cover" />
            </div>
          )}
          <div className="min-w-0 max-w-[650px]">
            <p className="mb-2 text-[11px] font-black uppercase tracking-[0.08em] text-emerald-300/90">
              {d.subLabel}{showTime && firstEp ? ` · ${formatTime(firstEp.startAt)}` : ""}
            </p>
            <h2 className="mb-3 text-3xl font-black leading-none tracking-[-0.04em] text-white sm:text-5xl">
              {d.name}
            </h2>
            {d.overview && (
              <p className="line-clamp-3 max-w-2xl text-[13px] leading-relaxed text-white/62">{d.overview}</p>
            )}
          </div>
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialWideCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);

  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.30)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block"
    >
      {d.backdrop && (
        <img src={d.backdrop} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.65] transition-transform duration-700 group-hover:scale-[1.04]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/72 via-zinc-950/30 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/60 via-transparent to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-5">
        <div className="flex items-center justify-between gap-3">
          <SignalBadge label={signal.label} color={signal.color} />
          <span className="text-[10px] font-bold uppercase text-white/38">{d.dateLabel}</span>
        </div>
        <div className="max-w-[560px]">
          <p className="mb-2 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-300/80">
            {d.subLabel || (d.isMovie ? "Cinema" : "Novo evento")}
          </p>
          <h3 className="line-clamp-2 text-2xl font-black leading-tight tracking-[-0.035em] text-white">{d.name}</h3>
          {d.overview && (
            <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-white/52">
              {d.overview}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialPosterCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  // Poster: vertical — usa poster se disponível
  const bgImg = d.poster ?? d.backdrop;
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);

  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.30)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block"
    >
      {bgImg && (
        <img src={bgImg} alt="" className="absolute inset-0 h-full w-full object-cover object-top opacity-[0.75] transition-transform duration-700 group-hover:scale-[1.04]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/72 via-zinc-950/20 to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-2">
          <SignalBadge label={signal.label} color={signal.color} />
          {d.voteAvg > 0 && (
            <span className="rounded-lg border border-amber-400/15 bg-black/20 px-1.5 py-1 text-[10px] font-black text-amber-200/90">
              ★ {d.voteAvg.toFixed(1)}
            </span>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-emerald-300/80">
            {d.dateLabel}{d.subLabel ? ` · ${d.subLabel}` : ""}
          </p>
          <h3 className="line-clamp-2 text-[19px] font-black leading-tight tracking-[-0.035em] text-white">{d.name}</h3>
          {d.overview && (
            <p className="mt-2 line-clamp-2 text-[11px] leading-relaxed text-white/50">
              {d.overview}
            </p>
          )}
        </div>
      </div>
    </a>
  );
}

function AgendaEditorialSquareCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  // Square: backdrop horizontal preferido; fallback para poster
  const bgImg = d.backdrop ?? d.poster;
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);

  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-1 hover:border-white/[0.15] block"
    >
      {bgImg && (
        <img src={bgImg} alt="" className="absolute inset-0 h-full w-full object-cover opacity-[0.60] transition-transform duration-700 group-hover:scale-[1.05]" />
      )}
      <div className="absolute inset-0 bg-gradient-to-br from-zinc-950/50 via-transparent to-zinc-950/80" />
      <div className="absolute inset-0 bg-gradient-to-t from-zinc-950/65 via-transparent to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-4">
        <div className="flex items-center justify-between gap-2">
          <SignalBadge label={signal.label} color={signal.color} />
          {d.voteAvg > 0 && (
            <span className="rounded-lg border border-amber-400/15 bg-black/25 px-1.5 py-1 text-[10px] font-black text-amber-200/90">
              ★ {d.voteAvg.toFixed(1)}
            </span>
          )}
        </div>
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-[0.09em] text-emerald-300/80">
            {d.dateLabel}{d.subLabel ? ` · ${d.subLabel}` : ""}
          </p>
          <h3 className="line-clamp-2 text-[16px] font-black leading-tight tracking-[-0.03em] text-white drop-shadow-[0_1px_3px_rgba(0,0,0,0.7)]">
            {d.name}
          </h3>
        </div>
      </div>
    </a>
  );
}

// ── Tall card (poster 2:3 alto — só para o item #1 de muito hype) ─────────────
function AgendaEditorialTallCard({
  item,
  trendingDay,
  trendingWeek,
}: {
  item: EditorialGroup;
  trendingDay: Set<number>;
  trendingWeek: Set<number>;
}) {
  const d = resolveItemData(item);
  // Tall: vertical — poster preferido, fallback backdrop
  const poster = d.poster ?? d.backdrop;
  const signal = editorialSignal(item.group, item.dateStr, trendingDay, trendingWeek, item.movie);

  return (
    <a
      href={d.href}
      className="group relative w-full h-full overflow-hidden rounded-[24px] border border-white/[0.08] bg-zinc-950/75 text-left shadow-[0_14px_34px_rgba(0,0,0,0.28)] backdrop-blur-xl transition-all duration-300 hover:-translate-y-0.5 hover:border-white/[0.16] block"
    >
      {poster ? (
        <img src={poster} alt="" className="absolute inset-0 h-full w-full object-cover opacity-90 transition-transform duration-700 group-hover:scale-[1.04]" />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-b from-zinc-800 to-zinc-950" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
      <div className="relative flex h-full flex-col justify-between p-3.5">
        <div className="flex items-center justify-between gap-2">
          <SignalBadge label={signal.label} color={signal.color} />
          {d.voteAvg > 0 && (
            <span className="rounded-lg border border-amber-400/15 bg-black/30 px-1.5 py-1 text-[10px] font-black text-amber-200/90">
              ★ {d.voteAvg.toFixed(1)}
            </span>
          )}
        </div>
        <div>
          <p className="mb-1 text-[9px] font-black uppercase tracking-[0.10em] text-emerald-300/85">
            {d.dateLabel}{d.subLabel ? ` · ${d.subLabel}` : ""}
          </p>
          <h3 className="line-clamp-2 text-[17px] font-black leading-tight tracking-[-0.03em] text-white drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]">
            {d.name}
          </h3>
        </div>
      </div>
    </a>
  );
}

function AgendaCompactCluster({ items }: { items: EditorialGroup[] }) {
  if (items.length === 0) return null;

  return (
    <div className="col-span-1 rounded-[24px] border border-white/[0.08] bg-zinc-900/80 shadow-[0_18px_50px_rgba(0,0,0,0.40)] backdrop-blur-xl p-4 sm:col-span-2 lg:col-span-4">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[9px] font-black uppercase text-white/30">Agenda compactada</p>
          <h3 className="text-[18px] font-black text-white">Também relevantes</h3>
        </div>
        <span className="rounded-full border border-white/[0.08] px-2.5 py-1 text-[11px] font-black text-white/30">
          {items.length}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {items.slice(0, 12).map((editorialItem) => {
          const d = resolveItemData(editorialItem);
          return (
            <a
              key={`${editorialItem.movie ? `movie-${d.tmdbId}` : editorialItem.group.key}-${editorialItem.dateStr}`}
              href={d.href}
              className="flex min-w-0 items-center gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.035] p-2.5 text-left transition-colors hover:border-white/[0.10] hover:bg-white/[0.05]"
            >
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded-lg bg-white/[0.05]">
                {(d.backdrop ?? d.poster) && <img src={(d.backdrop ?? d.poster)!} alt="" className="h-full w-full object-cover object-center" loading="lazy" />}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-black text-white/85">{d.name}</p>
                <p className="mt-1 text-[10px] font-bold text-white/35">
                  {d.dateLabel}{d.subLabel ? ` · ${d.subLabel}` : ""}
                  {!editorialItem.movie && editorialItem.group.streamingProvider && (
                    <span className="ml-1.5 text-emerald-400/70">· {editorialItem.group.streamingProvider.name}</span>
                  )}
                </p>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

// ── Sistema de linhas sem buracos ─────────────────────────────────────────────
//
// Cada "linha" define um layout de 4 colunas e consome exatamente N itens.
// O grid CSS único garante que cada célula estique para preencher a linha — sem gaps.
//
// Layouts disponíveis (sempre somam 4 cols):
//   "2+1+1"  → wide(2) | poster(1) | poster(1)          consome 3
//   "1+1+2"  → poster(1) | poster(1) | wide(2)          consome 3
//   "2+2"    → wide(2) | wide(2)                         consome 2
//   "1+2+1"  → poster(1) | wide(2) | poster(1)          consome 3
//   "4"      → poster(1)|poster(1)|poster(1)|poster(1)  consome 4
//   "3+1"    → wide(3) | poster(1)                      consome 2  (lg only)
//   "1+3"    → poster(1) | wide(3)                      consome 2  (lg only)
//   "tall+3" → tall(1 col, 2 rows) + 3 posters em 3 cols (só para #1 de hype muito alto)
//
// O ciclo de layouts cria dinamismo sem deixar espaços.

// ── Sistema de layouts score-driven — variedade máxima ───────────────────────
//
// 16 layouts diferentes, todos somam exatamente 12 cols em sm+.
// Formato de span: "col-span-MOBILE sm:col-span-DESKTOP"
//
// Formatos de card:
//   "hero"    → banner horizontal largo (widescreen), usa backdrop prioritariamente
//   "wide"    → banner horizontal médio, backdrop ou poster
//   "poster"  → retângulo vertical 2:3, usa poster prioritariamente
//   "square"  → quadrado 1:1, backdrop ou poster
//   "tall"    → poster gigante vertical (só para #1 hype extremo)
//
// Regra: soma dos sm:col-span = 12 por linha. Mobile sempre col-span-12 ou col-span-6.

// ── Templates fixos de layout por view ───────────────────────────────────────
//
// Cada view é uma sequência de "linhas" que se repetem.
// Cada linha some exatamente 12 colunas — garantia matemática de zero buracos.
// Dentro de cada linha, cada slot tem: tipo de card + col-span desktop + col-span mobile.
// Mobile: todos os slots ficam full (12) ou metade (6), nunca menos.
//
// Tipos de card:
//   hero   → banner widescreen, usa backdrop, conteúdo no lado esquerdo
//   wide   → banner horizontal compacto
//   square → quadrado 1:1
//   poster → retângulo 2:3 vertical

type CardType = "hero" | "wide" | "square" | "poster" | "tall";

interface SlotDef {
  cardType: CardType;
  colSm: number;  // colunas desktop (soma 12 por linha)
  colXs: number;  // colunas mobile (6 ou 12)
}

type RowDef = SlotDef[];  // soma de colSm deve ser 12

// Altura fixa por linha — hero/wide ficam mais altos
const ROW_H: Record<string, string> = {
  hero:   "h-[320px]",
  wide:   "h-[240px]",
  square: "h-[220px]",
  poster: "h-[260px]",
  tall:   "h-[320px]",
};

// ── Template Dia/Hoje ─────────────────────────────────────────────────────────
const ROWS_DAY: RowDef[] = [
  // L1: hero grande + poster
  [{ cardType:"hero",   colSm:8, colXs:12 }, { cardType:"poster", colSm:4, colXs:6 }],  // não vai embaixo do hero no mobile pois hero é full
  // L2: square + square + square
  [{ cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }],
  // L3: poster + wide
  [{ cardType:"poster", colSm:4, colXs:6 }, { cardType:"wide",   colSm:8, colXs:12 }],
  // L4: poster + poster + poster + poster
  [{ cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  // L5: wide + square + square
  [{ cardType:"wide",   colSm:6, colXs:12 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }],
];

// ── Template Semana ───────────────────────────────────────────────────────────
const ROWS_WEEK: RowDef[] = [
  // L1: hero + poster + poster
  [{ cardType:"hero",   colSm:6, colXs:12 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  // L2: square + square + square + square
  [{ cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }],
  // L3: wide + poster
  [{ cardType:"wide",   colSm:8, colXs:12 }, { cardType:"poster", colSm:4, colXs:6 }],
  // L4: poster + wide + poster
  [{ cardType:"poster", colSm:3, colXs:6 }, { cardType:"wide",   colSm:6, colXs:12 }, { cardType:"poster", colSm:3, colXs:6 }],
  // L5: square + square + wide
  [{ cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }, { cardType:"wide",   colSm:4, colXs:12 }],
  // L6: poster × 4
  [{ cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
];

// ── Template Mês / 30 dias ────────────────────────────────────────────────────
const ROWS_MONTH: RowDef[] = [
  // L1: wide + poster + poster
  [{ cardType:"wide",   colSm:6, colXs:12 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  // L2: square + square + square
  [{ cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }, { cardType:"square", colSm:4, colXs:6 }],
  // L3: hero + poster
  [{ cardType:"hero",   colSm:8, colXs:12 }, { cardType:"poster", colSm:4, colXs:6 }],
  // L4: poster × 4
  [{ cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  // L5: square + wide + square
  [{ cardType:"square", colSm:3, colXs:6 }, { cardType:"wide",   colSm:6, colXs:12 }, { cardType:"square", colSm:3, colXs:6 }],
  // L6: wide + poster + poster
  [{ cardType:"wide",   colSm:6, colXs:12 }, { cardType:"poster", colSm:3, colXs:6 }, { cardType:"poster", colSm:3, colXs:6 }],
  // L7: poster + hero
  [{ cardType:"poster", colSm:4, colXs:6 }, { cardType:"hero",   colSm:8, colXs:12 }],
  // L8: square × 4
  [{ cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }, { cardType:"square", colSm:3, colXs:6 }],
];

function getRows(mode: ViewMode): RowDef[] {
  if (mode === "day")  return ROWS_DAY;
  if (mode === "week") return ROWS_WEEK;
  return ROWS_MONTH;
}

// Distribui items pelos slots do template, repetindo linhas conforme necessário
function assignSlots(
  items: EditorialGroup[],
  mode:  ViewMode,
): Array<{ item: EditorialGroup; slot: SlotDef; rowH: string }> {
  const rows    = getRows(mode);
  const nonCmp  = items.filter(i => i.visualWeight !== "compact");
  const result: Array<{ item: EditorialGroup; slot: SlotDef; rowH: string }> = [];

  // Flatten slots in order, repeating the pattern
  let itemIdx = 0;
  let rowIdx  = 0;
  while (itemIdx < nonCmp.length) {
    const row = rows[rowIdx % rows.length];
    for (const slot of row) {
      if (itemIdx >= nonCmp.length) break;
      // Altura da linha = o maior tipo de card da linha
      const lineH = ROW_H[slot.cardType];
      result.push({ item: nonCmp[itemIdx], slot, rowH: lineH });
      itemIdx++;
    }
    rowIdx++;
  }
  return result;
}


function AgendaEditorialFeed({
  items,
  mode,
  isLoading,
  trendingDay,
  trendingWeek,
}: {
  items:        EditorialGroup[];
  mode:         ViewMode;
  isLoading:    boolean;
  trendingDay:  Set<number>;
  trendingWeek: Set<number>;
}) {
  const rows    = getRows(mode);
  const nonCmp  = items.filter(i => i.visualWeight !== "compact");
  const compact = items.filter(i => i.visualWeight === "compact");

  if (isLoading && items.length === 0) {
    // Skeleton: primeiras 2 linhas do template
    return (
      <div className="flex flex-col gap-3">
        {rows.slice(0, 2).map((row, rIdx) => {
          const rowH = ROW_H[row[0].cardType];
          return (
            <div key={rIdx} className={`grid gap-3 ${rowH}`} style={{ gridTemplateColumns: "repeat(12, 1fr)" }}>
              {row.map((slot, sIdx) => (
                <div
                  key={sIdx}
                  className="h-full rounded-2xl bg-white/[0.035] animate-pulse"
                  style={{ gridColumn: `span ${slot.colSm}` }}
                />
              ))}
            </div>
          );
        })}
      </div>
    );
  }

  if (nonCmp.length === 0) {
    return (
      <div className="rounded-[24px] border border-white/[0.08] bg-zinc-900/80 px-6 py-14 text-center">
        <p className="text-[14px] font-black text-white/35">Nada forte o bastante para este recorte.</p>
        <p className="mt-1 text-[11px] text-white/20">A curadoria fica melhor quando chegam novos eventos.</p>
      </div>
    );
  }

  // Distribui items pelas linhas do template, repetindo até acabar.
  // Linha incompleta (< slots disponíveis): itens vão pro compacto em vez de
  // ficarem sozinhos num grid com espaço vazio.
  const renderedRows: Array<{ rowDef: RowDef; items: EditorialGroup[] }> = [];
  const spillover: EditorialGroup[] = []; // itens que não completam uma linha
  let cursor = 0;
  let rIdx   = 0;
  while (cursor < nonCmp.length) {
    const rowDef  = rows[rIdx % rows.length];
    const remaining = nonCmp.length - cursor;
    if (remaining === 0) break;

    if (remaining >= rowDef.length) {
      // Linha completa — renderiza normalmente
      renderedRows.push({ rowDef, items: nonCmp.slice(cursor, cursor + rowDef.length) });
      cursor += rowDef.length;
    } else {
      // Sobrou menos que o tamanho da linha.
      // Se sobrou 1 item → sempre vai pro spillover.
      // Se sobrou ≥2 itens → tenta achar uma linha menor que caiba exatamente.
      const smaller = rows.find(r => r.length === remaining);
      if (smaller) {
        renderedRows.push({ rowDef: smaller, items: nonCmp.slice(cursor, cursor + remaining) });
      } else {
        // Não tem linha do tamanho certo → vai pro spillover
        spillover.push(...nonCmp.slice(cursor, cursor + remaining));
      }
      cursor += remaining;
    }
    rIdx++;
  }
  // Spillover junta com os itens compactos — mantém ordem decrescente por score
  const allCompact = [...spillover, ...compact].sort((a, b) => b.score - a.score);

  return (
    <div className="flex flex-col gap-3">
      {renderedRows.map((row, rIdx) => {
        // Altura da linha: o maior tipo da linha dita a altura
        const dominantType = row.rowDef.reduce<CardType>((best, slot) => {
          const order: CardType[] = ["hero", "wide", "poster", "square", "tall"];
          return order.indexOf(slot.cardType) < order.indexOf(best) ? slot.cardType : best;
        }, "square");
        const rowH = ROW_H[dominantType];

        return (
          <div
            key={rIdx}
            className={`grid gap-3 ${rowH}`}
            style={{ gridTemplateColumns: "repeat(12, 1fr)" }}
          >
            {row.items.map((item, cIdx) => {
              const slot = row.rowDef[cIdx];
              const key  = `${item.group.key}-${item.dateStr}-${rIdx}-${cIdx}`;
              return (
                <div
                  key={key}
                  className="h-full min-w-0"
                  style={{ gridColumn: `span ${slot.colSm}` }}
                >
                  {slot.cardType === "hero"   && <AgendaEditorialHeroCard   item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                  {slot.cardType === "wide"   && <AgendaEditorialWideCard   item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                  {slot.cardType === "square" && <AgendaEditorialSquareCard item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                  {slot.cardType === "poster" && <AgendaEditorialPosterCard item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                  {slot.cardType === "tall"   && <AgendaEditorialTallCard   item={item} trendingDay={trendingDay} trendingWeek={trendingWeek} />}
                </div>
              );
            })}
          </div>
        );
      })}

      {allCompact.length > 0 && (
        <AgendaCompactCluster items={allCompact} />
      )}
    </div>
  );
}


function RadarHero({
  phase, mode, onChangeMode, filteredCount, filteredEps, enrichProgress,
  spotlightItems,
}: {
  phase: Phase;
  mode: ViewMode;
  onChangeMode: (m: ViewMode) => void;
  filteredCount: number;
  filteredEps: number;
  enrichProgress: number;
  spotlightItems: SpotlightItem[];
}) {
  const router = useRouter();
  const today = new Date().toLocaleDateString("pt-BR", {
    weekday: "long", day: "2-digit", month: "long", year: "numeric",
  });

  const [idx, setIdx]         = useState(0);
  const [visible, setVisible] = useState(true);
  const timerRef              = useRef<ReturnType<typeof setTimeout> | null>(null);

  const goTo = useCallback((nextIdx: number) => {
    setVisible(false);
    setTimeout(() => { setIdx(nextIdx); setVisible(true); }, 280);
  }, []);

  useEffect(() => {
    if (spotlightItems.length === 0) return;
    timerRef.current = setTimeout(() => {
      goTo((idx + 1) % spotlightItems.length);
    }, SPOTLIGHT_MS);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [idx, spotlightItems.length, goTo]);

  const item     = spotlightItems[idx] ?? null;
  const tmdb     = item?.group.tmdb ?? null;
  const backdrop = tmdb ? bestHorizontalImg(tmdb, "w1280") : null;
  const poster   = tmdb ? bestVerticalImg(tmdb) : null;
  const itemName = tmdb?.name ?? null;
  const { label: catLabel, color: catColor } = item ? resolveCatLabel(item.group) : { label: "", color: "" };
  const badge = item
    ? (item.isTrendingDay  ? { text: "Em alta hoje",       cls: "bg-rose-500/20 text-rose-300 border-rose-500/25" }
    : item.isPremiere      ? { text: "Estreia",            cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/25" }
    : item.isFinale        ? { text: "Final de temporada", cls: "bg-violet-500/20 text-violet-300 border-violet-500/25" }
    : item.isTrendingWeek  ? { text: "Em alta na semana",  cls: "bg-amber-500/20 text-amber-300 border-amber-500/25" }
    : null)
    : null;
  const href = tmdb ? `/title/tv/${tmdb.tmdb_id}` : "#";

  return (
    <div className="relative isolate mb-9 overflow-hidden rounded-[2rem] border border-white/[0.10] shadow-[0_32px_100px_rgba(0,0,0,0.55)]">
      {/* Fundo base */}
      <div className="absolute inset-0 -z-10 bg-zinc-950" />

      {/* Backdrop contínuo — cobre TODO o painel como fundo infinito */}
      <div
        className="absolute inset-0 -z-10 transition-opacity duration-700"
        style={{ opacity: visible ? 1 : 0.6 }}
      >
        {backdrop
          ? <img src={backdrop} alt="" className="h-full w-full object-cover object-center" />
          : <div className="h-full w-full bg-gradient-to-br from-zinc-900 to-black" />
        }
        {/* Overlay base escuro sobre o fundo inteiro */}
        <div className="absolute inset-0 bg-black/75" />
        {/* Overlay extra na metade superior — torna faixa de métricas mais escura/legível */}
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-black/60 to-transparent" />
        {/* Overlay lateral esquerdo para legibilidade do texto */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
      </div>

      {/* Glows editoriais sobre o backdrop */}
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 15% 0%, rgba(56,189,248,0.18) 0%, transparent 55%)" }} />
      <div className="absolute inset-0 -z-10" style={{ background: "radial-gradient(ellipse at 90% 100%, rgba(16,185,129,0.10) 0%, transparent 50%)" }} />
      <div className="absolute inset-0 -z-10 opacity-[0.015]"
        style={{ backgroundImage: "linear-gradient(0deg,white 1px,transparent 1px),linear-gradient(90deg,white 1px,transparent 1px)", backgroundSize: "64px 64px" }} />

      {/* ── Faixa superior: identidade + métricas + tabs ── */}
      <div className="relative px-6 pt-6 pb-0 sm:px-9 sm:pt-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          {/* Identidade + data + status */}
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-sky-400/80">Radar · POPLOG</span>
              <span className={`flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${
                phase === "done"
                  ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-400/70"
                  : "border-sky-500/20 bg-sky-500/10 text-sky-400/70"
              }`}>
                <span className={`w-1 h-1 rounded-full ${phase === "done" ? "bg-emerald-400/80" : "bg-sky-400/80 animate-pulse"}`} />
                {phase === "done" ? "Engine ativa" : PHASE_LABELS[phase]}
              </span>
            </div>
            <p className="text-[12px] text-white/25 capitalize">{today}</p>
          </div>

          {/* Tabs de período */}
          <div className="flex items-center gap-1 rounded-2xl border border-white/[0.09] bg-black/30 p-1 backdrop-blur-md shrink-0">
            {(["day", "week", "month"] as ViewMode[]).map((v) => (
              <button key={v} type="button" onClick={() => onChangeMode(v)}
                className={`text-[11px] font-bold px-3.5 py-1.5 rounded-lg transition-all duration-200 ${
                  mode === v
                    ? "border border-sky-300/25 bg-sky-300/[0.14] text-sky-100 shadow-[0_0_18px_rgba(56,189,248,0.12)]"
                    : "text-white/30 hover:text-white/55"
                }`}>
                {v === "day" ? "Hoje" : v === "week" ? "Semana" : "30 dias"}
              </button>
            ))}
          </div>
        </div>

        {/* Título + métricas */}
        <div className="flex items-center gap-4 flex-wrap mt-4 mb-6">
          <h1 className="text-4xl sm:text-5xl font-black text-white leading-none tracking-[-0.06em]">Radar</h1>
          {filteredCount > 0 && (
            <>
              <div className="h-6 w-px bg-white/10 ml-1" />
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black text-white/75 tabular-nums">{filteredCount}</span>
                <span className="text-[11px] text-white/30">séries</span>
              </div>
              <div className="h-4 w-px bg-white/10" />
              <div className="flex items-center gap-1.5">
                <span className="text-2xl font-black text-emerald-300 tabular-nums">{filteredEps.toLocaleString("pt-BR")}</span>
                <span className="text-[11px] text-white/30">episódios</span>
              </div>
              {phase === "enriching" && (
                <>
                  <div className="h-4 w-px bg-white/10" />
                  <span className="text-[11px] text-white/30">Enriquecendo… {Math.round(enrichProgress)}%</span>
                </>
              )}
            </>
          )}
          {filteredCount === 0 && phase !== "done" && (
            <span className="text-[13px] text-white/35 ml-2">{PHASE_LABELS[phase]}</span>
          )}
        </div>
      </div>

      {/* ── Hero cinematográfico — continua o mesmo fundo, sem borda separada ── */}
      {spotlightItems.length > 0 && item && tmdb && (
        <div
          className="relative cursor-pointer overflow-hidden"
          style={{ minHeight: 220 }}
          onClick={() => router.push(href)}
        >
          {/* Linha sutil de separação visual entre faixa superior e hero */}
          <div className="absolute top-0 inset-x-6 sm:inset-x-9 h-px bg-white/[0.06]" />
          {/* Nav mobile */}
          {spotlightItems.length > 1 && (
            <>
              <button type="button" aria-label="Anterior"
                onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx - 1 + spotlightItems.length) % spotlightItems.length); }}
                className="sm:hidden absolute left-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.20] bg-black/50 backdrop-blur-sm">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/70"><path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
              <button type="button" aria-label="Próximo"
                onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx + 1) % spotlightItems.length); }}
                className="sm:hidden absolute right-3 top-1/2 -translate-y-1/2 z-20 flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.20] bg-black/50 backdrop-blur-sm">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/70"><path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </button>
            </>
          )}

          {/* Overlay direcional sobre o backdrop compartilhado — escurece embaixo para legibilidade */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-r from-black/60 via-transparent to-transparent" />

          {/* Conteúdo */}
          <div className="relative flex items-end gap-5 p-5 sm:p-7 min-h-[240px] transition-opacity duration-300" style={{ opacity: visible ? 1 : 0 }}>
            {poster && (
              <div className="hidden sm:block w-[80px] shrink-0 rounded-xl overflow-hidden border border-white/[0.10] shadow-xl shadow-black/40">
                <img src={poster} alt={itemName ?? ""} className="w-full aspect-[2/3] object-cover" />
              </div>
            )}
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 mb-2.5">
                <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${catColor}`}>{catLabel}</span>
                {item.group.streamingProvider && (
                  <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border bg-emerald-500/15 text-emerald-300/80 border-emerald-500/20">
                    {item.group.streamingProvider.name}
                  </span>
                )}
                {badge && <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-lg border ${badge.cls}`}>{badge.text}</span>}
                <span className="text-[9px] font-bold uppercase tracking-[0.15em] text-white/35 border border-white/[0.08] rounded-lg px-2 py-0.5">{item.label}</span>
              </div>
              <h3 className="text-2xl sm:text-[28px] font-black tracking-[-0.04em] text-white/95 leading-none mb-2 line-clamp-2">{itemName}</h3>
              {tmdb.overview && (
                <p className="text-[12px] text-white/40 leading-relaxed line-clamp-2 max-w-lg mb-2.5">{tmdb.overview}</p>
              )}
              <div className="flex items-center gap-3 flex-wrap">
                {(tmdb.vote_average ?? 0) > 0 && (
                  <div className="flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" className="text-amber-400">
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                    </svg>
                    <span className="text-[12px] font-black text-amber-300">{tmdb.vote_average.toFixed(1)}</span>
                  </div>
                )}
                {tmdb.networks && tmdb.networks.length > 0 && (
                  <span className="text-[11px] text-white/30">{tmdb.networks[0].name}</span>
                )}
                {(tmdb.number_of_seasons ?? 0) > 0 && (
                  <span className="text-[11px] text-white/20">{tmdb.number_of_seasons} temporada{(tmdb.number_of_seasons ?? 0) !== 1 ? "s" : ""}</span>
                )}
              </div>
            </div>

            {/* Setas + dots desktop */}
            {spotlightItems.length > 1 && (
              <div className="hidden sm:flex flex-col items-center gap-2 shrink-0 self-center">
                <button type="button" aria-label="Anterior"
                  onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx - 1 + spotlightItems.length) % spotlightItems.length); }}
                  className="flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.15] bg-white/[0.06] hover:bg-white/[0.14] transition-all">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/60"><path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <button type="button" aria-label="Próximo"
                  onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo((idx + 1) % spotlightItems.length); }}
                  className="flex items-center justify-center w-8 h-8 rounded-full border border-white/[0.15] bg-white/[0.06] hover:bg-white/[0.14] transition-all">
                  <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 text-white/60"><path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>
                <div className="flex flex-col gap-1 mt-1">
                  {spotlightItems.slice(0, Math.min(spotlightItems.length, 8)).map((_, i) => (
                    <button key={i} type="button"
                      onClick={(e) => { e.stopPropagation(); if (timerRef.current) clearTimeout(timerRef.current); goTo(i); }}
                      className={`rounded-full transition-all duration-300 ${i === idx ? "h-4 w-1.5 bg-white/60" : "h-1.5 w-1.5 bg-white/20 hover:bg-white/35"}`}
                      aria-label={`Slide ${i + 1}`} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Barra de progresso */}
          <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-white/[0.05]">
            <div className="h-full bg-white/25 rounded-full"
              style={{ animation: `spotlight-progress ${SPOTLIGHT_MS}ms linear`, animationPlayState: "running", width: "100%", transformOrigin: "left" }}
              key={idx} />
          </div>
        </div>
      )}

      {/* Skeleton quando carregando */}
      {spotlightItems.length === 0 && phase !== "done" && (
        <div className="min-h-[180px] animate-pulse" />
      )}

      <style>{`
        @keyframes spotlight-progress {
          from { transform: scaleX(0); }
          to   { transform: scaleX(1); }
        }
      `}</style>
    </div>
  );
}


const WEEK_HEADERS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

function MonthView({
  year, month, byDay, selectedDay, onSelectDay,
}: {
  year: number; month: number;
  byDay: Map<string, IcsSeriesGroup[]>;
  selectedDay: string; onSelectDay: (d: string) => void;
}) {
  const today = todayStr();
  const totalDays  = getDaysInMonth(year, month);
  const firstOff   = getFirstDayOfMonth(year, month);
  const prevMonthDays = getDaysInMonth(year, month - 1 < 0 ? 11 : month - 1);

  const cells: Array<{ dateStr: string; isCurrent: boolean }> = [];
  for (let i = firstOff - 1; i >= 0; i--) {
    const d = prevMonthDays - i;
    const mo = month - 1 < 0 ? 11 : month - 1;
    const y  = month - 1 < 0 ? year - 1 : year;
    cells.push({ dateStr: `${y}-${String(mo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, isCurrent: false });
  }
  for (let d = 1; d <= totalDays; d++) {
    cells.push({ dateStr: `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, isCurrent: true });
  }
  const rem = cells.length % 7;
  if (rem > 0) {
    const nextMo = month + 1 > 11 ? 0 : month + 1;
    const nextY  = month + 1 > 11 ? year + 1 : year;
    for (let d = 1; d <= 7 - rem; d++) {
      cells.push({ dateStr: `${nextY}-${String(nextMo + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`, isCurrent: false });
    }
  }

  return (
    <div>
      <div className="grid grid-cols-7 mb-1.5">
        {WEEK_HEADERS.map((h) => (
          <div key={h} className="text-center text-[11px] font-bold uppercase tracking-[0.14em] text-white/30 py-2.5">{h}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map(({ dateStr, isCurrent }) => {
          const groups = byDay.get(dateStr) ?? [];
          const isToday = dateStr === today;
          const isSel   = dateStr === selectedDay;
          const dayNum  = parseInt(dateStr.split("-")[2], 10);
          const hasContent = groups.length > 0;

          const visible = groups.slice(0, 3);
          const extra   = groups.length - visible.length;

          const pillColor = (g: IcsSeriesGroup) => {
            const c = g.category;
            if (c === "CINEMATIC")       return "bg-violet-500/20 border-violet-500/20 text-violet-200/80";
            if (c === "ANIMATION")       return "bg-teal-500/20 border-teal-500/20 text-teal-200/80";
            if (c === "DOCUMENTARY")     return "bg-cyan-500/20 border-cyan-500/20 text-cyan-200/80";
            if (c === "REALITY_PREMIUM") return "bg-amber-500/20 border-amber-500/20 text-amber-200/80";
            return "bg-sky-500/15 border-sky-500/15 text-sky-200/75";
          };

          return (
            <button key={dateStr} type="button" onClick={() => onSelectDay(dateStr)}
              className={[
                "relative min-h-[90px] sm:min-h-[110px] rounded-2xl p-2 text-left transition-all duration-200 border group/cell",
                !isCurrent ? "opacity-20 border-white/[0.03] bg-transparent cursor-default" : "",
                isCurrent && !isToday && !isSel && !hasContent ? "border-white/[0.05] bg-transparent hover:bg-white/[0.02] hover:border-white/[0.08]" : "",
                isCurrent && !isToday && !isSel && hasContent  ? "border-white/[0.08] bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/[0.13]" : "",
                isToday && !isSel ? "border-sky-500/50 bg-sky-500/[0.08] hover:bg-sky-500/[0.12]" : "",
                isSel ? "border-sky-400/70 bg-sky-500/[0.16] ring-1 ring-sky-500/30" : "",
              ].join(" ")}
            >
              <div className="flex items-center justify-between mb-1.5">
                <span className={[
                  "text-[13px] font-black leading-none",
                  isToday ? "text-sky-300" : isCurrent ? "text-white/50" : "text-white/15",
                ].join(" ")}>
                  {dayNum}
                </span>
                {hasContent && (
                  <span className={`text-[9px] font-black tabular-nums ${isToday ? "text-sky-400/80" : "text-white/20"}`}>
                    {groups.length}
                  </span>
                )}
              </div>
              <div className="flex flex-col gap-[3px]">
                {visible.map((g) => {
                  const poster = g.tmdb ? TMDB_IMG(g.tmdb.poster_path, "w92") : null;
                  const pc = pillColor(g);
                  return (
                    <div key={g.key} className={`flex items-center gap-1 rounded-[5px] px-1.5 py-[3px] border ${pc}`}>
                      {poster && (
                        <img src={poster} alt="" className="w-3.5 h-5 rounded-[2px] object-cover shrink-0 opacity-90" />
                      )}
                      <span className="text-[9px] font-bold truncate leading-tight">
                        {g.tmdb?.name ?? g.rawTitle}
                      </span>
                    </div>
                  );
                })}
                {extra > 0 && (
                  <span className="text-[9px] font-bold text-white/30 pl-1">+{extra} mais</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Vista Semanal ──────────────────────────────────────────────────────────────

function WeekView({
  weekStart, byDay, selectedDay, onSelectDay,
}: {
  weekStart: Date; byDay: Map<string, IcsSeriesGroup[]>;
  selectedDay: string; onSelectDay: (d: string) => void;
}) {
  const today = todayStr();
  const days  = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    return toLocalDateStr(d);
  });
  const DAY_SHORT = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

  return (
    <div className="space-y-2">
      {days.map((dateStr, i) => {
        const groups   = byDay.get(dateStr) ?? [];
        const isToday  = dateStr === today;
        const isSel    = dateStr === selectedDay;
        const dayNum   = parseInt(dateStr.split("-")[2], 10);

        return (
          <button key={dateStr} type="button" onClick={() => onSelectDay(dateStr)}
            className={[
              "w-full flex items-center gap-4 px-4 py-3.5 rounded-2xl border transition-all duration-200 text-left",
              isSel ? "border-sky-400/50 bg-sky-500/[0.12]" :
              isToday ? "border-sky-500/35 bg-sky-500/[0.07] hover:bg-sky-500/[0.10]" :
              groups.length > 0 ? "border-white/[0.08] bg-white/[0.025] hover:bg-white/[0.05]" :
              "border-white/[0.04] bg-transparent hover:bg-white/[0.02]",
            ].join(" ")}
          >
            <div className="flex flex-col items-center justify-center w-[48px] shrink-0 gap-0.5">
              <span className={`text-[10px] font-bold uppercase tracking-[0.15em] leading-none ${isToday ? "text-sky-400" : "text-white/25"}`}>
                {DAY_SHORT[i]}
              </span>
              <span className={`text-[22px] font-black tabular-nums leading-none ${isToday ? "text-sky-200" : "text-white/55"}`}>
                {dayNum}
              </span>
            </div>

            <div className={`w-px self-stretch rounded-full ${isToday ? "bg-sky-500/30" : "bg-white/[0.06]"}`} />

            {groups.length === 0 ? (
              <span className="text-[11px] text-white/15 flex-1 italic">Nenhuma série</span>
            ) : (
              <div className="flex-1 flex flex-wrap gap-1.5 items-center">
                {groups.slice(0, 6).map((g) => {
                  const poster = g.tmdb ? TMDB_IMG(g.tmdb.poster_path, "w92") : null;
                  const c = g.category;
                  const pc =
                    c === "CINEMATIC"       ? "bg-violet-500/20 border-violet-500/20 text-violet-200/85" :
                    c === "ANIMATION"       ? "bg-teal-500/20 border-teal-500/20 text-teal-200/85" :
                    c === "DOCUMENTARY"     ? "bg-cyan-500/20 border-cyan-500/20 text-cyan-200/85" :
                    c === "REALITY_PREMIUM" ? "bg-amber-500/20 border-amber-500/20 text-amber-200/85" :
                    "bg-sky-500/15 border-sky-500/15 text-sky-200/80";
                  return (
                    <div key={g.key} className={`flex items-center gap-1.5 rounded-lg px-2 py-1 border ${pc}`}>
                      {poster && (
                        <img src={poster} alt="" className="w-4 h-6 rounded-[3px] object-cover shrink-0 opacity-90" />
                      )}
                      <span className="text-[10px] font-bold max-w-[100px] truncate leading-tight">
                        {g.tmdb?.name ?? g.rawTitle}
                      </span>
                    </div>
                  );
                })}
                {groups.length > 6 && (
                  <span className="text-[10px] text-white/30 font-bold">+{groups.length - 6}</span>
                )}
              </div>
            )}

            {groups.length > 0 && (
              <span className="shrink-0 text-[13px] font-black text-white/20 tabular-nums">{groups.length}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Vista Diária ───────────────────────────────────────────────────────────────

function DayView({
  dateStr, groups,
}: {
  dateStr: string; groups: IcsSeriesGroup[];
}) {
  const router = useRouter();
  const label = formatDayFull(dateStr);

  if (groups.length === 0) {
    return (
      <div className="rounded-2xl border border-white/[0.05] bg-white/[0.015] px-6 py-12 text-center">
        <p className="text-[13px] font-bold text-white/25 mb-1">Nenhuma série neste dia</p>
        <p className="text-[11px] text-white/15">{label}</p>
      </div>
    );
  }

  // Ordena grupos por relevância decrescente (hype + popularidade + tendência)
  const sortedGroups = [...groups].sort(
    (a, b) => (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0) ||
              ((b.tmdb?.popularity ?? 0) - (a.tmdb?.popularity ?? 0))
  );

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <SectionEyebrow color="sky">Séries do dia</SectionEyebrow>
          <h3 className="text-[16px] font-black tracking-[-0.03em] text-white/80 capitalize leading-tight">{label}</h3>
        </div>
        <span className="text-[11px] font-black text-white/20 border border-white/[0.08] rounded-full px-2.5 py-0.5">
          {sortedGroups.length} série{sortedGroups.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="space-y-2">
        {sortedGroups.map((g) => {
          // Episódios deste dia, ordenados por horário
          const eps = g.episodes
            .filter((ep) => ep.startAt.slice(0, 10) === dateStr)
            .sort((a, b) => a.startAt.localeCompare(b.startAt));
          const firstEpTime = eps[0]?.startAt;
          const showTime = firstEpTime && !firstEpTime.endsWith("T00:00:00.000Z");

          return (
            <div
              key={g.key}
              className="group relative rounded-[22px] border border-white/[0.08] bg-white/[0.035] backdrop-blur-xl hover:border-white/[0.10] transition-all duration-300 overflow-hidden cursor-pointer"
              onClick={() => g.tmdb?.tmdb_id && router.push(`/title/tv/${g.tmdb.tmdb_id}`)}
            >
              {g.tmdb?.backdrop_path && (
                <div className="absolute inset-0 opacity-[0.12]">
                  <img src={TMDB_IMG(g.tmdb.backdrop_path, "w780")!} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-gradient-to-r from-black/70 to-black/20" />
                </div>
              )}
              <div className="relative flex items-start gap-4 p-4">
                <div className="relative w-[56px] h-[84px] rounded-2xl overflow-hidden bg-white/[0.04] shrink-0 border border-white/[0.08]">
                  {g.tmdb?.poster_path ? (
                    <img src={TMDB_IMG(g.tmdb.poster_path, "w185")!} alt={g.tmdb.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="w-5 h-5 text-white/15">
                        <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
                      </svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <span className={`text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${resolveCatLabel(g).color}`}>
                      {resolveCatLabel(g).label}
                    </span>
                    {showTime && (
                      <span className="text-[10px] font-bold text-white/30 border border-white/[0.07] rounded-full px-2 py-0.5">
                        {formatTime(firstEpTime)}
                      </span>
                    )}
                    {g.tmdb?.vote_average && g.tmdb.vote_average > 0 && (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-amber-300/80">
                        <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                        {g.tmdb.vote_average.toFixed(1)}
                      </span>
                    )}
                  </div>
                  <p className="text-[15px] font-black tracking-[-0.02em] text-white/90 leading-tight truncate mb-2">
                    {g.tmdb?.name ?? g.rawTitle}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {eps.map((ep) => (
                      <span key={ep.uid} className="text-[10px] font-black px-2 py-0.5 rounded-full bg-white/[0.07] text-white/55 border border-white/[0.10]">
                        S{String(ep.season).padStart(2,"0")}E{String(ep.episode).padStart(2,"0")}
                        {ep.episodeName && ep.episodeName.toLowerCase() !== "tba"
                          ? ` · ${ep.episodeName.slice(0, 35)}`
                          : ""}
                      </span>
                    ))}
                  </div>
                </div>
                {eps.length > 1 && (
                  <div className="shrink-0 text-right">
                    <p className="text-[24px] font-black tabular-nums text-white/10 leading-none">{eps.length}</p>
                    <p className="text-[8px] text-white/15 uppercase tracking-wide">eps</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Period nav ─────────────────────────────────────────────────────────────────

function PeriodNav({ label, onPrev, onNext, onToday }: {
  label: string; onPrev: () => void; onNext: () => void; onToday: () => void;
}) {
  return (
    <div className="flex items-center justify-between mb-5">
      <h2 className="text-[20px] font-black tracking-[-0.03em] text-white/85 capitalize">{label}</h2>
      <div className="flex items-center gap-2">
        <button type="button" onClick={onToday}
          className="text-[11px] font-bold text-white/40 hover:text-white/65 border border-white/[0.09] rounded-2xl px-3.5 py-1.5 transition-colors">
          Hoje
        </button>
        {(["prev", "next"] as const).map((dir) => (
          <button key={dir} type="button" onClick={dir === "prev" ? onPrev : onNext}
            aria-label={dir === "prev" ? "Anterior" : "Próximo"}
            className="w-9 h-9 rounded-2xl border border-white/[0.09] bg-white/[0.045] flex items-center justify-center text-white/40 hover:text-white/75 hover:bg-white/[0.07] transition-all">
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
              {dir === "prev"
                ? <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
                : <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />}
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Day detail panel ───────────────────────────────────────────────────────────

function DayPanel({ dateStr, groups, onClose }: {
  dateStr: string; groups: IcsSeriesGroup[]; onClose: () => void;
}) {
  return (
    <div className="mt-8 rounded-[28px] border border-sky-500/20 bg-sky-950/10 p-5 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <SectionEyebrow color="sky">Detalhe do dia</SectionEyebrow>
        <button type="button" onClick={onClose}
          className="text-[10px] font-bold text-white/25 hover:text-white/50 border border-white/[0.07] rounded-lg px-2.5 py-1 transition-colors">
          Fechar
        </button>
      </div>
      <DayView dateStr={dateStr} groups={groups} />
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────



export default function AgendaClient({ initialData }: { initialData: IcsAgendaResponse | null }) {
  // ── Inicialização com dados do servidor ──────────────────────────────────────
  // Quando initialData existe (cache quente), inicializa o estado diretamente
  // nos useState — sem useEffect, sem fetch, sem loading state.
  const hydrate = (gs: IcsSeriesGroup[]): IcsSeriesGroup[] =>
    gs.map((g) => ({ ...g, episodes: g.episodes.map((ep) => ({ ...ep })) }));

  const [groups, setGroups]           = useState<IcsSeriesGroup[]>(() =>
    initialData ? hydrate(initialData.groups ?? []) : []
  );
  const [featuredGroups, setFeatured] = useState<IcsSeriesGroup[]>(() =>
    initialData ? hydrate(initialData.featuredGroups ?? []) : []
  );
  const [movies, setMovies]           = useState<MovieGroup[]>(() =>
    initialData?.movies ?? []
  );
  const [phase, setPhase]             = useState<Phase>(() => initialData ? "done" : "idle");
  const [error, setError]             = useState<string | null>(null);
  const [enrichProgress, setEnrichProgress] = useState(0);

  const trendingDayRef  = useRef<Set<number>>(
    new Set(initialData?.trendingDay  ?? [])
  );
  const trendingWeekRef = useRef<Set<number>>(
    new Set(initialData?.trendingWeek ?? [])
  );

  const now = new Date();

  const [mode, setMode]                 = useState<ViewMode>("week");
  const [navYear, setNavYear]           = useState(now.getFullYear());
  const [navMonth, setNavMonth]         = useState(now.getMonth());
  const [navWeekStart, setNavWeekStart] = useState(() => startOfWeek(now));
  const [selectedDay, setSelectedDay]   = useState(todayStr());

  // Fallback: só executa se não tínhamos initialData (cache frio)
  useEffect(() => {
    if (initialData) return;

    let cancelled = false;

    async function load() {
      setPhase("fetching_ics");
      try {
        const res = await fetch("/api/ics/agenda");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setPhase("grouping");
        const data = await res.json() as IcsAgendaResponse;
        if (cancelled) return;
        setPhase("cache_check");

        trendingDayRef.current  = new Set(data.trendingDay  ?? []);
        trendingWeekRef.current = new Set(data.trendingWeek ?? []);
        const hydratedGroups   = hydrate(data.groups ?? []);
        const hydratedFeatured = hydrate(data.featuredGroups ?? []);
        setGroups(hydratedGroups);
        setFeatured(hydratedFeatured);
        setMovies(data.movies ?? []);

        const needsEnrich = hydratedFeatured.filter((g) => !g.tmdb);
        if (needsEnrich.length === 0) { setPhase("done"); return; }
        setPhase("enriching");
        const batches: IcsSeriesGroup[][] = [];
        for (let i = 0; i < needsEnrich.length; i += ENRICH_BATCH) {
          batches.push(needsEnrich.slice(i, i + ENRICH_BATCH));
        }
        let done = 0;
        for (const batch of batches) {
          if (cancelled) break;
          try {
            const titles = batch.map((g) => g.rawTitle);
            const enrichRes = await fetch("/api/ics/enrich", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ titles }),
            });
            if (enrichRes.ok) {
              const { results } = await enrichRes.json() as { results: Record<string, import("@/lib/ics-engine").TmdbEnrichment | null> };
              const td = trendingDayRef.current;
              const tw = trendingWeekRef.current;
              const apply = (prev: IcsSeriesGroup[]) =>
                prev
                  .map((g) => results[g.rawTitle] !== undefined && !g.tmdb
                    ? { ...g, tmdb: results[g.rawTitle] }
                    : g)
                  .filter((g) => filterEnrichedGroup(g, td, tw));
              setFeatured(apply);
              setGroups(apply);
            }
          } catch (e) { console.warn("[agenda] enrich batch error:", e); }
          done += batch.length;
          setEnrichProgress((done / needsEnrich.length) * 100);
          if (done < needsEnrich.length) await new Promise((r) => setTimeout(r, ENRICH_PAUSE));
        }
        if (!cancelled) setPhase("done");
      } catch (err) {
        if (!cancelled) { setError(err instanceof Error ? err.message : "Erro"); setPhase("done"); }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [initialData]);

  // Só mostra grupos com poster + nome TMDB
  const visibleFeatured = useMemo(() => featuredGroups.filter(hasValidTmdb), [featuredGroups]);

  // Mapa dia → grupos (para MonthView, WeekView, DayView)
  const byDay = useMemo(() => buildDayMap([...featuredGroups, ...groups]), [featuredGroups, groups]);

  // Grupos do dia selecionado (para DayPanel e DayView)
  const selectedDayGroups = byDay.get(selectedDay) ?? [];
  const showDayPanel = mode !== "day" && selectedDay !== "" && selectedDayGroups.length > 0;

  // Stats
  const filteredCount = visibleFeatured.length;
  const filteredEps   = useMemo(
    () => visibleFeatured.reduce((acc, g) => acc + g.episodeCount, 0),
    [visibleFeatured],
  );

  const handlePrev = useCallback(() => {
    if (mode === "month") {
      setNavYear((y) => navMonth === 0 ? y - 1 : y);
      setNavMonth((m) => m === 0 ? 11 : m - 1);
    } else if (mode === "week") {
      setNavWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; });
    } else if (mode === "day") {
      setSelectedDay((s) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() - 1); return toLocalDateStr(d); });
    }
  }, [mode, navMonth]);

  const handleNext = useCallback(() => {
    if (mode === "month") {
      setNavYear((y) => navMonth === 11 ? y + 1 : y);
      setNavMonth((m) => m === 11 ? 0 : m + 1);
    } else if (mode === "week") {
      setNavWeekStart((d) => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; });
    } else if (mode === "day") {
      setSelectedDay((s) => { const d = new Date(s + "T12:00:00"); d.setDate(d.getDate() + 1); return toLocalDateStr(d); });
    }
  }, [mode, navMonth]);

  const handleToday = useCallback(() => {
    const t = new Date();
    setNavYear(t.getFullYear()); setNavMonth(t.getMonth());
    setNavWeekStart(startOfWeek(t)); setSelectedDay(todayStr());
  }, []);

  const periodLabel = useMemo(() => {
    if (mode === "month") return "Próximos 30 dias";
    if (mode === "week") return `Semana de ${formatWeekRange(navWeekStart)}`;
    return formatDayFull(selectedDay);
  }, [mode, navYear, navMonth, navWeekStart, selectedDay]);

  const spotlightItems = useMemo(
    () => buildSpotlightItems(visibleFeatured, trendingDayRef.current, trendingWeekRef.current),
    [visibleFeatured],
  );

  const isLoading = phase !== "done" && phase !== "idle";
  const editorialItems = useMemo(
    () => buildEditorialGroups(visibleFeatured, movies, {
      mode,
      selectedDay,
      weekStart: navWeekStart,
      year: navYear,
      month: navMonth,
      trendingDay: trendingDayRef.current,
      trendingWeek: trendingWeekRef.current,
    }),
    [mode, selectedDay, navWeekStart, navYear, navMonth, visibleFeatured, movies],
  );

  return (
    <PageShell variant="wide">

      <RadarHero
        phase={phase}
        mode={mode}
        onChangeMode={setMode}
        filteredCount={filteredCount}
        filteredEps={filteredEps}
        enrichProgress={enrichProgress}
        spotlightItems={spotlightItems}
      />

      {error && (
        <div className="mb-6 rounded-2xl border border-red-500/20 bg-red-950/20 px-5 py-4 text-[12px] text-red-300/80">
          Erro ao carregar feed: {error}
        </div>
      )}

      <SectionDivider />

      {/* Feed editorial em blocos — hero, wide, poster, compact */}
      <section>
        <AgendaEditorialFeed
          items={editorialItems}
          mode={mode}
          isLoading={isLoading}
          trendingDay={trendingDayRef.current}
          trendingWeek={trendingWeekRef.current}
        />
      </section>

      <div className="mt-10 flex items-center gap-2 border-t border-white/[0.05] pt-6">
        <span className={`w-1.5 h-1.5 rounded-full ${phase === "done" ? "bg-emerald-400/60" : "bg-amber-400/60 animate-pulse"}`} />
        <ContextualAttribution
          context="calendar"
          sourcesUsed={["bancodeseries", "tmdb"]}
        />
      </div>

    </PageShell>
  );
}
