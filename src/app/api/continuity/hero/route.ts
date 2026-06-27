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
import {
  readContinuitySectionCache,
  writeContinuitySectionCache,
} from "@/server/continuity/continuity-section-cache";
import { normalizeStreamingRegion } from "@/server/streaming/region";

const HERO_VISIBLE_LIMIT = 5;
const HERO_POOL_LIMIT = 14;
const HERO_PERSISTENT_CACHE_TTL_MS = 20 * 60_000;

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

type HeroPayload = {
  candidates: Array<Record<string, unknown>>;
  generatedAt: string;
  cache: {
    status: string;
    poolSize: number;
    returned: number;
    responseTimeMs: number;
  };
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

async function buildHeroPayload(input: {
  userId: string;
  region: "BR" | "US";
  forceRefresh: boolean;
  recordImpressions: boolean;
  startedAt: number;
}) {
  const { result, cacheStatus } = await getHeroResultFast({
    userId: input.userId,
    region: input.region,
    forceRefresh: input.forceRefresh,
  });

  const chosenCandidates = weightedPickFromPool(result.candidates ?? [], HERO_VISIBLE_LIMIT);

  if (input.recordImpressions && chosenCandidates.length > 0) {
    recordHeroImpressions({ userId: input.userId, candidates: chosenCandidates }).catch((error) => {
      console.error("[hero/impressions]", error);
    });
  }

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
      user_id: input.userId,
      content_id: cand.id,
      content_type: isTv ? "serie" : "filme",
      title: cand.title,
      overview: cand.overview,
      poster_path: cand.posterPath,
      backdrop_path: cand.backdropPath,
      alternate_backdrop_path: cand.alternateBackdropPath ?? null,
      dominant_color: cand.availability?.isPreferred ? "#231545" : "#111218",
      status: cand.context === "watchlist" ? "watchlist" : "watching",
      score: cand.score,
      year: cand.year,
      current_season: cand.progress?.nextSeason ?? null,
      last_watched_episode: lastWatchedEpisode,
      next_episode_number: nextEpisodeNumber,
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
      // Badge de disponibilidade (mesmo contrato dos demais cards) — logo + nome canônico.
      best_provider_name: cand.availability?.providerName ?? null,
      best_provider_type: cand.availability?.type ?? null,
      best_provider_logo: cand.availability?.providerLogoPath ?? null,
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

  return {
    candidates: mappedItems,
    generatedAt: result.generatedAt,
    cache: {
      status: cacheStatus,
      poolSize: result.candidates?.length ?? 0,
      returned: mappedItems.length,
      responseTimeMs: Date.now() - input.startedAt,
    },
  } satisfies HeroPayload;
}

export async function GET(request: Request) {
  const totalStartedAt = Date.now();
  const perf: Record<string, number> = {};
  let stageStartedAt = totalStartedAt;
  const markStage = (stage: string) => {
    perf[stage] = Date.now() - stageStartedAt;
    stageStartedAt = Date.now();
  };

  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: "Usuário não autenticado." },
        { status: 401 },
      );
    }
    markStage("auth");

    const url = new URL(request.url);
    const forceRefresh = url.searchParams.get("refresh") === "1" || url.searchParams.get("force") === "1";
    const region = normalizeStreamingRegion(url.searchParams.get("region"), {
      source: "api:continuity-hero:region",
      explicit: url.searchParams.has("region"),
    });
    const sectionKey = `hero_${region.toLowerCase()}`;

    const language = "pt-BR";
    const persistentCache = !forceRefresh
      ? await readContinuitySectionCache<HeroPayload>(sectionKey, {
          userId: user.id,
          region,
          language,
        })
      : null;
    markStage("persistent_cache_read");

    if (persistentCache) {
      const payload: HeroPayload = {
        ...persistentCache.payload,
        cache: {
          ...persistentCache.payload.cache,
          status: `persistent_${persistentCache.status}`,
          responseTimeMs: Date.now() - totalStartedAt,
        },
      };

      if (persistentCache.status === "stale") {
        void buildHeroPayload({
          userId: user.id,
          region,
          forceRefresh: true,
          recordImpressions: false,
          startedAt: Date.now(),
        })
          .then((freshPayload) =>
            writeContinuitySectionCache({
              userId: user.id,
              sectionKey,
              region,
              language,
              payload: freshPayload,
              ttlMs: HERO_PERSISTENT_CACHE_TTL_MS,
            }),
          )
          .catch((error) => {
            console.warn("[hero/persistent-cache] background refresh failed", {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }

      console.log("[hero/perf]", {
        sectionKey,
        cacheStatus: payload.cache.status,
        forceRefresh,
        returned: payload.candidates.length,
        ...perf,
        total: Date.now() - totalStartedAt,
      });
      return NextResponse.json(payload);
    }

    const payload = await buildHeroPayload({
      userId: user.id,
      region,
      forceRefresh,
      recordImpressions: true,
      startedAt: totalStartedAt,
    });
    markStage("candidate_pool");

    await writeContinuitySectionCache({
      userId: user.id,
      sectionKey,
      region,
      language,
      payload,
      ttlMs: HERO_PERSISTENT_CACHE_TTL_MS,
    });
    markStage("persistent_cache_write");

    console.log("[hero/perf]", {
      sectionKey,
      cacheStatus: payload.cache.status,
      forceRefresh,
      poolSize: payload.cache.poolSize,
      returned: payload.candidates.length,
      external_sync: 0,
      ...perf,
      total: Date.now() - totalStartedAt,
    });

    return NextResponse.json(payload);
  } catch (error) {
    // Qualquer falha interna (API externa, TMDB, etc.) não deve retornar 404 ou 500
    // para o cliente — isso quebraria o carregamento da página. Retornamos lista
    // vazia com status 200 para que a UI exiba o fallback de onboarding normalmente.
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.warn("[api/poplog3/continuity/hero] falha ao gerar candidatos — retornando lista vazia", {
      error: errorMsg,
    });
    return NextResponse.json({
      candidates: [],
      generatedAt: new Date().toISOString(),
      cache: { status: "error_fallback", poolSize: 0, returned: 0, responseTimeMs: 0 },
    });
  }
}
