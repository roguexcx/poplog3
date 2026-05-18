import { supabaseAdmin } from "@/server/supabase/admin";
import {
  getUserWatchingSeries,
  type UserWatchingSeriesRow,
  type EpisodeKey,
} from "@/server/episodes/episode-progress-service";
import { getUserProviderPreferences } from "@/server/streaming/user-provider-preferences";
import { normalizeProviderPreferences } from "@/server/streaming/provider-preferences";
import { normalizeProvider } from "@/server/streaming/provider-normalization";
import {
  normalizeAvailabilityTypeOrNull,
  resolveProviderConfidence,
} from "@/server/streaming/availability-service";
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
  watched_at: string | null;
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

const HERO_CONTINUITY_RATIO = 0.7;
const HERO_DISCOVERY_RATIO = 0.2;
const HERO_SURPRISE_RATIO = 0.1;

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

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function shuffleCandidates<T>(items: T[]): T[] {
  return [...items].sort(() => Math.random() - 0.5);
}

type RecentActivityBoost = {
  rank: 1 | 2;
  boost: number;
  source: "episode_progress" | "library_update";
  activityAt: string;
  daysSinceActivity: number | null;
};

function resolveRecentActivityBoost(
  rank: 1 | 2,
  activityAt: string,
): Omit<RecentActivityBoost, "source"> {
  const daysSinceActivity = daysSince(activityAt);
  const baseBoost = rank === 1 ? 35 : 22;

  let decayMultiplier = 1;
  if (daysSinceActivity !== null) {
    if (daysSinceActivity <= 2) decayMultiplier = 1;
    else if (daysSinceActivity <= 7) decayMultiplier = 0.8;
    else if (daysSinceActivity <= 21) decayMultiplier = 0.55;
    else decayMultiplier = 0.25;
  }

  return {
    rank,
    boost: Math.round(baseBoost * decayMultiplier),
    activityAt,
    daysSinceActivity,
  };
}

function isWatchlistLike(status?: string | null): boolean {
  return status === "watchlist" || status === "paused";
}

function isContinuityContext(context: ContinuityContext): boolean {
  return [
    "continue",
    "resume",
    "finish_season",
    "binge",
    "new_episode",
  ].includes(context);
}

function isDiscoveryContext(context: ContinuityContext): boolean {
  return ["watchlist", "new_streaming", "vod", "rediscovery"].includes(context);
}

function getTitleName(title?: TitleRow | null): string | null {
  return (
    title?.title ??
    title?.tmdb_payload?.title ??
    title?.tmdb_payload?.name ??
    null
  );
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
  return (
    title?.number_of_episodes ?? title?.tmdb_payload?.number_of_episodes ?? null
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GUARD GLOBAL: isRealContinuityCandidate
// Bloqueia séries sem conteúdo real aired antes de entrarem no pipeline.
// Previne falsos positivos de continuidade por temporadas fantasma.
// ─────────────────────────────────────────────────────────────────────────────
function isRealContinuityCandidate(series: {
  watchedCount: number;
  airedEpisodes: number;
  nextEpisode: { seasonNumber: number; episodeNumber: number } | null;
}): boolean {
  // Série sem nenhum episódio aired não é candidata (fantasma total)
  if (series.airedEpisodes === 0) return false;

  // Série com progresso mas sem nextEpisode: válida (pode estar em dia)
  // Série sem progresso e sem nextEpisode: bloqueada (nada para assistir)
  if (series.watchedCount === 0 && series.nextEpisode === null) return false;

  return true;
}

function resolveSeriesContext(input: {
  progressPercentage: number;
  remainingAiredEpisodes: number | null;
  lastWatchedAt: string | null;
  libraryStatus: string | null;
  availability: ContinuityAvailability | null;
  releaseDate?: string | null;
  nextEpisodeAirDate: string | null;
}): ContinuityContext {
  const daysFromLastWatch = daysSince(input.lastWatchedAt);

  if (input.nextEpisodeAirDate) {
    const daysSinceNextEp = daysSince(input.nextEpisodeAirDate);
    const isAired = daysSinceNextEp !== null && daysSinceNextEp >= 0;

    if (isAired) {
      const userStillEngaged =
        daysFromLastWatch !== null && daysFromLastWatch <= 120;
      const manageableBacklog =
        input.remainingAiredEpisodes === null || input.remainingAiredEpisodes <= 24;

      const newSinceLastWatch =
        input.lastWatchedAt !== null &&
        new Date(input.nextEpisodeAirDate) > new Date(input.lastWatchedAt);

      const recentAndActive =
        daysFromLastWatch !== null &&
        daysFromLastWatch <= 90 &&
        daysSinceNextEp !== null &&
        daysSinceNextEp <= 90;

      if (
        userStillEngaged &&
        manageableBacklog &&
        (newSinceLastWatch || recentAndActive)
      ) {
        return "new_episode";
      }
    }
  }

  if (
    input.remainingAiredEpisodes !== null &&
    input.remainingAiredEpisodes > 0 &&
    input.remainingAiredEpisodes <= 3 &&
    input.progressPercentage >= 60
  ) {
    return "finish_season";
  }

  if (
    daysFromLastWatch !== null &&
    daysFromLastWatch <= 7 &&
    input.remainingAiredEpisodes !== null &&
    input.remainingAiredEpisodes >= 1 &&
    input.remainingAiredEpisodes <= 8
  ) {
    return "binge";
  }

  if (input.libraryStatus === "paused") {
    return "resume";
  }

  if (
    input.availability?.isPreferred &&
    input.availability.type === "subscription"
  ) {
    return "new_streaming";
  }

  if (
    daysFromLastWatch !== null &&
    daysFromLastWatch >= 30 &&
    input.remainingAiredEpisodes !== null &&
    input.remainingAiredEpisodes <= 20
  ) {
    return "rediscovery";
  }

  return "continue";
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER ENGINE
// TMDB é fonte principal. Watchmode/MOTN confirmam e enriquecem.
// Hierarquia: subscription > free/ads > rent/buy (independente de fonte).
// Providers favoritos do usuário sobem em qualquer nível.
// ─────────────────────────────────────────────────────────────────────────────

function typeScore(type: ContinuityAvailability["type"]): number {
  switch (type) {
    case "subscription": return 800;
    case "free":         return 400;
    case "ads":          return 200;
    case "rent":         return 40;
    case "buy":          return 20;
    default:             return 0;
  }
}

function confidenceScore(
  confidence: ContinuityAvailability["confidence"],
): number {
  // TMDB é confiável — recebe score alto. Watchmode/MOTN confirmam.
  switch (confidence) {
    case "mixed_confirmed":           return 100;
    case "user_relevant_confirmed":   return 95;
    case "watchmode_confirmed":       return 90;
    case "movieofthenight_confirmed": return 85;
    case "tmdb_only":                 return 80; // era 10 — corrigido: TMDB é confiável
    case "predicted_window":          return 30;
    default:                          return 0;
  }
}

function normalizeProviderKey(value?: string | number | null): string | null {
  if (value === null || value === undefined) return null;
  return String(value)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

function isVodType(type: ContinuityAvailability["type"]): boolean {
  return type === "rent" || type === "buy";
}

function chooseBestAvailability(
  rows: AvailabilityRow[],
  favoriteProviderIds: string[],
  region: "BR" | "US",
  tmdbId: number,
): ContinuityAvailability | null {

  const favoriteSet = new Set(
    favoriteProviderIds
      .map((favorite) => normalizeProviderKey(favorite))
      .filter((favorite): favorite is string => Boolean(favorite)),
  );

  const candidates = rows
    .filter((row) => row.country === region)
    .map((row) => {
      const providerId =
        typeof row.provider_id === "number" ? row.provider_id : null;
      const type = normalizeAvailabilityTypeOrNull(row.availability_type);
      const confidence = resolveProviderConfidence(row.source);

      const providerIdKey = normalizeProviderKey(providerId);
      const providerNameKey = normalizeProviderKey(row.provider_name);

      const isPreferred = Boolean(
        (providerIdKey && favoriteSet.has(providerIdKey)) ||
        (providerNameKey && favoriteSet.has(providerNameKey)),
      );

      // Hierarquia de prioridade — subscription SEMPRE vence rent/buy/VOD.
      // Providers favoritos do usuário sobem dentro do seu nível.
      let providerPreferenceScore = 0;
      if (isPreferred && type === "subscription")
        providerPreferenceScore = 100_000;
      else if (isPreferred && !isVodType(type))
        providerPreferenceScore = 80_000;
      else if (type === "subscription") providerPreferenceScore = 40_000;
      else if (type === "free" || type === "ads")
        providerPreferenceScore = 10_000;
      else if (isPreferred && isVodType(type)) providerPreferenceScore = 1_000;
      // rent/buy sem preferência: apenas typeScore (40/20)

      const score =
        providerPreferenceScore + typeScore(type) + confidenceScore(confidence);

      const normalizedProvider = normalizeProvider(
        row.provider_name,
        row.provider_logo_path ?? row.logo_path ?? null,
      );

      const providerName = normalizedProvider?.name ?? row.provider_name ?? null;
      const providerLogoPath =
        normalizedProvider?.logoPath ??
        row.provider_logo_path ??
        row.logo_path ??
        null;

      return {
        score,
        availability: {
          region,
          providerName,
          providerLogoPath,
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
  remainingAiredEpisodes: number | null;
  progressPercentage: number;
  availability?: ContinuityAvailability | null;
}): string {
  const remaining = input.remainingAiredEpisodes;

  if (remaining !== null && remaining > 15 && input.context !== "new_episode") {
    return "Continuar assistindo";
  }

  switch (input.context) {
    case "new_episode":
      return "Novo episódio disponível";
    case "finish_season":
      if (remaining === 1) return "Último episódio da temporada";
      if (remaining === 2) return "Faltam apenas 2 episódios";
      if (remaining === 3) return "Faltam apenas 3 episódios";
      return "Boa para terminar hoje";
    case "resume":
      return "Perfeito para continuar agora";
    case "new_streaming":
      if (input.availability?.isPreferred && input.availability.providerName) {
        return `No seu streaming favorito: ${input.availability.providerName}`;
      }
      return input.availability?.providerName
        ? `Disponível na ${input.availability.providerName}`
        : "Chegou no streaming";
    case "vod":
      return "Disponível em VOD";
    case "watchlist":
      return "Salvo na sua Watchlist";
    case "binge":
      return "Maratona recomendada";
    case "rediscovery":
      return "Vale a pena revisitar";
    case "continue":
    default:
      if (
        input.progressPercentage >= 90 &&
        remaining !== null &&
        remaining <= 2
      )
        return "Você já está quase em dia";
      return "Continuar assistindo";
  }
}

function buildSeriesScore(input: {
  context: ContinuityContext;
  progressPercentage: number;
  watchedCount: number;
  airedEpisodes: number;
  remainingAiredEpisodes: number | null;
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
      if (days <= 2) scoreBreakdown.recentActivity = 90;
      else if (days <= 7) scoreBreakdown.recentActivity = 60;
      else if (days <= 21) scoreBreakdown.recentActivity = 30;
      else if (days <= 45) scoreBreakdown.recentActivity = 10;
      else if (days <= 90) scoreBreakdown.oldActivityPenalty = -20;
      else scoreBreakdown.oldActivityPenalty = -45;
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
    scoreBreakdown.pausedPenalty = -20;
  }

  if (input.libraryStatus === "watchlist" && input.watchedCount === 0) {
    scoreBreakdown.unstartedSeriesDiscovery = 65;
  }

  // Usa episódios aired como referência — nunca futuros
  const remaining = input.remainingAiredEpisodes;
  const isRecent = input.releaseDate
    ? (getYear(input.releaseDate) ?? 0) >= 2025
    : false;

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
    case "new_episode":
      scoreBreakdown.contextNewEpisode = 85;
      break;
    case "finish_season":
      scoreBreakdown.contextFinishSeason = 95;
      break;
    case "binge":
      scoreBreakdown.contextBinge = 60;
      break;
    case "new_streaming":
      scoreBreakdown.contextNewStreaming = 85;
      break;
    case "resume":
      scoreBreakdown.contextResume = 50;
      break;
    case "rediscovery":
      scoreBreakdown.contextRediscovery = 40;
      break;
    default:
      scoreBreakdown.contextContinue = 20;
      break;
  }

  if (
    input.libraryStatus &&
    BLOCKED_LIBRARY_STATUSES.includes(input.libraryStatus)
  ) {
    scoreBreakdown.blockedPenalty = -9999;
  }

  const total = Object.values(scoreBreakdown).reduce(
    (sum, value) => sum + value,
    0,
  );
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
    scoreBreakdown.watchlist = 50;

    const addedAge = daysSince(input.createdAt);
    if (addedAge !== null && addedAge >= 30) {
      scoreBreakdown.forgottenWatchlist = Math.min(
        70,
        25 + Math.floor(addedAge / 14) * 5,
      );
    }
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
  } else if (
    releaseAge !== null &&
    releaseAge >= 0 &&
    hasRegionalAvailability
  ) {
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

  // Hierarquia clara: subscription sempre vence rent/buy
  if (input.availability?.isPreferred && input.availability.type === "subscription") {
    scoreBreakdown.favoriteProviderSubscription = 120;
  } else if (input.availability?.isPreferred) {
    scoreBreakdown.favoriteProvider = 95;
  } else if (input.availability?.type === "subscription") {
    scoreBreakdown.streaming = 55;
  } else if (input.availability?.type === "free" || input.availability?.type === "ads") {
    scoreBreakdown.freeStreaming = 35;
  } else if (
    input.availability?.type === "rent" ||
    input.availability?.type === "buy"
  ) {
    scoreBreakdown.vod = 30;
  }

  if (input.runtime && input.runtime <= 100) {
    scoreBreakdown.shortMovie = 20;
  }

  if (
    input.libraryStatus &&
    BLOCKED_LIBRARY_STATUSES.includes(input.libraryStatus)
  ) {
    scoreBreakdown.blockedPenalty = -9999;
  }

  const total = Object.values(scoreBreakdown).reduce(
    (sum, value) => sum + value,
    0,
  );
  return { score: total, scoreBreakdown };
}

function pickWeightedRandom(
  candidates: HeroCandidate[],
  usedIds: Set<string>,
  options: { preferLowerScore?: boolean } = {},
): HeroCandidate | null {
  const available = candidates.filter(
    (candidate) => !usedIds.has(candidate.id),
  );
  if (available.length === 0) return null;

  const pool = shuffleCandidates(available).slice(
    0,
    Math.min(12, available.length),
  );
  const minScore = Math.min(...pool.map((candidate) => candidate.score));
  const maxScore = Math.max(...pool.map((candidate) => candidate.score));

  const weighted = pool.map((candidate) => {
    const normalized =
      maxScore === minScore
        ? 1
        : (candidate.score - minScore) / Math.max(maxScore - minScore, 1);

    const scoreWeight = options.preferLowerScore
      ? 1.2 - normalized
      : 0.35 + normalized;

    const watchlistSurpriseBoost =
      candidate.context === "watchlist" ||
      candidate.debug?.slotBucket === "surprise"
        ? 0.55
        : 0;

    return {
      candidate,
      weight: Math.max(
        0.1,
        scoreWeight + watchlistSurpriseBoost + randomBetween(0, 0.45),
      ),
    };
  });

  const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * totalWeight;

  for (const item of weighted) {
    cursor -= item.weight;
    if (cursor <= 0) return item.candidate;
  }

  return weighted[0]?.candidate ?? null;
}

function classifyHeroBucket(
  candidate: HeroCandidate,
): "continuity" | "discovery" | "surprise" {
  if (candidate.debug?.slotBucket === "surprise") return "surprise";
  if (
    isContinuityContext(candidate.context) &&
    candidate.progress?.watchedEpisodes
  )
    return "continuity";
  if (isDiscoveryContext(candidate.context)) return "discovery";
  return candidate.mediaType === "movie" ? "discovery" : "continuity";
}

function pickBalancedCandidates(
  candidates: HeroCandidate[],
  limit: number,
): HeroCandidate[] {
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const usedIds = new Set<string>();
  const picked: HeroCandidate[] = [];

  const continuity = sorted.filter(
    (candidate) => classifyHeroBucket(candidate) === "continuity",
  );
  const discovery = sorted.filter(
    (candidate) => classifyHeroBucket(candidate) === "discovery",
  );
  const surprise = sorted.filter(
    (candidate) => classifyHeroBucket(candidate) === "surprise",
  );

  const targetContinuity = Math.max(
    1,
    Math.round(limit * HERO_CONTINUITY_RATIO),
  );
  const targetDiscovery = Math.max(1, Math.round(limit * HERO_DISCOVERY_RATIO));
  const targetSurprise =
    limit >= 5 ? Math.max(1, Math.round(limit * HERO_SURPRISE_RATIO)) : 0;

  function add(candidate: HeroCandidate | null) {
    if (!candidate || usedIds.has(candidate.id) || picked.length >= limit)
      return;
    usedIds.add(candidate.id);
    picked.push(candidate);
  }

  add(pickWeightedRandom(continuity, usedIds));
  add(pickWeightedRandom(continuity, usedIds));
  add(pickWeightedRandom(sorted, usedIds));
  add(pickWeightedRandom(discovery, usedIds));
  add(
    pickWeightedRandom(surprise.length > 0 ? surprise : discovery, usedIds, {
      preferLowerScore: true,
    }),
  );

  while (
    picked.filter((candidate) => classifyHeroBucket(candidate) === "continuity")
      .length < targetContinuity
  ) {
    const before = picked.length;
    add(pickWeightedRandom(continuity, usedIds));
    if (picked.length === before) break;
  }

  while (
    picked.filter((candidate) => classifyHeroBucket(candidate) === "discovery")
      .length < targetDiscovery
  ) {
    const before = picked.length;
    add(pickWeightedRandom(discovery, usedIds));
    if (picked.length === before) break;
  }

  while (
    picked.filter((candidate) => classifyHeroBucket(candidate) === "surprise")
      .length < targetSurprise
  ) {
    const before = picked.length;
    add(pickWeightedRandom(surprise, usedIds, { preferLowerScore: true }));
    if (picked.length === before) break;
  }

  for (const candidate of shuffleCandidates(sorted)) {
    if (picked.length >= limit) break;
    add(candidate);
  }

  return picked;
}

function applyHeroFreshnessAndRotation(
  candidates: HeroCandidate[],
): HeroCandidate[] {
  const dayOfYear = Math.floor(
    (Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) /
      86_400_000,
  );

  return candidates.map((candidate) => {
    const stableSeed = (candidate.tmdbId + dayOfYear) % 5;
    const rotationBonus = stableSeed * 5;
    const requestJitter = randomBetween(0, 45);

    let stagnationPenalty = 0;
    const daysSinceInteraction = daysSince(candidate.progress?.lastWatchedAt);

    if (
      daysSinceInteraction !== null &&
      daysSinceInteraction > 21 &&
      candidate.context !== "watchlist"
    ) {
      stagnationPenalty = Math.min(daysSinceInteraction * 1.1, 35);
    }

    const newEpisodeSoftCap = candidate.context === "new_episode" ? -20 : 0;
    const surpriseBoost =
      candidate.debug?.slotBucket === "surprise" ? randomBetween(15, 55) : 0;

    const newScore =
      candidate.score +
      rotationBonus +
      requestJitter +
      surpriseBoost +
      newEpisodeSoftCap -
      stagnationPenalty;

    return {
      ...candidate,
      score: newScore,
      debug: {
        ...candidate.debug,
        rotationBonus,
        requestJitter,
        surpriseBoost,
        newEpisodeSoftCap,
        stagnationPenalty,
        originalScore: candidate.score,
      },
    };
  });
}

function applyHeroDiversity(
  candidates: HeroCandidate[],
  limit: number,
): HeroCandidate[] {
  const picked: HeroCandidate[] = [];

  const contextCount = new Map<string, number>();
  const providerCount = new Map<string, number>();
  const titleIds = new Set<number>();
  const contextHistory: string[] = [];
  const mediaTypeCount = new Map<MediaType, number>();

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

      if (provider)
        providerCount.set(provider, (providerCount.get(provider) ?? 0) + 1);
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
    if (
      candidate.context === "new_episode" &&
      currentContextCount >= 1 &&
      picked.length < limit - 1
    )
      continue;

    const currentMediaCount = mediaTypeCount.get(candidate.mediaType) ?? 0;
    const maxPerMediaType = limit >= 5 ? 3 : limit;
    if (currentMediaCount >= maxPerMediaType) continue;

    const provider =
      providerCount.get(candidate.availability?.providerName ?? "") ?? 0;
    if (candidate.availability?.providerName && provider >= 2) continue;

    picked.push(candidate);
    titleIds.add(candidate.tmdbId);

    contextCount.set(candidate.context, currentContextCount + 1);
    mediaTypeCount.set(candidate.mediaType, currentMediaCount + 1);
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
    } else if (
      candidate.context === "resume" ||
      candidate.context === "continue" ||
      candidate.context === "binge"
    ) {
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
          icon: primaryActionIcon,
        },
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
    console.error(
      "[continuity/hero-candidates] availability query failed",
      error,
    );
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
        tmdbId,
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
    .eq("media_type", mediaType)
    .in("tmdb_id", tmdbIds);

  if (error) {
    console.error("[continuity/hero-candidates] titles query failed", error);
    return map;
  }

  for (const row of (data ?? []) as unknown as TitleRow[]) {
    if (row.media_type === mediaType || !map.has(row.tmdb_id)) {
      map.set(row.tmdb_id, row);
    }
  }

  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// FAST PATH: lê da tabela materializada user_title_state (1 query).
// Retorna null se o usuário não tiver estado materializado ainda — o caller
// faz fallback para as queries clássicas (getUserWatchingSeries + userTitles).
// ─────────────────────────────────────────────────────────────────────────────
function logoPathFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  // best_provider_logo é URL completa; extrai o path para ContinuityAvailability
  const match = url.match(/\/t\/p\/[^/]+(\/.+)$/);
  return match?.[1] ?? null;
}

async function getUserLibraryFromState(
  userId: string,
  limit: number,
  region: "BR" | "US",
): Promise<{
  watchingSeries: UserWatchingSeriesRow[];
  movieUserTitles: UserTitleRow[];
  tvUserTitles: UserTitleRow[];
  availabilityByTitle: Map<number, ContinuityAvailability | null>;
} | null> {
  const { data, error } = await supabaseAdmin
    .from("user_title_state")
    .select(
      [
        "tmdb_id",
        "media_type",
        "status",
        "favorite",
        "liked",
        "watched_episodes",
        "aired_episodes",
        "total_episodes",
        "next_season",
        "next_episode",
        "next_episode_air_date",
        "last_watched_at",
        "last_event_at",
        "created_at",
        "best_provider_name",
        "best_provider_type",
        "best_provider_logo",
      ].join(", "),
    )
    .eq("user_id", userId)
    .in("status", ["watching", "watchlist"])
    .order("last_event_at", { ascending: false })
    .limit(limit);

  if (error || !data || data.length === 0) return null;

  const watchingSeries: UserWatchingSeriesRow[] = [];
  const tvUserTitles: UserTitleRow[] = [];
  const movieUserTitles: UserTitleRow[] = [];
  const availabilityByTitle = new Map<number, ContinuityAvailability | null>();

  for (const row of (data as unknown) as Array<{
    tmdb_id: number;
    media_type: string;
    status: string | null;
    favorite: boolean | null;
    liked: boolean | null;
    watched_episodes: number;
    aired_episodes: number;
    total_episodes: number | null;
    next_season: number | null;
    next_episode: number | null;
    next_episode_air_date: string | null;
    last_watched_at: string | null;
    last_event_at: string;
    created_at: string;
    best_provider_name: string | null;
    best_provider_type: string | null;
    best_provider_logo: string | null;
  }>) {
    // Reconstrói ContinuityAvailability a partir do estado materializado.
    // isPreferred = false porque não armazenamos o TMDB provider ID no state —
    // o scoring de tipo (subscription > free > rent) ainda se aplica corretamente.
    const avail: ContinuityAvailability | null = row.best_provider_name
      ? {
          region,
          providerName: row.best_provider_name,
          providerLogoPath: logoPathFromUrl(row.best_provider_logo),
          providerId: null,
          type: (row.best_provider_type as ContinuityAvailability["type"]) ?? null,
          confidence: "tmdb_only",
          isPreferred: false,
        }
      : null;

    availabilityByTitle.set(row.tmdb_id, avail);

    if (row.media_type === "tv") {
      if (row.watched_episodes > 0) {
        watchingSeries.push({
          seriesTmdbId: row.tmdb_id,
          watchedCount: row.watched_episodes,
          totalEpisodes: row.total_episodes,
          airedEpisodes: row.aired_episodes,
          lastWatchedAt: row.last_watched_at,
          watchedKeys: [] as EpisodeKey[],
          nextEpisode:
            row.next_season !== null && row.next_episode !== null
              ? {
                  seasonNumber: row.next_season,
                  episodeNumber: row.next_episode,
                  airDate: row.next_episode_air_date,
                }
              : null,
          title: null,
          posterPath: null,
          backdropPath: null,
          mediaStatus: null,
          inLibraryStatus: row.status,
        });
      }

      tvUserTitles.push({
        tmdb_id: row.tmdb_id,
        media_type: "tv",
        status: row.status,
        favorite: row.favorite,
        liked: row.liked,
        created_at: row.created_at,
        watched_at: row.last_event_at,
      });
    } else {
      movieUserTitles.push({
        tmdb_id: row.tmdb_id,
        media_type: "movie",
        status: row.status,
        favorite: row.favorite,
        liked: row.liked,
        created_at: row.created_at,
        watched_at: row.last_event_at,
      });
    }
  }

  return { watchingSeries, movieUserTitles, tvUserTitles, availabilityByTitle };
}

async function getMovieUserTitles(userId: string, limit: number) {
  const { data, error } = await supabaseAdmin
    .from("user_titles")
    .select(
      "tmdb_id, media_type, status, favorite, liked, created_at, watched_at",
    )
    .eq("user_id", userId)
    .eq("media_type", "movie")
    .in("status", ACTIVE_LIBRARY_STATUSES)
    .order("watched_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("[continuity/hero-candidates] movies query failed", error);
    return [];
  }
  return (data ?? []) as UserTitleRow[];
}

async function getTvUserTitles(userId: string, limit: number) {
  const { data, error } = await supabaseAdmin
    .from("user_titles")
    .select(
      "tmdb_id, media_type, status, favorite, liked, created_at, watched_at",
    )
    .eq("user_id", userId)
    .eq("media_type", "tv")
    .in("status", ACTIVE_LIBRARY_STATUSES)
    .order("watched_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error(
      "[continuity/hero-candidates] tv user titles query failed",
      error,
    );
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

  // Fase 1: busca de dados do usuário.
  // Fast path: 1 query em user_title_state (estado materializado).
  // Fallback: batch clássico de 3 funções para usuários sem estado ainda.
  const stateData = await getUserLibraryFromState(userId, 150, region);

  let watchingSeries: UserWatchingSeriesRow[];
  let movieUserTitles: UserTitleRow[];
  let tvUserTitles: UserTitleRow[];

  if (stateData) {
    watchingSeries = stateData.watchingSeries;
    movieUserTitles = stateData.movieUserTitles;
    tvUserTitles = stateData.tvUserTitles;
  } else {
    // Fallback: usuário ainda não tem estado materializado (pré-migração ou novo).
    [watchingSeries, movieUserTitles, tvUserTitles] = await Promise.all([
      getUserWatchingSeries(userId, 30),
      getMovieUserTitles(userId, 60),
      getTvUserTitles(userId, 60),
    ]);
  }

  // Mapeia atividade recente para boost
  const latestActivityByTitle = new Map<
    string,
    { activityAt: string; source: "episode_progress" | "library_update" }
  >();

  function registerActivity(
    key: string,
    activityAt: string | null | undefined,
    source: "episode_progress" | "library_update",
  ) {
    if (!activityAt) return;
    const timestamp = new Date(activityAt).getTime();
    if (!Number.isFinite(timestamp)) return;
    const current = latestActivityByTitle.get(key);
    if (!current || timestamp > new Date(current.activityAt).getTime()) {
      latestActivityByTitle.set(key, { activityAt, source });
    }
  }

  for (const series of watchingSeries) {
    registerActivity(
      `tv-${series.seriesTmdbId}`,
      series.lastWatchedAt,
      "episode_progress",
    );
  }
  for (const title of movieUserTitles) {
    registerActivity(`movie-${title.tmdb_id}`, title.watched_at, "library_update");
  }
  for (const title of tvUserTitles) {
    registerActivity(`tv-${title.tmdb_id}`, title.watched_at, "library_update");
  }

  const recentActivityBoostMap = new Map<string, RecentActivityBoost>();
  Array.from(latestActivityByTitle.entries())
    .sort(
      ([, a], [, b]) =>
        new Date(b.activityAt).getTime() - new Date(a.activityAt).getTime(),
    )
    .slice(0, 2)
    .forEach(([key, activity], index) => {
      const rank = (index + 1) as 1 | 2;
      recentActivityBoostMap.set(key, {
        ...resolveRecentActivityBoost(rank, activity.activityAt),
        source: activity.source,
      });
    });

  const watchingSeriesIds = new Set(
    watchingSeries.map((series) => series.seriesTmdbId),
  );
  const seriesIds = Array.from(
    new Set([
      ...watchingSeries.map((series) => series.seriesTmdbId),
      ...tvUserTitles.map((series) => series.tmdb_id),
    ]),
  );
  const movieIds = movieUserTitles.map((movie) => movie.tmdb_id);

  // Fase 2: metadata + availability.
  // Fast path: availability já vem do user_title_state (0 queries extras).
  // Fallback: 2 queries adicionais em poplog3_title_availability.
  let seriesAvailabilityMap: Map<number, ContinuityAvailability | null>;
  let movieAvailabilityMap: Map<number, ContinuityAvailability | null>;
  let seriesTitleMap: Map<number, TitleRow>;
  let movieTitleMap: Map<number, TitleRow>;

  if (stateData) {
    [seriesTitleMap, movieTitleMap] = await Promise.all([
      getTitleMap("tv", seriesIds),
      getTitleMap("movie", movieIds),
    ]);
    seriesAvailabilityMap = stateData.availabilityByTitle;
    movieAvailabilityMap = stateData.availabilityByTitle;
  } else {
    [
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
  }

  // ─── SERIES COM PROGRESSO ────────────────────────────────────────────────
  const seriesCandidates: HeroCandidate[] = watchingSeries
    .filter((series) => isRealContinuityCandidate(series))
    .map((series) => {
      const title = seriesTitleMap.get(series.seriesTmdbId);
      const availability =
        seriesAvailabilityMap.get(series.seriesTmdbId) ?? null;

      // Usa airedEpisodes como base de progresso — nunca total TMDB
      const watchedEpisodes = series.watchedCount;
      const airedEpisodes = series.airedEpisodes;
      const remainingAiredEpisodes = Math.max(airedEpisodes - watchedEpisodes, 0);

      const percentage =
        airedEpisodes > 0
          ? Math.min(Math.round((watchedEpisodes / airedEpisodes) * 100), 100)
          : 0;

      const context = resolveSeriesContext({
        progressPercentage: percentage,
        remainingAiredEpisodes,
        lastWatchedAt: series.lastWatchedAt,
        libraryStatus: series.inLibraryStatus,
        availability,
        nextEpisodeAirDate: series.nextEpisode?.airDate ?? null,
      });

      const { score, scoreBreakdown } = buildSeriesScore({
        context,
        progressPercentage: percentage,
        watchedCount: watchedEpisodes,
        airedEpisodes,
        remainingAiredEpisodes,
        lastWatchedAt: series.lastWatchedAt,
        mediaStatus: getTitleStatus(title) ?? series.mediaStatus,
        libraryStatus: series.inLibraryStatus,
        availability,
        releaseDate: getFirstAirDate(title),
      });

      const recentActivityBoost =
        recentActivityBoostMap.get(`tv-${series.seriesTmdbId}`) ?? null;

      const contextLabel = buildContextLabel({
        context,
        remainingAiredEpisodes,
        progressPercentage: percentage,
        availability,
      });
      const genreLabels = (title?.tmdb_payload?.genres ?? [])
        .slice(0, 2)
        .map((g) => g.name);

      const eyebrowColorMap: Record<string, string> = {
        new_episode: "#f43f5e",
        finish_season: "#d97706",
        resume: "#a855f7",
        binge: "#8b5cf6",
        new_streaming: "#06b6d4",
        continue: "#6366f1",
        rediscovery: "#9ca3af",
        watchlist: "#14b8a6",
        vod: "#10b981",
      };

      return {
        id: "tv-" + series.seriesTmdbId,
        tmdbId: series.seriesTmdbId,
        mediaType: "tv",
        title:
          getTitleName(title) ??
          series.title ??
          `Série #${series.seriesTmdbId}`,
        overview: getOverview(title),
        year: getYear(getFirstAirDate(title)),
        posterPath: series.posterPath ?? getPosterPath(title),
        backdropPath: series.backdropPath ?? getBackdropPath(title),
        score: score + (recentActivityBoost?.boost ?? 0),
        priority: 999,
        context,
        contextLabel,
        reason: contextLabel,
        labels: genreLabels.length > 0 ? genreLabels : ["Série"],
        progress: {
          percentage,
          watchedEpisodes,
          totalEpisodes: airedEpisodes,       // expõe aired como total para a UI
          currentSeason: series.nextEpisode?.seasonNumber ?? null,
          currentEpisode: series.nextEpisode
            ? Math.max(series.nextEpisode.episodeNumber - 1, 0)
            : null,
          nextSeason: series.nextEpisode?.seasonNumber ?? null,
          nextEpisode: series.nextEpisode?.episodeNumber ?? null,
          nextEpisodeAirDate: series.nextEpisode?.airDate ?? null,
          runtimeMinutes: null,
          remainingMinutes: null,
          lastWatchedAt: series.lastWatchedAt,
        },
        availability,
        actions: {
          primary:
            context === "finish_season"
              ? "finish_season"
              : context === "resume"
                ? "resume"
                : "continue",
          secondary: "open_title",
        },
        serverEyebrow: {
          text: contextLabel.toUpperCase(),
          color: eyebrowColorMap[context] ?? "#6366f1",
        },
        debug: {
          source: "user_episodes",
          titleFoundInCache: Boolean(title),
          hydratedFromPayload: Boolean(title?.tmdb_payload),
          recentActivityBoost,
          airedEpisodes,
          remainingAiredEpisodes,
          scoreBreakdown,
        },
      } satisfies HeroCandidate;
    })
    .filter((candidate) => candidate.score > 0);

  // ─── SERIES NÃO INICIADAS (WATCHLIST / DISCOVERY) ───────────────────────
  const unstartedSeriesCandidates: HeroCandidate[] = tvUserTitles
    .filter((userTitle) => !watchingSeriesIds.has(userTitle.tmdb_id))
    .map((userTitle) => {
      const title = seriesTitleMap.get(userTitle.tmdb_id);
      if (!title) return null;

      const availability = seriesAvailabilityMap.get(userTitle.tmdb_id) ?? null;
      const firstAirDate = getFirstAirDate(title);
      const firstAirAge = daysSince(firstAirDate);

      let context: ContinuityContext = "watchlist";
      if (userTitle.status === "paused") {
        context = "rediscovery";
      } else if (
        availability?.isPreferred ||
        availability?.type === "subscription"
      ) {
        context = "new_streaming";
      }

      if (firstAirAge !== null && firstAirAge <= 120 && availability) {
        context = "new_streaming";
      }

      const totalEps = getTotalEpisodes(title);

      const { score, scoreBreakdown } = buildSeriesScore({
        context,
        progressPercentage: 0,
        watchedCount: 0,
        airedEpisodes: totalEps ?? 0,     // sem dados aired disponíveis aqui
        remainingAiredEpisodes: totalEps,
        lastWatchedAt: userTitle.watched_at,
        mediaStatus: getTitleStatus(title),
        libraryStatus: userTitle.status,
        availability,
        releaseDate: firstAirDate,
      });

      const addedAge = daysSince(userTitle.created_at);
      const surpriseScore =
        addedAge !== null && addedAge >= 30
          ? Math.min(80, 25 + Math.floor(addedAge / 14) * 5)
          : 0;
      const recentActivityBoost =
        recentActivityBoostMap.get(`tv-${userTitle.tmdb_id}`) ?? null;
      const finalScore =
        score + surpriseScore + (recentActivityBoost?.boost ?? 0);

      const contextLabel =
        context === "watchlist"
          ? "Série salva para começar"
          : buildContextLabel({
              context,
              remainingAiredEpisodes: null,
              progressPercentage: 0,
              availability,
            });
      const genreLabels = (title?.tmdb_payload?.genres ?? [])
        .slice(0, 2)
        .map((g) => g.name);

      const eyebrowColorMap: Record<string, string> = {
        new_streaming: "#06b6d4",
        rediscovery: "#9ca3af",
        watchlist: "#14b8a6",
      };

      return {
        id: "tv-" + userTitle.tmdb_id,
        tmdbId: userTitle.tmdb_id,
        mediaType: "tv",
        title: getTitleName(title) ?? `Série #${userTitle.tmdb_id}`,
        overview: getOverview(title),
        year: getYear(firstAirDate),
        posterPath: getPosterPath(title),
        backdropPath: getBackdropPath(title),
        score: finalScore,
        priority: 999,
        context,
        contextLabel,
        reason: contextLabel,
        labels: genreLabels.length > 0 ? genreLabels : ["Série"],
        progress: {
          percentage: 0,
          watchedEpisodes: 0,
          totalEpisodes: getTotalEpisodes(title),
          runtimeMinutes: null,
          remainingMinutes: null,
          lastWatchedAt: userTitle.watched_at,
        },
        availability,
        actions: {
          primary: context === "new_streaming" ? "watch_now" : "open_title",
          secondary: "open_title",
        },
        serverEyebrow: {
          text: contextLabel.toUpperCase(),
          color:
            eyebrowColorMap[context as keyof typeof eyebrowColorMap] ??
            "#14b8a6",
        },
        debug: {
          source: "user_titles_tv_unstarted",
          hydratedFromPayload: Boolean(title.tmdb_payload),
          slotBucket: surpriseScore > 0 ? "surprise" : "discovery",
          surpriseScore,
          recentActivityBoost,
          scoreBreakdown,
        },
      } satisfies HeroCandidate;
    })
    .filter((candidate) => candidate !== null)
    .filter((candidate) => candidate.score > 0) as HeroCandidate[];

  // ─── FILMES ──────────────────────────────────────────────────────────────
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
      } else if (availability?.type === "subscription") {
        // Subscription vence VOD na determinação de contexto
        context = "new_streaming";
      } else if (availability?.type === "free" || availability?.type === "ads") {
        context = "new_streaming";
      } else if (
        availability?.type === "rent" ||
        availability?.type === "buy"
      ) {
        context = "vod";
      } else if (availability) {
        context = "new_streaming";
      }

      if (releaseAge !== null && releaseAge <= 120 && availability) {
        context =
          availability.type === "subscription" ? "new_streaming" : "vod";
      }

      const runtime = getRuntime(title);
      const { score, scoreBreakdown } = buildMovieScore({
        libraryStatus: userTitle.status,
        createdAt: userTitle.created_at,
        updatedAt: userTitle.watched_at,
        releaseDate,
        runtime,
        availability,
      });

      const addedAge = daysSince(userTitle.created_at);
      const surpriseScore =
        userTitle.status === "watchlist" && addedAge !== null && addedAge >= 30
          ? Math.min(80, 25 + Math.floor(addedAge / 14) * 5)
          : 0;

      const recentActivityBoost =
        recentActivityBoostMap.get(`movie-${userTitle.tmdb_id}`) ?? null;

      const contextLabel = buildContextLabel({
        context,
        remainingAiredEpisodes: null,
        progressPercentage: 0,
        availability,
      });
      const genreLabels = (title?.tmdb_payload?.genres ?? [])
        .slice(0, 2)
        .map((g) => g.name);

      const eyebrowColorMap: Record<string, string> = {
        resume: "#a855f7",
        new_streaming: "#06b6d4",
        watchlist: "#14b8a6",
        vod: "#10b981",
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
        score: score + surpriseScore + (recentActivityBoost?.boost ?? 0),
        priority: 999,
        context,
        contextLabel,
        reason: contextLabel,
        labels: genreLabels.length > 0 ? genreLabels : ["Filme"],
        progress: {
          percentage: userTitle.status === "watching" ? 1 : 0,
          runtimeMinutes: runtime,
          remainingMinutes: runtime,
          lastWatchedAt: userTitle.watched_at,
        },
        availability,
        actions: {
          primary:
            context === "new_streaming" || context === "vod"
              ? "watch_now"
              : context === "resume"
                ? "resume"
                : "open_title",
          secondary: "open_title",
        },
        serverEyebrow: {
          text: contextLabel.toUpperCase(),
          color: eyebrowColorMap[context] ?? "#14b8a6",
        },
        debug: {
          source: "user_titles",
          hydratedFromPayload: Boolean(title.tmdb_payload),
          slotBucket: surpriseScore > 0 ? "surprise" : "discovery",
          surpriseScore,
          recentActivityBoost,
          scoreBreakdown,
        },
      } satisfies HeroCandidate;
    })
    .filter((candidate) => candidate !== null)
    .filter((candidate) => candidate.score > 0) as HeroCandidate[];

  // ─── PIPELINE DE RANKING ─────────────────────────────────────────────────
  const rawWithFreshness = applyHeroFreshnessAndRotation([
    ...seriesCandidates,
    ...unstartedSeriesCandidates,
    ...movieCandidates,
  ]);
  const balancedCandidates = pickBalancedCandidates(
    rawWithFreshness,
    limit * 2,
  );
  const withTemporalCooldown = await applyHeroTemporalCooldown(
    userId,
    balancedCandidates,
  );
  const candidates = applyHeroDiversity(withTemporalCooldown, limit);

  return {
    candidates,
    generatedAt: new Date().toISOString(),
  };
}
