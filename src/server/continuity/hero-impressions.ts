import { supabaseAdmin } from "@/server/supabase/admin";
import type { HeroCandidate } from "./types";

type MediaType = "movie" | "tv";

type HeroImpressionRow = {
  tmdb_id: number;
  media_type: MediaType;
  context: string;
  score_at_time: number | null;
  session_id: string | null;
  seen_at: string;
};

type HeroImpressionStats = {
  lastSeenAt: string | null;
  timesSeenLast24h: number;
  timesSeenLast7d: number;
  timesSeenLast30d: number;
};

type TemporalScoreResult = {
  score: number;
  breakdown: {
    neverSeenBoost?: number;
    freshnessBoost?: number;
    temporalPenalty?: number;
    repeatedTodayPenalty?: number;
    repeatedWeekPenalty?: number;
    recoveryBoost?: number;
    relevanceShieldApplied: boolean;
    shieldType: string | null;
    shieldFactorApplied: number;
    cooldownHours: number;
    hoursSinceLastSeen: number | null;
    timesSeenLast24h: number;
    timesSeenLast7d: number;
    timesSeenLast30d: number;
    lastSeenAt: string | null;
  };
};

const DEFAULT_COOLDOWN_HOURS = 18;
const MAX_LOOKBACK_DAYS = 30;

function hoursSince(value?: string | null): number | null {
  if (!value) return null;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return null;
  return Math.max(0, (Date.now() - time) / 3_600_000);
}

function getCandidateKey(mediaType: MediaType, tmdbId: number): string {
  return `${mediaType}-${tmdbId}`;
}

function getCooldownHours(candidate: HeroCandidate): number {
  switch (candidate.context) {
    case "new_episode": return 6;
    case "finish_season": return 10;
    case "binge": return 12;
    case "new_streaming": return 16;
    case "vod": return 18;
    case "resume": return 18;
    case "rediscovery":
    case "watchlist":
    case "continue":
    default:
      return DEFAULT_COOLDOWN_HOURS;
  }
}

function calculateTemporalScore(
  candidate: HeroCandidate,
  stats: HeroImpressionStats | undefined,
): TemporalScoreResult {
  const cooldownHours = getCooldownHours(candidate);
  const lastSeenAt = stats?.lastSeenAt ?? null;
  const seenHoursAgo = hoursSince(lastSeenAt);

  const timesSeenLast24h = stats?.timesSeenLast24h ?? 0;
  const timesSeenLast7d = stats?.timesSeenLast7d ?? 0;
  const timesSeenLast30d = stats?.timesSeenLast30d ?? 0;

  const originalScore = candidate.score;

  let relevanceShieldApplied = false;
  let shieldType: string | null = null;
  let shieldFactor = 1.0; 

  // Mapeamento correto lendo as propriedades reais da árvore de progress
  const watched = candidate.progress?.watchedEpisodes ?? 0;
  const total = candidate.progress?.totalEpisodes ?? null;
  const remaining = total !== null ? Math.max(total - watched, 0) : null;
  const progressPercent = candidate.progress?.percentage ?? 0;

  const lastWatchedAtStr = candidate.progress?.lastWatchedAt;
  const daysSinceLastWatch = lastWatchedAtStr ? hoursSince(lastWatchedAtStr) / 24 : null;

  /**
   * RELEVANCE SHIELD ENGINE: RESOLUÇÃO DE GATILHOS CONTEXTUAIS
   */
  if (candidate.context === "new_episode") {
    relevanceShieldApplied = true;
    shieldType = "ultra_hot_release";
    shieldFactor = 0.15; // 85% de proteção
  } 
  else if (candidate.context === "finish_season" && remaining !== null && remaining <= 2) {
    relevanceShieldApplied = true;
    shieldType = "quase_em_dia_guard";
    shieldFactor = 0.25; // 75% de proteção
  } 
  else if (remaining !== null && remaining >= 3 && remaining <= 6 && daysSinceLastWatch !== null && daysSinceLastWatch <= 4) {
    relevanceShieldApplied = true;
    shieldType = "maratona_curta_viavel";
    shieldFactor = 0.40; // 60% de proteção
  }
  else if (candidate.context === "resume" && candidate.mediaType === "movie") {
    relevanceShieldApplied = true;
    shieldType = "incomplete_movie_lock";
    shieldFactor = 0.35; // 65% de proteção
  }
  else if (candidate.context === "new_streaming" && candidate.availability?.isPreferred) {
    relevanceShieldApplied = true;
    shieldType = "favorite_provider_arrival";
    shieldFactor = 0.50; // 50% de proteção
  }
  else if (remaining !== null && remaining >= 26) {
    relevanceShieldApplied = false;
    shieldType = "long_distance_unshielded";
    shieldFactor = 1.35; // Penalidade temporal acelerada em 35%
  }

  const breakdown: TemporalScoreResult["breakdown"] = {
    cooldownHours,
    hoursSinceLastSeen: seenHoursAgo,
    timesSeenLast24h,
    timesSeenLast7d,
    timesSeenLast30d,
    lastSeenAt,
    relevanceShieldApplied,
    shieldType,
    shieldFactorApplied: parseFloat((1 - shieldFactor).toFixed(2)),
  };

  let score = originalScore;

  if (!lastSeenAt) {
    breakdown.neverSeenBoost = 25;
    score += breakdown.neverSeenBoost;
    return { score, breakdown };
  }

  // 1. PENALIDADE TEMPORAL COMPRESSIVA COM AMORTECIMENTO
  if (seenHoursAgo !== null && seenHoursAgo < cooldownHours) {
    const proximityRatio = 1 - seenHoursAgo / cooldownHours;
    const basePenalty = 70 * proximityRatio;
    
    breakdown.temporalPenalty = -Math.round(basePenalty * shieldFactor);
    score += breakdown.temporalPenalty;
  }

  // 2. REPETIÇÃO DIÁRIA LOGARÍTMICA ATENUADA
  if (timesSeenLast24h > 0) {
    const baseDailyPenalty = Math.round(Math.log1p(timesSeenLast24h) * 28);
    breakdown.repeatedTodayPenalty = -Math.round(baseDailyPenalty * shieldFactor);
    score += breakdown.repeatedTodayPenalty;
  }

  // 3. PENALIDADE SEMANAL LEVE
  if (timesSeenLast7d > 1) {
    const weeklyExcess = Math.min(timesSeenLast7d - 1, 4);
    breakdown.repeatedWeekPenalty = -Math.round(weeklyExcess * 6);
    score += breakdown.repeatedWeekPenalty;
  }

  // 4. BÔNUS DE RECUPERAÇÃO CONTEXTUAL
  if (seenHoursAgo !== null && seenHoursAgo >= cooldownHours) {
    const recoveryRatio = Math.min(seenHoursAgo / 96, 1);
    breakdown.recoveryBoost = Math.round(20 * recoveryRatio);
    score += breakdown.recoveryBoost;
  }

  // 5. FLOOR DINÂMICO ADAPTATIVO
  const isLongSeries = remaining !== null && remaining >= 26;
  const minimumFloorPercent = relevanceShieldApplied ? 0.25 : (isLongSeries ? 0.08 : 0.12);
  const floorLimit = Math.round(originalScore * minimumFloorPercent);
  
  if (score < floorLimit) {
    score = floorLimit;
  }

  return {
    score,
    breakdown,
  };
}

export async function getHeroImpressionStats(
  userId: string,
  candidates: HeroCandidate[],
): Promise<Map<string, HeroImpressionStats>> {
  const statsMap = new Map<string, HeroImpressionStats>();
  if (candidates.length === 0) return statsMap;

  const since = new Date(Date.now() - MAX_LOOKBACK_DAYS * 86_400_000).toISOString();
  const tmdbIds = Array.from(new Set(candidates.map((candidate) => candidate.tmdbId)));

  const { data, error } = await supabaseAdmin
    .from("poplog3_hero_impressions")
    .select("tmdb_id, media_type, context, score_at_time, session_id, seen_at")
    .eq("user_id", userId)
    .in("tmdb_id", tmdbIds)
    .gte("seen_at", since)
    .order("seen_at", { ascending: false });

  if (error) {
    console.error("[continuity/hero-impressions] failed to fetch impressions from Supabase", error);
    return statsMap;
  }

  const now = Date.now();

  for (const row of (data ?? []) as HeroImpressionRow[]) {
    const key = getCandidateKey(row.media_type, row.tmdb_id);
    const seenTime = new Date(row.seen_at).getTime();

    if (!Number.isFinite(seenTime)) continue;

    const ageHours = Math.max(0, (now - seenTime) / 3_600_000);
    const current = statsMap.get(key) ?? {
      lastSeenAt: null,
      timesSeenLast24h: 0,
      timesSeenLast7d: 0,
      timesSeenLast30d: 0,
    };

    if (!current.lastSeenAt) {
      current.lastSeenAt = row.seen_at;
    }

    if (ageHours <= 24) current.timesSeenLast24h += 1;
    if (ageHours <= 168) current.timesSeenLast7d += 1;
    if (ageHours <= 720) current.timesSeenLast30d += 1;

    statsMap.set(key, current);
  }

  return statsMap;
}

export async function applyHeroTemporalCooldown(
  userId: string,
  candidates: HeroCandidate[],
): Promise<HeroCandidate[]> {
  if (candidates.length === 0) return candidates;

  const statsMap = await getHeroImpressionStats(userId, candidates);

  return candidates
    .map((candidate) => {
      const key = getCandidateKey(candidate.mediaType, candidate.tmdbId);
      const temporal = calculateTemporalScore(candidate, statsMap.get(key));

      return {
        ...candidate,
        score: temporal.score,
        debug: {
          ...candidate.debug,
          temporalCooldown: temporal.breakdown,
          scoreBeforeTemporalCooldown: candidate.score,
          scoreAfterTemporalCooldown: temporal.score,
        },
      };
    })
    .sort((a, b) => b.score - a.score);
}

export async function recordHeroImpressions(input: {
  userId: string;
  candidates: HeroCandidate[];
  sessionId?: string | null;
}): Promise<void> {
  if (input.candidates.length === 0) return;

  const rows = input.candidates.map((candidate) => ({
    user_id: input.userId,
    tmdb_id: candidate.tmdbId,
    media_type: candidate.mediaType,
    context: candidate.context,
    score_at_time: candidate.score,
    session_id: input.sessionId ?? null,
    seen_at: new Date().toISOString(),
  }));

  const { error } = await supabaseAdmin
    .from("poplog3_hero_impressions")
    .insert(rows);

  if (error) {
    console.error("[continuity/hero-impressions] failed to record impressions", error);
  }
}