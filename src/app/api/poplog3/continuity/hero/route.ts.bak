import { NextResponse } from "next/server";
import { getCurrentUser } from "@/server/auth/get-current-user";
import { getHeroCandidates } from "@/server/continuity/hero-candidates";
import { recordHeroImpressions } from "@/server/continuity/hero-impressions";
import { getCachedEpisode } from "@/server/cache/season-cache";
import {
  formatEpisodeRuntimeLabel,
  formatRemainingRuntimeLabel,
  formatRuntimeLabel,
} from "@/lib/domain-labels";

const HERO_VISIBLE_LIMIT = 5;
const HERO_POOL_LIMIT = 14;

// Fresh: 90s — serve do cache sem regenerar.
// Stale: 8min — serve stale enquanto regenera em background.
// Max entries: evita crescimento ilimitado em instâncias long-running.
const HERO_CACHE_TTL_MS = 90_000;
const HERO_CACHE_STALE_MS = 8 * 60_000;
const HERO_CACHE_MAX_ENTRIES = 1_000;

type HeroResult = Awaited<ReturnType<typeof getHeroCandidates>>;

type HeroCacheEntry = {
  result: HeroResult;
  generatedAtMs: number;
  refreshing?: Promise<HeroResult>;
};

// LRU simples: quando atinge o limite, limpa as entradas mais antigas.
const heroMemoryCache = new Map<string, HeroCacheEntry>();

function evictStaleEntries() {
  if (heroMemoryCache.size < HERO_CACHE_MAX_ENTRIES) return;
  const now = Date.now();
  const entries = Array.from(heroMemoryCache.entries())
    .sort((a, b) => a[1].generatedAtMs - b[1].generatedAtMs);
  // Remove os 20% mais antigos
  const toRemove = Math.ceil(entries.length * 0.2);
  for (let i = 0; i < toRemove; i++) {
    const entry = entries[i];
    if (entry && now - entry[1].generatedAtMs > HERO_CACHE_STALE_MS) {
      heroMemoryCache.delete(entry[0]);
    }
  }
}

function getCacheKey(userId: string, region: string) {
  return `${userId}:${region}`;
}

function isFresh(entry: HeroCacheEntry) {
  return Date.now() - entry.generatedAtMs <= HERO_CACHE_TTL_MS;
}

function isUsableStale(entry: HeroCacheEntry) {
  return Date.now() - entry.generatedAtMs <= HERO_CACHE_STALE_MS;
}

async function refreshHeroCache(userId: string, region: "BR" | "US", cacheKey: string) {
  const current = heroMemoryCache.get(cacheKey);

  if (current?.refreshing) {
    return current.refreshing;
  }

  const refreshing = getHeroCandidates(userId, {
    limit: HERO_POOL_LIMIT,
    region,
  })
    .then((result) => {
      evictStaleEntries();
      heroMemoryCache.set(cacheKey, {
        result,
        generatedAtMs: Date.now(),
      });
      return result;
    })
    .catch((error) => {
      if (current) {
        heroMemoryCache.set(cacheKey, {
          result: current.result,
          generatedAtMs: current.generatedAtMs,
        });
      }
      throw error;
    });

  if (current) {
    heroMemoryCache.set(cacheKey, { ...current, refreshing });
  } else {
    heroMemoryCache.set(cacheKey, {
      result: { candidates: [], generatedAt: new Date(0).toISOString() },
      generatedAtMs: 0,
      refreshing,
    });
  }

  return refreshing;
}

async function getHeroResultFast({
  userId,
  region,
  forceRefresh,
}: {
  userId: string;
  region: "BR" | "US";
  forceRefresh: boolean;
}) {
  const cacheKey = getCacheKey(userId, region);
  const cached = heroMemoryCache.get(cacheKey);

  if (!forceRefresh && cached && isFresh(cached)) {
    return {
      result: cached.result,
      cacheStatus: "memory_hit_fresh" as const,
    };
  }

  if (!forceRefresh && cached && isUsableStale(cached)) {
    void refreshHeroCache(userId, region, cacheKey).catch((error) => {
      console.error("[api/poplog3/continuity/hero] background refresh failed", error);
    });

    return {
      result: cached.result,
      cacheStatus: "memory_hit_stale_refreshing" as const,
    };
  }

  const result = await refreshHeroCache(userId, region, cacheKey);

  return {
    result,
    cacheStatus: forceRefresh ? "forced_refresh" as const : "memory_miss" as const,
  };
}

function weightedPickFromPool<T extends { id: string; score?: number | null; mediaType?: string; context?: string }>(
  items: T[],
  limit: number,
) {
  if (items.length <= limit) return items;

  const selected: T[] = [];
  const usedIds = new Set<string>();
  const mediaCount = new Map<string, number>();
  const contextCount = new Map<string, number>();

  const ranked = items
    .map((item, index) => {
      const score = Math.max(1, Number(item.score ?? 1));
      const softenedWeight = Math.sqrt(score);
      const randomKey = Math.random() ** (1 / softenedWeight);
      return { item, index, randomKey };
    })
    .sort((a, b) => b.randomKey - a.randomKey || a.index - b.index);

  function canUse(item: T) {
    const mediaType = item.mediaType ?? "unknown";
    const context = item.context ?? "unknown";
    if ((mediaCount.get(mediaType) ?? 0) >= 3) return false;
    if (context === "new_episode" && (contextCount.get(context) ?? 0) >= 2) return false;
    return true;
  }

  function push(item: T) {
    if (selected.length >= limit || usedIds.has(item.id)) return false;
    selected.push(item);
    usedIds.add(item.id);
    mediaCount.set(item.mediaType ?? "unknown", (mediaCount.get(item.mediaType ?? "unknown") ?? 0) + 1);
    contextCount.set(item.context ?? "unknown", (contextCount.get(item.context ?? "unknown") ?? 0) + 1);
    return true;
  }

  for (const { item } of ranked) {
    if (canUse(item)) push(item);
    if (selected.length >= limit) break;
  }

  if (selected.length < limit) {
    for (const { item } of ranked) {
      push(item);
      if (selected.length >= limit) break;
    }
  }

  return selected;
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Usuário não autenticado." },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("force") === "1";
    const regionParam = url.searchParams.get("region")?.toUpperCase();
    const region: "BR" | "US" = regionParam === "US" ? "US" : "BR";

    const startedAt = Date.now();
    const { result, cacheStatus } = await getHeroResultFast({
      userId: user.id,
      region,
      forceRefresh,
    });

    const chosenCandidates = weightedPickFromPool(result.candidates ?? [], HERO_VISIBLE_LIMIT);

    // Fire-and-forget: analytics não bloqueia a resposta
    if (chosenCandidates.length > 0) {
      recordHeroImpressions({ userId: user.id, candidates: chosenCandidates }).catch((error) => {
        console.error("[hero/impressions]", error);
      });
    }

    // Enriquece apenas os 5 candidatos visíveis com nome/still do próximo episódio
    const episodeData = await Promise.all(
      chosenCandidates.map(async (cand) => {
        if (cand.mediaType !== "tv") return null;

        const tmdbId = Number.parseInt(cand.id.replace("tv-", ""), 10);
        const season = cand.progress?.nextSeason;
        const episode = cand.progress?.nextEpisode;

        if (!Number.isFinite(tmdbId) || !season || !episode) return null;

        return getCachedEpisode(tmdbId, season, episode);
      }),
    );

    const mappedItems = chosenCandidates.map((cand, index) => {
      const isTv = cand.mediaType === "tv";
      const ep = episodeData[index];
      const nextEpisodeNumber = cand.progress?.nextEpisode ?? null;
      const lastWatchedEpisode =
        nextEpisodeNumber !== null ? Math.max(nextEpisodeNumber - 1, 0) : null;
      const nextEpisodeDuration = isTv
        ? ep?.runtime ?? cand.progress?.runtimeMinutes ?? null
        : cand.progress?.runtimeMinutes ?? null;
      const remainingMovieRuntime =
        !isTv && typeof cand.progress?.remainingMinutes === "number"
          ? cand.progress.remainingMinutes
          : null;
      const runtimeLabel = isTv
        ? formatEpisodeRuntimeLabel(nextEpisodeDuration, {
            estimated: ep?.runtime ? false : true,
          })
        : formatRuntimeLabel(cand.progress?.runtimeMinutes ?? null);
      const remainingRuntimeLabel = !isTv
        ? formatRemainingRuntimeLabel(remainingMovieRuntime)
        : null;

      return {
        id: cand.id,
        user_id: user.id,
        content_id: cand.id,
        content_type: isTv ? "serie" : "filme",
        title: cand.title,
        overview: cand.overview,
        poster_path: cand.posterPath,
        backdrop_path: cand.backdropPath,
        dominant_color: cand.availability?.isPreferred ? "#231545" : "#111218",
        status: cand.context === "watchlist" ? "watchlist" : "watching",
        score: cand.score,
        year: cand.year,

        // Semântica clara: episódio que o usuário vai assistir agora
        current_season: cand.progress?.nextSeason ?? null,
        // last_watched_episode = último assistido (nextEpisode - 1)
        last_watched_episode: lastWatchedEpisode,
        // next_episode_number = o que vem a seguir
        next_episode_number: nextEpisodeNumber,

        // Mantido para compatibilidade com componentes existentes
        current_episode: lastWatchedEpisode,

        total_episodes_season: cand.progress?.totalEpisodes ?? null,
        episodes_watched: cand.progress?.watchedEpisodes ?? null,

        next_episode_name: isTv && nextEpisodeNumber
          ? (ep?.name ?? `Episódio ${nextEpisodeNumber}`)
          : null,
        next_episode_duration: nextEpisodeDuration,
        next_episode_duration_label: isTv ? runtimeLabel : null,
        next_episode_air_date: cand.progress?.nextEpisodeAirDate ?? null,
        next_episode_still_path: ep?.still_path ?? null,
        new_episode_available: cand.context === "new_episode",

        runtime: cand.progress?.runtimeMinutes ?? null,
        runtime_label: runtimeLabel,
        remaining_runtime_label: remainingRuntimeLabel,
        watch_progress_minutes:
          !isTv &&
          typeof cand.progress?.runtimeMinutes === "number" &&
          typeof cand.progress?.remainingMinutes === "number"
            ? Math.max(cand.progress.runtimeMinutes - cand.progress.remainingMinutes, 0)
            : null,

        streaming_platform: cand.availability?.providerName ?? null,
        streaming_type: cand.availability?.type ?? null,
        streaming_is_subscription: cand.availability?.type === "subscription",
        genres: cand.labels,

        serverEyebrow: (cand as any).serverEyebrow ?? {
          text: cand.contextLabel,
          color: "#a07ee0",
        },
        serverCta: (cand as any).actions?.serverCta ?? {
          primary: "Assistir agora",
          icon: "play",
        },
        debug: {
          ...(cand as any).debug,
          heroRouteCache: cacheStatus,
        },
      };
    });

    return NextResponse.json({
      candidates: mappedItems,
      generatedAt: result.generatedAt,
      cache: {
        status: cacheStatus,
        poolSize: result.candidates?.length ?? 0,
        returned: mappedItems.length,
        responseTimeMs: Date.now() - startedAt,
      },
    });
  } catch (error) {
    console.error("[api/poplog3/continuity/hero] failed", error);
    return NextResponse.json(
      { error: "Erro ao gerar candidatos do Hero." },
      { status: 500 },
    );
  }
}
