import { supabaseAdmin } from "@/server/supabase/admin";
import { getUserWatchingSeries } from "@/server/episodes/episode-progress-service";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";
import { normalizeProviderPreferences } from "@/server/streaming/provider-preferences";
import {
  normalizeAvailabilityTypeOrNull,
  resolveProviderConfidence,
} from "@/server/streaming/availability-service";
import { syncTmdbTitle } from "@/server/sync/sync-tmdb-title";
import { applyHeroTemporalCooldown } from "./hero-impressions";

import type {
  ContinuityAvailability,
  ContinuityContext,
  HeroCandidate,
  HeroCandidatesResult,
} from "./types";

type MediaType = "movie" | "tv";

type UserTitleRow = {
  tmdb_id: number;
  media_type: MediaType;
  status: string | null;
  favorite: boolean | null;
  liked: boolean | null;
  created_at: string | null;
  updated_at: string | null;
};

type TmdbPayload = {
  title?: string | null;
  name?: string | null;
  overview?: string | null;
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string | null;
  first_air_date?: string | null;
  runtime?: number | null;
  status?: string | null;
  number_of_episodes?: number | null;
  genres?: { id: number; name: string }[] | null;
};

type TitleRow = {
  tmdb_id: number;
  media_type: MediaType;
  title: string | null;
  overview: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  release_date: string | null;
  first_air_date: string | null;
  runtime: number | null;
  status: string | null;
  number_of_episodes: number | null;
  tmdb_payload: TmdbPayload | null;
};

type AvailabilityRow = {
  tmdb_id: number;
  media_type: MediaType;
  provider_id?: number | null;
  provider_name: string | null;
  provider_logo_path?: string | null;
  logo_path?: string | null;
  availability_type: string | null;
  country: string | null;
  source: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  available_since?: string | null;
};

type HeroCandidatesOptions = {
  limit?: number;
  region?: "BR" | "US";
  sessionId?: string;
};

const DEFAULT_LIMIT = 5;

const ACTIVE_LIBRARY_STATUSES = ["watching", "watchlist", "paused"];
const BLOCKED_LIBRARY_STATUSES = [
  "watched",
  "finished",
  "abandoned",
  "fridge",
  "frozen",
];

function daysSince(value?: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.floor((Date.now() - time) / 86_400_000);
}

function getYear(value?: string | null): number | null {
  if (!value) return null;
  const year = new Date(value).getFullYear();
  return Number.isFinite(year) ? year : null;
}

function getTitleName(title?: TitleRow | null): string | null {
  return title?.title ?? title?.tmdb_payload?.title ?? title?.tmdb_payload?.name ?? null;
}
function getOverview(title?: TitleRow | null): string | null {
  return title?.overview ?? title?.tmdb_payload?.overview ?? null;
}
function getPosterPath(title?: TitleRow | null): string | null {
  return title?.poster_path ?? title?.tmdb_payload?.poster_path ?? null;
}
function getBackdropPath(title?: TitleRow | null): string | null {
  return title?.backdrop_path ?? title?.tmdb_payload?.backdrop_path ?? null;
}
function getReleaseDate(title?: TitleRow | null): string | null {
  return title?.release_date ?? title?.tmdb_payload?.release_date ?? null;
}
function getFirstAirDate(title?: TitleRow | null): string | null {
  return title?.first_air_date ?? title?.tmdb_payload?.first_air_date ?? null;
}
function getRuntime(title?: TitleRow | null): number | null {
  return title?.runtime ?? title?.tmdb_payload?.runtime ?? null;
}
function getTitleStatus(title?: TitleRow | null): string | null {
  return title?.status ?? title?.tmdb_payload?.status ?? null;
}
function getTotalEpisodes(title?: TitleRow | null): number | null {
  return title?.number_of_episodes ?? title?.tmdb_payload?.number_of_episodes ?? null;
}

function resolveSeriesContext(input: {
  progressPercentage: number;
  remainingEpisodes: number | null;
  lastWatchedAt: string | null;
  libraryStatus: string | null;
  availability: ContinuityAvailability | null;
  releaseDate?: string | null;
  nextEpisodeAirDate: string | null;
}): ContinuityContext {
  const daysFromLastWatch = daysSince(input.lastWatchedAt);

  // ── new_episode ──────────────────────────────────────────────────────────────
  // "Novo episódio" significa: o show tem episódios não assistidos já disponíveis
  // E o usuário ainda está engajado. Dois caminhos qualificantes:
  //
  // Caminho A — o próximo episódio não assistido foi lançado DEPOIS que o usuário
  //   assistiu pela última vez (sinal forte: houve lançamento real desde a última sessão)
  //
  // Caminho B — o usuário assistiu recentemente (≤90d) E o próximo ep é recente
  //   (≤90d). Cobre marathons ativos onde o ep já existia antes da sessão mais recente.
  //
  // Ambos os caminhos exigem: usuário ainda engajado (≤120d) e backlog gerenciável (≤24).
  if (input.nextEpisodeAirDate) {
    const daysSinceNextEp = daysSince(input.nextEpisodeAirDate);
    const isAired = daysSinceNextEp !== null && daysSinceNextEp >= 0;

    if (isAired) {
      const userStillEngaged = daysFromLastWatch !== null && daysFromLastWatch <= 120;
      const manageableBacklog =
        input.remainingEpisodes === null || input.remainingEpisodes <= 24;

      // Caminho A: lançamento após última sessão (série continuou enquanto o usuário parou)
      const newSinceLastWatch =
        input.lastWatchedAt !== null &&
        new Date(input.nextEpisodeAirDate) > new Date(input.lastWatchedAt);

      // Caminho B: usuário ativo recentemente com ep recente (marathon em andamento)
      const recentAndActive =
        daysFromLastWatch !== null &&
        daysFromLastWatch <= 90 &&
        daysSinceNextEp !== null &&
        daysSinceNextEp <= 90;

      if (userStillEngaged && manageableBacklog && (newSinceLastWatch || recentAndActive)) {
        return "new_episode";
      }
    }
  }

  // ── finish_season ────────────────────────────────────────────────────────────
  // Poucos episódios para terminar a temporada atual (progresso global ≥ 60%).
  if (
    input.remainingEpisodes !== null &&
    input.remainingEpisodes > 0 &&
    input.remainingEpisodes <= 3 &&
    input.progressPercentage >= 60
  ) {
    return "finish_season";
  }

  // ── binge ────────────────────────────────────────────────────────────────────
  // Usuário assistiu recentemente, backlog curto — ritmo de maratona.
  if (
    daysFromLastWatch !== null &&
    daysFromLastWatch <= 7 &&
    input.remainingEpisodes !== null &&
    input.remainingEpisodes >= 1 &&
    input.remainingEpisodes <= 8
  ) {
    return "binge";
  }

  // ── resume ───────────────────────────────────────────────────────────────────
  if (input.libraryStatus === "paused") {
    return "resume";
  }

  // ── new_streaming ────────────────────────────────────────────────────────────
  if (input.availability?.isPreferred && input.availability.type === "subscription") {
    return "new_streaming";
  }

  // ── rediscovery ──────────────────────────────────────────────────────────────
  // Série pausada/esquecida, mas com backlog gerenciável — vale revisitar.
  if (
    daysFromLastWatch !== null &&
    daysFromLastWatch >= 30 &&
    input.remainingEpisodes !== null &&
    input.remainingEpisodes <= 20
  ) {
    return "rediscovery";
  }

  return "continue";
}

function typeScore(type: ContinuityAvailability["type"]): number {
  switch (type) {
    case "subscription": return 800;
    case "free": return 400;
    case "ads": return 200;
    case "rent": return 40;
    case "buy": return 20;
    default: return 0;
  }
}

function confidenceScore(confidence: ContinuityAvailability["confidence"]): number {
  switch (confidence) {
    case "mixed_confirmed": return 90;
    case "user_relevant_confirmed": return 85;
    case "watchmode_confirmed": return 80;
    case "movieofthenight_confirmed": return 75;
    case "tmdb_only": return 10;
    default: return 0;
  }
}

/**
 * 🛠️ HARDCODED OVERRIDES EDITORIAIS CORRIGIDOS
 */
const EDITORIAL_STREAMING_OVERRIDES: Record<number, { name: string; logo: string }> = {
  245318: { name: "Apple TV+", logo: "/68nt9w3tBv68YgYw866986.jpg" }, // Margô Está em Apuros -> Força Apple TV+ Nativa
};

function chooseBestAvailability(
  rows: AvailabilityRow[],
  favoriteProviderIds: string[],
  region: "BR" | "US",
  tmdbId: number
): ContinuityAvailability | null {
  if (EDITORIAL_STREAMING_OVERRIDES[tmdbId]) {
    return {
      region,
      providerName: EDITORIAL_STREAMING_OVERRIDES[tmdbId].name,
      providerLogoPath: EDITORIAL_STREAMING_OVERRIDES[tmdbId].logo,
      providerId: null,
      type: "subscription",
      confidence: "user_relevant_confirmed",
      isPreferred: false,
    };
  }

  const favoriteSet = new Set(favoriteProviderIds);

  const candidates = rows
    .filter((row) => row.country === region)
    .map((row) => {
      const providerId = typeof row.provider_id === "number" ? row.provider_id : null;
      const type = normalizeAvailabilityTypeOrNull(row.availability_type);
      const confidence = resolveProviderConfidence(row.source);
      const isPreferred = row.provider_name !== null && favoriteSet.has(row.provider_name);

      let nativeBonus = 0;
      if (row.provider_name?.toLowerCase().includes("apple") && type === "subscription") {
        nativeBonus = 2000;
      }

      const score = typeScore(type) + confidenceScore(confidence) + nativeBonus + (isPreferred ? 8000 : 0);

      return {
        score,
        availability: {
          region,
          providerName: row.provider_name,
          providerLogoPath: row.provider_logo_path ?? row.logo_path ?? null,
          providerId,
          type,
          confidence,
          isPreferred,
        } satisfies ContinuityAvailability,
      };
    })
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.availability ?? null;
}

function buildContextLabel(input: {
  context: ContinuityContext;
  remainingEpisodes: number | null;
  progressPercentage: number;
  availability?: ContinuityAvailability | null;
}): string {
  const remaining = input.remainingEpisodes;

  // Guarda para backlog muito longo — mas não sobrescreve new_episode, que tem
  // sua própria mensagem independente da quantidade de eps restantes.
  if (remaining !== null && remaining > 15 && input.context !== "new_episode") {
    return "Continuar assistindo";
  }

  switch (input.context) {
    case "new_episode": return "Novo episódio disponível";
    case "finish_season":
      if (remaining === 1) return "Último episódio da temporada";
      if (remaining === 2) return "Faltam apenas 2 episódios";
      if (remaining === 3) return "Faltam apenas 3 episódios";
      return "Boa para terminar hoje";
    case "resume": return "Perfeito para continuar agora";
    case "new_streaming": 
      return input.availability?.providerName 
        ? `Disponível na ${input.availability.providerName}` 
        : "Chegou no streaming";
    case "vod": return "Disponível em VOD";
    case "watchlist": return "Salvo na sua Watchlist";
    case "binge": return "Maratona recomendada";
    case "rediscovery": return "Vale a pena revisitar";
    case "continue":
    default:
      if (input.progressPercentage >= 90 && remaining !== null && remaining <= 2) return "Você já está quase em dia";
      return "Continuar assistindo";
  }
}

function buildSeriesScore(input: {
  context: ContinuityContext;
  progressPercentage: number;
  watchedCount: number;
  totalEpisodes: number | null;
  remainingEpisodes: number | null;
  lastWatchedAt: string | null;
  mediaStatus: string | null;
  libraryStatus: string | null;
  availability: ContinuityAvailability | null;
  releaseDate: string | null;
}) {
  const scoreBreakdown: Record<string, number> = {};
  scoreBreakdown.base = 40;

  if (input.watchedCount > 0) {
    scoreBreakdown.hasProgress = 60;
  }

  if (input.lastWatchedAt) {
    const days = daysSince(input.lastWatchedAt);
    if (days !== null) {
      if (days <= 2)  scoreBreakdown.recentActivity = 90;
      else if (days <= 7)  scoreBreakdown.recentActivity = 60;
      else if (days <= 21) scoreBreakdown.recentActivity = 30;
      else if (days <= 45) scoreBreakdown.recentActivity = 10;
      else if (days <= 90) scoreBreakdown.oldActivityPenalty = -20;
      else                 scoreBreakdown.oldActivityPenalty = -45;
    }
  }

  if (input.availability?.isPreferred) {
    scoreBreakdown.favoriteProvider = 80;
  } else if (input.availability) {
    scoreBreakdown.available = 30;
  }

  if (input.mediaStatus === "Ended") {
    scoreBreakdown.endedSeries = 10;
  }

  if (input.libraryStatus === "paused") {
    scoreBreakdown.pausedPenalty = -30;
  }

  const remaining = input.remainingEpisodes;
  const isRecent = input.releaseDate ? (getYear(input.releaseDate) ?? 0) >= 2025 : false;

  if (remaining === null) {
    scoreBreakdown.undefinedTotalPenalty = -25;
  } else {
    if (remaining === 0) {
      scoreBreakdown.completedSeriesPenalty = -9999;
    } else if (remaining >= 1 && remaining <= 2) {
      scoreBreakdown.distanceQuaseEmDia = 110;
    } else if (remaining >= 3 && remaining <= 6) {
      scoreBreakdown.distanceMaratonaCurta = 75;
    } else if (remaining >= 7 && remaining <= 15) {
      scoreBreakdown.distanceContinuidadeNormal = 30;
    } else if (remaining >= 16 && remaining <= 25) {
      scoreBreakdown.distanceRetomadaModerada = 5;
    } else if (remaining >= 26) {
      scoreBreakdown.longDistancePenalty = -65;
    }
  }

  if (isRecent && remaining !== null) {
    if (remaining <= 2) {
      scoreBreakdown.recentReleaseBoostUrgent = 90;
    } else if (remaining <= 6) {
      scoreBreakdown.recentReleaseBoostViable = 50;
    } else if (remaining <= 15) {
      scoreBreakdown.recentReleaseBoostMild = 20;
    }
  }

  switch (input.context) {
    case "new_episode": scoreBreakdown.contextNewEpisode = 130; break;
    case "finish_season": scoreBreakdown.contextFinishSeason = 95; break;
    case "binge": scoreBreakdown.contextBinge = 60; break;
    case "new_streaming": scoreBreakdown.contextNewStreaming = 85; break;
    case "resume": scoreBreakdown.contextResume = 50; break;
    case "rediscovery": scoreBreakdown.contextRediscovery = 40; break;
    default: scoreBreakdown.contextContinue = 20; break;
  }

  if (input.libraryStatus && BLOCKED_LIBRARY_STATUSES.includes(input.libraryStatus)) {
    scoreBreakdown.blockedPenalty = -9999;
  }

  const total = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  return { score: total, scoreBreakdown };
}

function buildMovieScore(input: {
  libraryStatus: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  releaseDate: string | null;
  runtime: number | null;
  availability: ContinuityAvailability | null;
}) {
  const scoreBreakdown: Record<string, number> = {};
  scoreBreakdown.base = 45;

  if (input.libraryStatus === "watching") {
    scoreBreakdown.watching = 90;
  }
  if (input.libraryStatus === "watchlist") {
    scoreBreakdown.watchlist = 40;
  }

  if (input.releaseDate) {
    const releaseTime = new Date(input.releaseDate).getTime();
    if (releaseTime > Date.now()) {
      scoreBreakdown.futureReleasePenalty = -9999;
    }
  }

  const releaseAge = daysSince(input.releaseDate);
  const hasRegionalAvailability = Boolean(input.availability);

  if (releaseAge !== null && releaseAge >= 0 && !hasRegionalAvailability) {
    scoreBreakdown.theaterExclusivePenalty = -150; 
    const addedAge = daysSince(input.createdAt);
    if (addedAge !== null && addedAge <= 3) {
      scoreBreakdown.freshTheaterCuriosity = 15;
    }
  } else if (releaseAge !== null && releaseAge >= 0 && hasRegionalAvailability) {
    if (releaseAge <= 30) scoreBreakdown.hotRelease = 100;
    else if (releaseAge <= 90) scoreBreakdown.recentRelease = 60;
    else if (releaseAge <= 180) scoreBreakdown.midRelease = 25;
  }

  const addedAge = daysSince(input.createdAt);
  if (addedAge !== null && addedAge <= 14) {
    scoreBreakdown.recentlyAdded = 35;
  }

  const updatedAge = daysSince(input.updatedAt);
  if (updatedAge !== null && updatedAge <= 7) {
    scoreBreakdown.recentUserAction = 25;
  }

  if (input.availability?.isPreferred) {
    scoreBreakdown.favoriteProvider = 95;
  } else if (input.availability?.type === "subscription") {
    scoreBreakdown.streaming = 55;
  } else if (input.availability?.type === "rent" || input.availability?.type === "buy") {
    scoreBreakdown.vod = 30;
  }

  if (input.runtime && input.runtime <= 100) {
    scoreBreakdown.shortMovie = 20;
  }

  if (input.libraryStatus && BLOCKED_LIBRARY_STATUSES.includes(input.libraryStatus)) {
    scoreBreakdown.blockedPenalty = -9999;
  }

  const total = Object.values(scoreBreakdown).reduce((sum, value) => sum + value, 0);
  return { score: total, scoreBreakdown };
}

function pickBalancedCandidates(candidates: HeroCandidate[], limit: number): HeroCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const series = sorted.filter((c) => c.mediaType === "tv");
  const movies = sorted.filter((c) => c.mediaType === "movie");

  const picked: HeroCandidate[] = [];
  const pickedIds = new Set<string>();

  function add(candidate?: HeroCandidate) {
    if (!candidate || pickedIds.has(candidate.id)) return;
    pickedIds.add(candidate.id);
    picked.push(candidate);
  }

  add(series[0]);
  add(movies[0]);
  add(series[1]);
  add(movies[1]);

  for (const candidate of sorted) {
    if (picked.length >= limit) break;
    add(candidate);
  }

  return picked;
}

function applyHeroFreshnessAndRotation(candidates: HeroCandidate[]): HeroCandidate[] {
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86_400_000);

  return candidates.map((candidate) => {
    const stableSeed = (candidate.tmdbId + dayOfYear) % 5;
    const rotationBonus = stableSeed * 6;

    let stagnationPenalty = 0;
    const daysSinceInteraction = daysSince(candidate.progress?.lastWatchedAt);
    
    if (daysSinceInteraction !== null && daysSinceInteraction > 10) {
      stagnationPenalty = Math.min(daysSinceInteraction * 1.5, 35);
    }

    const newScore = candidate.score + rotationBonus - stagnationPenalty;

    return {
      ...candidate,
      score: newScore,
      debug: {
        ...candidate.debug,
        rotationBonus,
        stagnationPenalty,
        originalScore: candidate.score,
      },
    };
  });
}

function applyHeroDiversity(candidates: HeroCandidate[], limit: number): HeroCandidate[] {
  const picked: HeroCandidate[] = [];
  
  const contextCount = new Map<string, number>();
  const providerCount = new Map<string, number>();
  const titleIds = new Set<number>();
  const contextHistory: string[] = [];

  const sorted = [...candidates]
    .sort((a, b) => b.score - a.score)
    .map((candidate) => {
      let diversityPenalty = 0;

      const provider = candidate.availability?.providerName;
      if (provider) {
        const providerUses = providerCount.get(provider) ?? 0;
        diversityPenalty += providerUses * 45;
      }

      const contextUses = contextCount.get(candidate.context) ?? 0;
      diversityPenalty += contextUses * 65;

      const lastContext = contextHistory.at(-1);
      if (lastContext && lastContext === candidate.context) {
        diversityPenalty += 50; 
      }

      if (provider) providerCount.set(provider, (providerCount.get(provider) ?? 0) + 1);
      contextCount.set(candidate.context, contextUses + 1);
      contextHistory.push(candidate.context);

      return {
        ...candidate,
        score: candidate.score - diversityPenalty,
        debug: {
          ...candidate.debug,
          diversityPenalty,
          contextRotationApplied: lastContext === candidate.context,
        },
      };
    })
    .sort((a, b) => b.score - a.score);

  contextCount.clear();
  providerCount.clear();

  for (const candidate of sorted) {
    if (picked.length >= limit) break;
    if (titleIds.has(candidate.tmdbId)) continue;

    const currentContextCount = contextCount.get(candidate.context) ?? 0;
    if (currentContextCount >= 2) continue;

    const provider = providerCount.get(candidate.availability?.providerName ?? "") ?? 0;
    if (candidate.availability?.providerName && provider >= 2) continue;

    picked.push(candidate);
    titleIds.add(candidate.tmdbId);

    contextCount.set(candidate.context, currentContextCount + 1);
    if (candidate.availability?.providerName) {
      providerCount.set(candidate.availability.providerName, provider + 1);
    }
  }

  return picked.map((candidate, index) => {
    let primaryActionText = "Assistir agora";
    let primaryActionIcon: "play" | "sparkles" | "flag" = "play";

    if (candidate.context === "finish_season") {
      primaryActionText = "Terminar temporada";
      primaryActionIcon = "flag";
    } else if (candidate.context === "new_episode") {
      primaryActionText = "Ver novo episódio";
      primaryActionIcon = "sparkles";
    } else if (candidate.context === "resume" || candidate.context === "continue" || candidate.context === "binge") {
      primaryActionText = "Continuar assistindo";
      primaryActionIcon = "play";
    }

    return {
      ...candidate,
      priority: index + 1,
      actions: {
        primary: candidate.actions.primary,
        secondary: "open_title",
        serverCta: {
          primary: primaryActionText,
          icon: primaryActionIcon
        }
      },
      debug: {
        ...candidate.debug,
        diversityApplied: true,
        finalScore: candidate.score,
      },
    };
  });
}

async function getAvailabilityMap(input: {
  tmdbIds: number[];
  mediaType: MediaType;
  region: "BR" | "US";
  favoriteProviderIds: string[];
}) {
  const map = new Map<number, ContinuityAvailability | null>();
  if (input.tmdbIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("poplog3_title_availability")
    .select("*")
    .eq("media_type", input.mediaType)
    .eq("country", input.region)
    .in("tmdb_id", input.tmdbIds);

  if (error) {
    console.error("[continuity/hero-candidates] availability query failed", error);
    return map;
  }

  const grouped = new Map<number, AvailabilityRow[]>();
  for (const row of (data ?? []) as AvailabilityRow[]) {
    const current = grouped.get(row.tmdb_id) ?? [];
    current.push(row);
    grouped.set(row.tmdb_id, current);
  }

  for (const tmdbId of input.tmdbIds) {
    map.set(
      tmdbId,
      chooseBestAvailability(
        grouped.get(tmdbId) ?? [],
        input.favoriteProviderIds,
        input.region,
        tmdbId
      ),
    );
  }

  return map;
}

async function getTitleMap(mediaType: MediaType, tmdbIds: number[]) {
  const map = new Map<number, TitleRow>();
  if (tmdbIds.length === 0) return map;

  const { data, error } = await supabaseAdmin
    .from("poplog3_titles")
    .select(
      [
        "tmdb_id",
        "media_type",
        "title",
        "overview",
        "poster_path",
        "backdrop_path",
        "release_date",
        "first_air_date",
        "runtime",
        "number_of_episodes",
        "tmdb_payload",
      ].join(", "),
    )
    .in("tmdb_id", tmdbIds);

  if (error) {
    console.error("[continuity/hero-candidates] titles query failed", error);
    return map;
  }

 for (const row of ((data ?? []) as unknown as TitleRow[])) {
  if (row.media_type === mediaType || !map.has(row.tmdb_id)) {
    map.set(row.tmdb_id, { ...row, status: null });
  }
}

  return map;
}

async function getMovieUserTitles(userId: string, limit: number) {
  const { data, error } = await supabaseAdmin
    .from("poplog3_user_titles")
    .select("tmdb_id, media_type, status, favorite, liked, created_at, updated_at")
    .eq("user_id", userId)
    .eq("media_type", "movie")
    .in("status", ACTIVE_LIBRARY_STATUSES)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[continuity/hero-candidates] movies query failed", error);
    return [];
  }
  return (data ?? []) as UserTitleRow[];
}

export async function getHeroCandidates(
  userId: string,
  options: HeroCandidatesOptions = {},
): Promise<HeroCandidatesResult> {
  const limit = options.limit ?? DEFAULT_LIMIT;

  const preferences = normalizeProviderPreferences(
    await getUserProviderPreferences(),
  );
  const region = options.region ?? preferences.region;

  const [watchingSeries, movieUserTitles] = await Promise.all([
    getUserWatchingSeries(userId, 30),
    getMovieUserTitles(userId, 50),
  ]);

  const seriesIds = watchingSeries.map((series) => series.seriesTmdbId);
  const movieIds = movieUserTitles.map((movie) => movie.tmdb_id);

  const [
    seriesAvailabilityMap,
    movieAvailabilityMap,
    seriesTitleMap,
    movieTitleMap,
  ] = await Promise.all([
    getAvailabilityMap({
      tmdbIds: seriesIds,
      mediaType: "tv",
      region,
      favoriteProviderIds: preferences.favoriteProviderIds,
    }),
    getAvailabilityMap({
      tmdbIds: movieIds,
      mediaType: "movie",
      region,
      favoriteProviderIds: preferences.favoriteProviderIds,
    }),
    getTitleMap("tv", seriesIds),
    getTitleMap("movie", movieIds),
  ]);

  const missingSeriesIds = seriesIds.filter((id) => !seriesTitleMap.has(id));
  if (missingSeriesIds.length > 0) {
    console.log("[continuity/hero-candidates] syncing missing series", missingSeriesIds);
    await Promise.allSettled(
      missingSeriesIds.map((id) =>
        syncTmdbTitle("tv", id).catch((error) => {
          console.error("[continuity/hero-candidates] failed syncing series", id, error);
          return null;
        }),
      ),
    );

    const refreshedSeriesTitleMap = await getTitleMap("tv", missingSeriesIds);
    for (const [id, title] of refreshedSeriesTitleMap.entries()) {
      seriesTitleMap.set(id, title);
    }
  }

  const seriesCandidates: HeroCandidate[] = watchingSeries
    .map((series) => {
      const title = seriesTitleMap.get(series.seriesTmdbId);
      const availability = seriesAvailabilityMap.get(series.seriesTmdbId) ?? null;

      const totalEpisodes = series.totalEpisodes ?? getTotalEpisodes(title) ?? null;
      const watchedEpisodes = series.watchedCount;
      const remainingEpisodes = typeof totalEpisodes === "number" ? Math.max(totalEpisodes - watchedEpisodes, 0) : null;

      const percentage = totalEpisodes && totalEpisodes > 0
        ? Math.min(Math.round((watchedEpisodes / totalEpisodes) * 100), 100)
        : 0;

      const context = resolveSeriesContext({
        progressPercentage: percentage,
        remainingEpisodes,
        lastWatchedAt: series.lastWatchedAt,
        libraryStatus: series.inLibraryStatus,
        availability,
        nextEpisodeAirDate: series.nextEpisode?.airDate ?? null,
      });

      const { score, scoreBreakdown } = buildSeriesScore({
        context,
        progressPercentage: percentage,
        watchedCount: watchedEpisodes,
        totalEpisodes,
        remainingEpisodes,
        lastWatchedAt: series.lastWatchedAt,
        mediaStatus: getTitleStatus(title) ?? series.mediaStatus,
        libraryStatus: series.inLibraryStatus,
        availability,
        releaseDate: getFirstAirDate(title),
      });

      const contextLabel = buildContextLabel({ context, remainingEpisodes, progressPercentage: percentage, availability });
      const genreLabels = (title?.tmdb_payload?.genres ?? []).slice(0, 2).map(g => g.name);

      const eyebrowColorMap = {
        new_episode: "#f43f5e",
        finish_season: "#d97706",
        resume: "#a855f7",
        binge: "#8b5cf6",
        new_streaming: "#06b6d4",
        continue: "#6366f1",
        rediscovery: "#9ca3af",
        watchlist: "#14b8a6",
        vod: "#10b981"
      };

      return {
        id: "tv-" + series.seriesTmdbId,
        tmdbId: series.seriesTmdbId,
        mediaType: "tv",
        title: getTitleName(title) ?? series.title ?? `Série #${series.seriesTmdbId}`,
        overview: getOverview(title),
        year: getYear(getFirstAirDate(title)),
        posterPath: series.posterPath ?? getPosterPath(title),
        backdropPath: series.backdropPath ?? getBackdropPath(title),
        score,
        priority: 999,
        context,
        contextLabel,
        reason: contextLabel,
        labels: genreLabels.length > 0 ? genreLabels : ["Série"],
        progress: {
          percentage,
          watchedEpisodes,
          totalEpisodes,
          currentSeason: series.nextEpisode?.seasonNumber ? series.nextEpisode.seasonNumber : null,
          currentEpisode: series.nextEpisode?.episodeNumber ? Math.max(series.nextEpisode.episodeNumber - 1, 0) : null,
          nextSeason: series.nextEpisode?.seasonNumber ?? null,
          nextEpisode: series.nextEpisode?.episodeNumber ?? null,
          nextEpisodeAirDate: series.nextEpisode?.airDate ?? null,
          runtimeMinutes: null,
          remainingMinutes: null,
          lastWatchedAt: series.lastWatchedAt,
        },
        availability,
        actions: {
          primary: context === "finish_season" ? "finish_season" : context === "resume" ? "resume" : "continue",
          secondary: "open_title",
        },
        serverEyebrow: {
          text: contextLabel.toUpperCase(),
          color: eyebrowColorMap[context] ?? "#6366f1"
        },
        debug: {
          source: "poplog3_user_episodes",
          titleFoundInCache: Boolean(title),
          hydratedFromPayload: Boolean(title?.tmdb_payload),
          scoreBreakdown,
        },
      } satisfies HeroCandidate;
    })
    .filter((candidate) => candidate.score > 0);

  const movieCandidates: HeroCandidate[] = movieUserTitles
    .map((userTitle) => {
      const title = movieTitleMap.get(userTitle.tmdb_id);
      if (!title) return null;

      const availability = movieAvailabilityMap.get(userTitle.tmdb_id) ?? null;
      const releaseDate = getReleaseDate(title);
      const releaseAge = daysSince(releaseDate);

      let context: ContinuityContext = "watchlist";
      if (userTitle.status === "watching") {
        context = "resume";
      } else if (availability?.type === "rent" || availability?.type === "buy") {
        context = "vod";
      } else if (availability) {
        context = "new_streaming";
      }

      if (releaseAge !== null && releaseAge <= 120 && availability) {
        context = availability.type === "subscription" ? "new_streaming" : "vod";
      }

      const runtime = getRuntime(title);
      const { score, scoreBreakdown } = buildMovieScore({
        libraryStatus: userTitle.status,
        createdAt: userTitle.created_at,
        updatedAt: userTitle.updated_at,
        releaseDate,
        runtime,
        availability,
      });

      const contextLabel = buildContextLabel({ context, remainingEpisodes: null, progressPercentage: 0, availability });
      const genreLabels = (title?.tmdb_payload?.genres ?? []).slice(0, 2).map(g => g.name);

      const eyebrowColorMap = {
        resume: "#a855f7",
        new_streaming: "#06b6d4",
        watchlist: "#14b8a6",
        vod: "#10b981"
      };

      return {
        id: "movie-" + userTitle.tmdb_id,
        tmdbId: userTitle.tmdb_id,
        mediaType: "movie",
        title: getTitleName(title) ?? `Filme #${userTitle.tmdb_id}`,
        overview: getOverview(title),
        year: getYear(releaseDate),
        posterPath: getPosterPath(title),
        backdropPath: getBackdropPath(title),
        score,
        priority: 999,
        context,
        contextLabel,
        reason: contextLabel,
        labels: genreLabels.length > 0 ? genreLabels : ["Filme"],
        progress: {
          percentage: userTitle.status === "watching" ? 1 : 0,
          runtimeMinutes: runtime,
          remainingMinutes: runtime,
          lastWatchedAt: userTitle.updated_at,
        },
        availability,
        actions: {
          primary: context === "new_streaming" || context === "vod" ? "watch_now" : context === "resume" ? "resume" : "open_title",
          secondary: "open_title",
        },
        serverEyebrow: {
          text: contextLabel.toUpperCase(),
          color: eyebrowColorMap[context] ?? "#14b8a6"
        },
        debug: {
          source: "poplog3_user_titles",
          hydratedFromPayload: Boolean(title.tmdb_payload),
          scoreBreakdown,
        },
      } satisfies HeroCandidate;
    })
   
    .filter((candidate) => candidate !== null)
.filter((candidate) => candidate.score > 0) as HeroCandidate[];

  const rawWithFreshness = applyHeroFreshnessAndRotation([...seriesCandidates, ...movieCandidates]);
  const balancedCandidates = pickBalancedCandidates(rawWithFreshness, limit * 2);
  const withTemporalCooldown = await applyHeroTemporalCooldown(userId, balancedCandidates);
  const candidates = applyHeroDiversity(withTemporalCooldown, limit);

  return {
    candidates,
    generatedAt: new Date().toISOString(),
  };
}