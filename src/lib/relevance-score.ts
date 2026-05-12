// src/lib/relevance-score.ts
//
// Motor de relevância do POPLOG.
// Calcula um score numérico para cada título da watchlist,
// determinando a ordem de aparição nas "Sugestões para hoje".
//
// Função pura — sem side effects, sem chamadas de API.

// ─── Types ────────────────────────────────────────────────────────────────────

import type {
  StreamStatus,
  StreamingAvailabilityResult,
  StreamingAvailabilityStatus,
} from "@/lib/streaming";

export type ScorableTitle = {
  tmdb_id: number;
  media_type: "movie" | "tv";
  stream_status?: StreamStatus | StreamingAvailabilityStatus | null;
  streamingAvailability?: Pick<
    StreamingAvailabilityResult,
    "streamStatus" | "legacyStreamStatus" | "confidenceScore" | "availableInCountry" | "availableAbroad"
  > | null;
  tmdb: {
    release_date?: string;
    first_air_date?: string;
    popularity?: number;
  } | null;
};

// ─── Pesos ────────────────────────────────────────────────────────────────────

const WEIGHTS = {
  available:      50,
  grayZone:       25,
  cinemaOnly:      0,
  notReleased:     0,
  tvAvailable:    50,
  recencyMax:     30,
  recencyDecay:   30,
  popularityMax:  15,
  popularityLog:   5,
  dailyVariation:  5,
} as const;

const CINEMA_TO_DIGITAL = { min: 31, max: 45 } as const;
const ESTIMATED_AVAILABILITY_MAX = 30;

// ─── Helpers internos ─────────────────────────────────────────────────────────

function daysSince(dateStr: string): number {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
}

function getDayOfYear(): number {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 0);
  return Math.floor((now.getTime() - start.getTime()) / 86_400_000);
}

function scoreKnownAvailability(status: StreamStatus | StreamingAvailabilityStatus, confidenceScore = 50): number {
  const confidenceMultiplier = Math.max(0.25, Math.min(confidenceScore, 100) / 100);
  switch (status) {
    case "available_subscription":
    case "available_free":
    case "streaming":
    case "confirmado":
      return Math.round(WEIGHTS.available * confidenceMultiplier);
    case "available_rent":
    case "available_buy":
      return Math.round(42 * confidenceMultiplier);
    case "available_abroad":
      return Math.round(WEIGHTS.grayZone * confidenceMultiplier);
    case "cinema_now":
    case "cinemas":
    case "upcoming":
      return WEIGHTS.cinemaOnly;
    case "digital_expected":
    case "recently_released":
    case "chegando":
      return Math.round(WEIGHTS.grayZone * confidenceMultiplier);
    case "unavailable":
    case "unknown":
    default:
      return 0;
  }
}

function estimatedAvailabilityScore(title: ScorableTitle): number {
  const dateStr = title.tmdb?.release_date ?? title.tmdb?.first_air_date ?? null;
  if (!dateStr) return Math.min(WEIGHTS.grayZone, ESTIMATED_AVAILABILITY_MAX);
  const days = daysSince(dateStr);
  if (days < 0)                        return WEIGHTS.notReleased;
  if (days < CINEMA_TO_DIGITAL.min)    return WEIGHTS.cinemaOnly;
  if (days < CINEMA_TO_DIGITAL.max)    return Math.min(WEIGHTS.grayZone, ESTIMATED_AVAILABILITY_MAX);
  return ESTIMATED_AVAILABILITY_MAX;
}

function availabilityScore(title: ScorableTitle): number {
  if (title.streamingAvailability) {
    return scoreKnownAvailability(
      title.streamingAvailability.streamStatus,
      title.streamingAvailability.confidenceScore,
    );
  }
  if (title.stream_status) {
    return scoreKnownAvailability(title.stream_status, 45);
  }
  if (title.media_type === "tv") return Math.min(WEIGHTS.tvAvailable, ESTIMATED_AVAILABILITY_MAX);
  return estimatedAvailabilityScore(title);
}

function recencyScore(title: ScorableTitle): number {
  const dateStr = title.tmdb?.release_date ?? title.tmdb?.first_air_date ?? null;
  if (!dateStr) return 0;
  const days  = daysSince(dateStr);
  if (days < 0) return 0;
  return Math.max(0, Math.round(WEIGHTS.recencyMax - days / WEIGHTS.recencyDecay));
}

function popularityScore(title: ScorableTitle): number {
  const score = Math.log10((title.tmdb?.popularity ?? 0) + 1) * WEIGHTS.popularityLog;
  return Math.min(WEIGHTS.popularityMax, Math.round(score));
}

function dailyVariationScore(title: ScorableTitle): number {
  const seed = (title.tmdb_id * getDayOfYear()) % 100;
  return seed % (WEIGHTS.dailyVariation + 1);
}

// ─── Exports principais ───────────────────────────────────────────────────────

export function scoreTitle(title: ScorableTitle): number {
  return (
    availabilityScore(title) +
    recencyScore(title) +
    popularityScore(title) +
    dailyVariationScore(title)
  );
}

export function scoreTitleDebug(title: ScorableTitle) {
  const availability = availabilityScore(title);
  const recency      = recencyScore(title);
  const popularity   = popularityScore(title);
  const variation    = dailyVariationScore(title);
  return { total: availability + recency + popularity + variation, breakdown: { availability, recency, popularity, variation } };
}

// ─── buildReason ─────────────────────────────────────────────────────────────

export type SeasonContext = {
  season:  number;
  watched: number;
  total:   number;
};

export type ReasonableTitle = ScorableTitle & {
  created_at?: string;
  watchedEpisodes?: number;
  totalEpisodes?: number;
  nextEpisode?: { season: number; episode: number } | null;
  tmdb: {
    release_date?: string;
    first_air_date?: string;
    popularity?: number;
    genres?: { id: number; name: string }[];
  } | null;
};

export function buildReason(
  title: ReasonableTitle,
  pill: "ongoing" | "watchlist" | "fridge",
  seasonContext?: SeasonContext,
): string {
  // ── Séries em andamento ────────────────────────────────────────────────────
  if (pill === "ongoing") {
    const next = title.nextEpisode;

    if (seasonContext) {
      const { season, watched, total } = seasonContext;
      const remaining = total - watched;

      if (watched <= 2 || (total > 0 && watched / total < 0.15)) {
        return season > 1
          ? `Iniciando temporada ${season}`
          : next ? `Continue do T${next.season}E${next.episode}` : "Começando a série";
      }
      if (remaining > 0 && remaining <= 3) {
        return remaining === 1 ? `Falta 1 ep da T${season}!` : `Faltam ${remaining} eps da T${season}`;
      }
      if (total > 0 && remaining / total <= 0.2) return `Quase no fim da T${season}`;
      if (total > 0 && Math.abs(watched / total - 0.5) < 0.12) return `Na metade da T${season}`;
      return next ? `T${season} · ep ${next.episode} de ${total}` : `Temporada ${season} em andamento`;
    }

    const watched   = title.watchedEpisodes ?? 0;
    const total     = title.totalEpisodes   ?? 0;
    const remaining = total - watched;

    if (watched === 0 || (total > 0 && watched / total < 0.1)) {
      return next ? `Continue do T${next.season}E${next.episode}` : "Continue de onde parou";
    }
    if (remaining > 0 && remaining <= 3) {
      return remaining === 1 ? "Falta só 1 episódio!" : `Faltam ${remaining} episódios`;
    }
    if (total > 0 && remaining / total <= 0.2) return `Quase no fim · ${remaining} eps`;
    if (total > 0 && Math.abs(watched / total - 0.5) < 0.1) return "Você está na metade";
    if (next) return `Próximo: T${next.season}E${next.episode}`;
    return "Continue de onde parou";
  }

  // ── Geladeira ──────────────────────────────────────────────────────────────
  if (pill === "fridge") {
    if (title.created_at) {
      const days = daysSince(title.created_at);
      if (days <= 30)  return "Guardada há pouco tempo";
      if (days <= 90)  return `Guardada há ${Math.round(days / 30)} meses`;
    }
    return "Que tal retomar esta?";
  }

  // ── Watchlist — séries ─────────────────────────────────────────────────────
  if (title.media_type === "tv") {
    const dateStr = title.tmdb?.first_air_date ?? null;
    if (dateStr) {
      const days = daysSince(dateStr);
      if (days < 0)   return "Estreia em breve";
      if (days <= 30) return "Estreou recentemente";
      if (days <= 90) return `Estreou há ${Math.round(days / 30)} meses`;
    }
    const genre = title.tmdb?.genres?.[0]?.name;
    return genre ?? "Série na sua watchlist";
  }

  // ── Watchlist — filmes ─────────────────────────────────────────────────────
  const releaseDate = title.tmdb?.release_date ?? null;

  if (!releaseDate) {
    if (title.created_at) {
      const days = daysSince(title.created_at);
      if (days <= 7)  return "Adicionado esta semana";
      if (days <= 30) return "Adicionado este mês";
    }
    return title.tmdb?.genres?.[0]?.name ?? "Está na sua watchlist";
  }

  const days = daysSince(releaseDate);

  if (days < 0) {
    const abs = Math.abs(days);
    if (abs <= 7)  return "Estreia esta semana";
    if (abs <= 30) return "Estreia este mês";
    return "Em breve nos cinemas";
  }
  if (days < CINEMA_TO_DIGITAL.min) {
    return days <= 7 ? "Estreou esta semana · em cartaz" : `Em cartaz · ${days} dias de lançamento`;
  }
  if (days < CINEMA_TO_DIGITAL.max) return "Pode já estar disponível";
  if (days <= 90)  return `Disponível · lançado há ${days} dias`;
  if (days <= 365) {
    const months = Math.round(days / 30);
    return `Disponível · ${months} ${months === 1 ? "mês" : "meses"} atrás`;
  }
  return title.tmdb?.genres?.[0]?.name ?? "Está na sua watchlist";
}
