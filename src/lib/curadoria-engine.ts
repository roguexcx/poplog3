import type {
  UserWatching,
  UserCuradoriaPreferences,
  ScoredItem,
  ScoreBreakdown,
  HeroCTA,
  HeroEyebrow,
} from "@/components/HeroSpotlight/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clamp(v: number, min = 0, max = 1) {
  return Math.min(max, Math.max(min, v));
}

function hoursDiff(date: string | null, now: Date): number {
  if (!date) return Infinity;
  return (now.getTime() - new Date(date).getTime()) / (1000 * 60 * 60);
}

function daysDiff(date: string | null, now: Date): number {
  return hoursDiff(date, now) / 24;
}

// ─── Factor implementations ───────────────────────────────────────────────────

function f1Recency(item: UserWatching, now: Date): number {
  const h = hoursDiff(item.last_watched_at, now);
  let score: number;

  if (h < 6) score = 1.0;
  else if (h < 24) score = 0.85;
  else if (h < 72) score = 0.65;
  else if (h < 168) score = 0.40;
  else if (h < 336) score = 0.20;
  else if (h < 720) score = 0.08;
  else score = 0.0;

  if (item.is_marathon) score = clamp(score * 1.25);
  return score;
}

function f2Urgency(item: UserWatching): number {
  if (item.content_type === "filme") {
    const runtime = item.runtime ?? 0;
    const progress = item.watch_progress_minutes ?? 0;
    if (runtime === 0) return 0;
    const pct = progress / runtime;
    if (pct > 0.7) return 1.0;
    if (pct > 0.4) return 0.7;
    if (pct > 0.1) return 0.4;
    return 0.0;
  }

  // Series
  const total = item.total_episodes_season ?? 0;
  const watched = item.episodes_watched ?? 0;
  const rem = total - watched;
  if (rem <= 0) return 0;
  if (rem === 1) return 1.0;
  if (rem === 2) return 0.90;
  if (rem <= 4) return 0.75;
  if (rem <= 6) return 0.50;
  if (rem <= 10) return 0.25;
  return 0.05;
}

function f3NewEpisode(item: UserWatching, now: Date): number {
  if (!item.new_episode_available) return 0;
  const h = hoursDiff(item.new_episode_available_since, now);
  if (h < 6) return 1.0;
  if (h < 24) return 0.90;
  if (h < 72) return 0.70;
  if (h < 168) return 0.45;
  return 0.20;
}

function f4Streaming(item: UserWatching, now: Date): number {
  const streamDate = item.streaming_available_since ?? item.vod_available_since;
  if (!streamDate) return 0;
  const d = daysDiff(streamDate, now);
  if (d < 7) return 1.0;
  if (d < 14) return 0.80;
  if (d < 30) return 0.55;
  if (d < 60) return 0.30;
  return 0.05;
}

function f5Quality(item: UserWatching): number {
  const rating = item.user_rating ?? item.tmdb_rating ?? 0;
  return clamp((rating - 5) / 5);
}

function f6Duration(
  item: UserWatching,
  prefs: UserCuradoriaPreferences
): number {
  const sessionMinutes = prefs.preferred_session_duration_minutes || 60;
  let remaining: number;

  if (item.content_type === "filme") {
    remaining = (item.runtime ?? 90) - (item.watch_progress_minutes ?? 0);
  } else {
    remaining = item.next_episode_duration ?? 45;
  }

  const ratio = remaining / sessionMinutes;
  if (ratio <= 0.5) return 1.0;
  if (ratio <= 1.0) return 0.75;
  if (ratio <= 1.5) return 0.45;
  if (ratio <= 2.0) return 0.25;
  return 0.05;
}

function f7GenreAlignment(
  item: UserWatching,
  prefs: UserCuradoriaPreferences
): number {
  const topGenres = prefs.top_genres ?? [];
  const itemGenres = item.genres ?? [];
  if (topGenres.length === 0 || itemGenres.length === 0) return 0.5;
  const matchCount = itemGenres.filter((g) => topGenres.includes(g)).length;
  return clamp(matchCount / Math.min(itemGenres.length, 3));
}

function f8Freshness(item: UserWatching, now: Date): number {
  let baseScore: number;
  const h = hoursDiff(item.hero_last_shown_at, now);

  if (item.hero_last_shown_at === null) {
    baseScore = 1.0;
  } else if (h < 1) {
    baseScore = 0.0;
  } else if (h < 6) {
    baseScore = 0.3;
  } else if (h < 24) {
    baseScore = 0.6;
  } else {
    baseScore = 1.0;
  }

  const accumulatedPenalty = Math.max(0, 1 - item.hero_shown_count * 0.05);
  return clamp(baseScore * accumulatedPenalty);
}

function f9Rediscovery(item: UserWatching, now: Date): number {
  const isEligible =
    item.rediscovery_eligible ||
    item.status === "watchlist" ||
    daysDiff(item.last_watched_at, now) > 30;

  if (!isEligible) return 0;

  const randomBoost = Math.random() * 0.4;
  const daysOnWatchlist = daysDiff(item.added_to_watchlist_at, now);
  const agingBonus = Math.min(daysOnWatchlist / 180, 1) * 0.3;
  return randomBoost + agingBonus;
}

// ─── Main scoring function ────────────────────────────────────────────────────

const WEIGHTS = {
  f1: 22,
  f2: 20,
  f3: 18,
  f4: 12,
  f5: 10,
  f6: 8,
  f7: 7,
  f8: 8,
} as const;

export function calculatePriorityScore(
  item: UserWatching,
  prefs: UserCuradoriaPreferences,
  now = new Date()
): ScoredItem {
  // Hard exclusions
  if (item.snoozed_until && now < new Date(item.snoozed_until)) {
    return { ...item, score: 0 };
  }

  const f1 = f1Recency(item, now);
  const f2 = f2Urgency(item);
  const f3 = f3NewEpisode(item, now);
  const f4 = f4Streaming(item, now);
  const f5 = f5Quality(item);
  const f6 = f6Duration(item, prefs);
  const f7 = f7GenreAlignment(item, prefs);
  const f8 = f8Freshness(item, now);
  const f9 = f9Rediscovery(item, now);

  let score =
    f1 * WEIGHTS.f1 +
    f2 * WEIGHTS.f2 +
    f3 * WEIGHTS.f3 +
    f4 * WEIGHTS.f4 +
    f5 * WEIGHTS.f5 +
    f6 * WEIGHTS.f6 +
    f7 * WEIGHTS.f7 +
    f8 * WEIGHTS.f8 +
    f9 * 10; // rediscovery is additive bonus

  // Status multipliers
  if (item.status === "watching") score *= 1.0;
  else if (item.status === "paused") score *= 0.85;
  else if (item.status === "watchlist") score *= 0.60;
  else if (item.status === "abandoned") score *= 0.15;

  const breakdown: ScoreBreakdown = {
    f1_recency: f1 * WEIGHTS.f1,
    f2_urgency: f2 * WEIGHTS.f2,
    f3_new_episode: f3 * WEIGHTS.f3,
    f4_streaming: f4 * WEIGHTS.f4,
    f5_quality: f5 * WEIGHTS.f5,
    f6_duration: f6 * WEIGHTS.f6,
    f7_genre: f7 * WEIGHTS.f7,
    f8_freshness: f8 * WEIGHTS.f8,
    f9_rediscovery: f9 * 10,
    total: score,
  };

  return { ...item, score, scoreBreakdown: breakdown };
}

// ─── Hero selection ───────────────────────────────────────────────────────────

export function selectHeroItems(
  scoredItems: ScoredItem[],
  count = 5
): ScoredItem[] {
  const sorted = [...scoredItems].sort((a, b) => b.score - a.score);

  const selected: ScoredItem[] = [];
  let seriesCount = 0;
  let filmeCount = 0;
  const platformCount: Record<string, number> = {};
  let watchlistCount = 0;

  for (const item of sorted) {
    if (selected.length >= count) break;
    if (item.score <= 0) continue;

    if (item.content_type === "serie" && seriesCount >= 3) continue;
    if (item.content_type === "filme" && filmeCount >= 3) continue;
    if (item.status === "watchlist" && watchlistCount >= 1) continue;
    if (
      item.streaming_platform &&
      (platformCount[item.streaming_platform] ?? 0) >= 2
    )
      continue;

    selected.push(item);
    if (item.content_type === "serie") seriesCount++;
    if (item.content_type === "filme") filmeCount++;
    if (item.status === "watchlist") watchlistCount++;
    if (item.streaming_platform) {
      platformCount[item.streaming_platform] =
        (platformCount[item.streaming_platform] ?? 0) + 1;
    }
  }

  return selected;
}

// ─── CTA and Eyebrow helpers ─────────────────────────────────────────────────

export function getHeroCTA(item: ScoredItem): HeroCTA {
  if (item.content_type === "filme") {
    if ((item.watch_progress_minutes ?? 0) > 0)
      return { primary: "Retomar filme", icon: "play" };
    if (item.status === "watchlist")
      return { primary: "Assistir agora", icon: "play" };
    return { primary: "Continuar assistindo", icon: "play" };
  }

  if (item.new_episode_available)
    return { primary: "Assistir novo episódio", icon: "sparkles" };

  const rem =
    (item.total_episodes_season ?? 0) - (item.episodes_watched ?? 0);
  if (rem === 1) return { primary: "Finalizar temporada", icon: "flag" };
  if (rem <= 3) return { primary: "Quase lá — continuar", icon: "play" };
  if (item.status === "paused") return { primary: "Retomar", icon: "play" };
  if (item.status === "watchlist")
    return { primary: "Começar agora", icon: "play" };

  return {
    primary: `Continuar — T${item.current_season}E${(item.current_episode ?? 0) + 1}`,
    icon: "play",
  };
}

export function getHeroEyebrow(item: ScoredItem): HeroEyebrow {
  if (item.new_episode_available)
    return { text: "Novo episódio disponível", color: "#d4537e" };

  const rem =
    (item.total_episodes_season ?? 0) - (item.episodes_watched ?? 0);
  if (rem === 1)
    return { text: "Último episódio da temporada", color: "#f0a060" };
  if (rem <= 3) return { text: "Reta final da temporada", color: "#f0a060" };
  if (item.is_marathon) return { text: "Maratona ativa", color: "#a07ee0" };
  if (item.status === "paused")
    return { text: "Você parou aqui", color: "#6060a0" };
  if (item.status === "watchlist")
    return { text: "Na sua watchlist", color: "#2daa88" };

  return { text: "Continuar agora", color: "#a07ee0" };
}

export function tmdbImage(
  path: string | null,
  size: "w342" | "w500" | "w780" | "w1280" | "original" = "w780"
): string {
  if (!path) return "";
  return `https://image.tmdb.org/t/p/${size}${path}`;
}
