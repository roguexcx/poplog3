import { NextRequest, NextResponse } from "next/server";
import { Prisma, type MediaType } from "@prisma/client";

import {
  adminContextFromRequest,
  assertAdminPermission,
  invalidateCatalogCaches,
  recordAdminAction,
} from "@/server/admin/admin-actions";
import { getTitleAvailabilityWithDebug } from "@/server/availability";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { redisDeleteByPattern, redisKeysByPattern, redisTtlSeconds } from "@/server/cache/redis-client";
import { db } from "@/server/db/client";
import { buildRadarGeneralPayload } from "@/server/radar-trakt/radar-trakt-engine";
import { getRadarCachedPayload, invalidateRadarCache, radarCacheKey } from "@/server/radar-trakt/radar-cache.service";
import { cacheKnownTitleAssets } from "@/server/source-engine/asset-worker";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
  posterCacheKey,
  providersCacheKey,
  titleCacheKey,
} from "@/server/source-engine/locale";
import { resolveAssetUrl } from "@/server/source-engine/asset-urls";
import { hydrateSeriesEpisodesFromSources } from "@/server/source-engine/series-episode-hydrator";
import { getTitlePageData } from "@/server/titles/get-title-page-data";
import { enqueueRefreshJob, getRefreshQueueStats, serializeRefreshJob } from "@/server/workers/refresh-queue";
import { enqueueSeriesEpisodeHydrationJob } from "@/server/workers/series-prehydration";

export const dynamic = "force-dynamic";

const RADAR_WINDOW_DAYS = 62;

function cleanString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanImdbId(value: unknown): string | null {
  const text = cleanString(value);
  return text && /^tt\d+$/i.test(text) ? text : null;
}

function cleanMediaType(value: unknown): MediaType | null {
  return value === "movie" || value === "tv" ? value : null;
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function providerCount(summary: Awaited<ReturnType<typeof getTitleAvailabilityWithDebug>>["summary"]) {
  return (
    summary.providers.flatrate.length +
    summary.providers.free.length +
    summary.providers.ads.length +
    summary.providers.rent.length +
    summary.providers.buy.length
  );
}

async function titlesByImdb(imdbIds: string[]) {
  if (!imdbIds.length) return new Map<string, { title: string | null; mediaType: MediaType; slug: string | null }>();
  const rows = await db.poplog3Title.findMany({
    where: { imdbId: { in: [...new Set(imdbIds)] } },
    select: { imdbId: true, title: true, mediaType: true, slug: true },
  });
  return new Map(
    rows
      .filter((row): row is typeof row & { imdbId: string } => Boolean(row.imdbId))
      .map((row) => [row.imdbId, { title: row.title, mediaType: row.mediaType, slug: row.slug }]),
  );
}

async function getTitleForAction(imdbId: string, mediaType: MediaType | null) {
  return db.poplog3Title.findFirst({
    where: {
      imdbId,
      ...(mediaType ? { mediaType } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      imdbId: true,
      tmdbId: true,
      traktId: true,
      slug: true,
      mediaType: true,
      title: true,
      year: true,
      releaseDate: true,
      firstAirDate: true,
      numberOfSeasons: true,
    },
  });
}

async function inspectTitleCache(input: {
  imdbId: string | null;
  language: string;
  region: string;
}) {
  if (!input.imdbId) return null;
  const key = titleCacheKey(input.imdbId, {
    catalogLanguage: input.language,
    region: input.region,
  });
  const [title, providers, continuity, assets, translations, redisKeys] = await Promise.all([
    db.poplog3Title.findFirst({
      where: { imdbId: input.imdbId },
      select: {
        id: true,
        imdbId: true,
        mediaType: true,
        title: true,
        slug: true,
        cacheStatus: true,
        lastFetchedAt: true,
        staleAt: true,
        expiresAt: true,
        updatedAt: true,
      },
    }),
    db.catalogAvailability.findMany({
      where: {
        imdbId: input.imdbId,
        providerRegion: input.region,
        providerLanguage: input.language,
      },
      orderBy: [{ expiresAt: "asc" }, { providerType: "asc" }, { providerName: "asc" }],
      take: 50,
      select: {
        id: true,
        providerName: true,
        providerType: true,
        source: true,
        sourceConfidence: true,
        checkedAt: true,
        expiresAt: true,
        staleUntil: true,
      },
    }),
    db.continuitySectionCache.findMany({
      where: {
        OR: [
          { sectionKey: { contains: input.imdbId } },
          { sectionKey: key },
          { sectionKey: providersCacheKey(input.imdbId, input.region) },
          { sectionKey: posterCacheKey(input.imdbId, input.language) },
        ],
      },
      orderBy: { updatedAt: "desc" },
      take: 25,
      select: {
        id: true,
        sectionKey: true,
        userId: true,
        region: true,
        language: true,
        updatedAt: true,
        expiresAt: true,
      },
    }),
    db.titleAsset.findMany({
      where: { imdbId: input.imdbId },
      orderBy: [{ type: "asc" }, { isPrimary: "desc" }, { updatedAt: "desc" }],
      take: 30,
      select: {
        id: true,
        type: true,
        language: true,
        region: true,
        assetKey: true,
        sourceUrl: true,
        width: true,
        height: true,
        isPrimary: true,
        isOverride: true,
        updatedAt: true,
      },
    }),
    db.titleTranslation.findMany({
      where: { imdbId: input.imdbId },
      orderBy: [{ language: "asc" }, { region: "asc" }],
      take: 20,
      select: {
        language: true,
        region: true,
        title: true,
        overview: true,
        slug: true,
        updatedAt: true,
      },
    }),
    redisKeysByPattern(`*${input.imdbId}*`).catch(() => []),
  ]);

  const redis = await Promise.all(
    redisKeys.slice(0, 20).map(async (redisKey) => ({
      key: redisKey,
      ttlSeconds: await redisTtlSeconds(redisKey).catch(() => null),
    })),
  );

  return {
    title: title
      ? {
          ...title,
          lastFetchedAt: iso(title.lastFetchedAt),
          staleAt: iso(title.staleAt),
          expiresAt: iso(title.expiresAt),
          updatedAt: iso(title.updatedAt),
        }
      : null,
    keys: {
      title: key,
      providers: providersCacheKey(input.imdbId, input.region),
      poster: posterCacheKey(input.imdbId, input.language),
    },
    providers: providers.map((provider) => ({
      ...provider,
      id: provider.id.toString(),
      checkedAt: iso(provider.checkedAt),
      expiresAt: iso(provider.expiresAt),
      staleUntil: iso(provider.staleUntil),
    })),
    continuity: continuity.map((row) => ({
      ...row,
      updatedAt: iso(row.updatedAt),
      expiresAt: iso(row.expiresAt),
    })),
    assets: assets.map((asset) => ({
      ...asset,
      publicUrl: resolveAssetUrl(asset.assetKey ?? asset.sourceUrl),
      updatedAt: iso(asset.updatedAt),
    })),
    translations: translations.map((translation) => ({
      ...translation,
      hasOverview: Boolean(translation.overview?.trim()),
      updatedAt: iso(translation.updatedAt),
    })),
    redis,
  };
}

async function dashboardSnapshot(request: NextRequest) {
  const language = normalizeCatalogLanguage(request.nextUrl.searchParams.get("language"));
  const region = normalizeCatalogRegion(request.nextUrl.searchParams.get("region"));
  const imdbId = cleanImdbId(request.nextUrl.searchParams.get("imdbId"));
  const logAction = cleanString(request.nextUrl.searchParams.get("logAction"));
  const logEntity = cleanString(request.nextUrl.searchParams.get("logEntity"));
  const logSearch = cleanString(request.nextUrl.searchParams.get("logSearch"));
  const now = new Date();
  const coldCutoff = new Date(now.getTime() - 14 * 86_400_000);

  const logWhere: Prisma.AdminActionLogWhereInput = {};
  const logAnd: Prisma.AdminActionLogWhereInput[] = [];
  if (logAction) logAnd.push({ action: { contains: logAction } });
  if (logEntity) logAnd.push({ entityType: logEntity });
  if (logSearch) {
    logAnd.push({
      OR: [
        { action: { contains: logSearch } },
        { entityId: { contains: logSearch } },
        { actorUserId: { contains: logSearch } },
      ],
    });
  }
  if (logAnd.length) logWhere.AND = logAnd;

  const candidateTitles = await db.poplog3Title.findMany({
    where: { imdbId: { not: null } },
    orderBy: [{ popularity: "desc" }, { voteCount: "desc" }, { updatedAt: "desc" }],
    take: 140,
    select: {
      imdbId: true,
      mediaType: true,
      title: true,
      slug: true,
      posterPath: true,
      backdropPath: true,
      overview: true,
      updatedAt: true,
    },
  });
  const candidateImdbIds = candidateTitles
    .map((title) => title.imdbId)
    .filter((id): id is string => Boolean(id));

  const [
    queueStats,
    providerRows,
    providerCounts,
    seoRows,
    translations,
    assets,
    failedJobs,
    engineErrors,
    logs,
    radarCaches,
    cacheInspection,
  ] = await Promise.all([
    getRefreshQueueStats(),
    db.catalogAvailability.findMany({
      where: {
        providerRegion: region,
        OR: [
          { providerName: "__none__" },
          { source: { not: "justwatch" } },
          { expiresAt: { lt: now } },
          { staleUntil: { lt: now } },
          { sourceConfidence: { in: ["low", "stale", "unverified"] } },
        ],
      },
      orderBy: [{ expiresAt: "asc" }, { checkedAt: "asc" }],
      take: 50,
      select: {
        id: true,
        imdbId: true,
        tmdbId: true,
        mediaType: true,
        providerName: true,
        providerType: true,
        providerRegion: true,
        providerLanguage: true,
        source: true,
        sourceConfidence: true,
        checkedAt: true,
        expiresAt: true,
        staleUntil: true,
      },
    }),
    Promise.all([
      db.catalogAvailability.count({ where: { providerRegion: region, expiresAt: { lt: now } } }),
      db.catalogAvailability.count({ where: { providerRegion: region, source: { not: "justwatch" } } }),
      db.catalogAvailability.count({ where: { providerRegion: region, providerName: "__none__" } }),
    ]),
    db.poplog3Title.findMany({
      where: {
        OR: [
          { imdbId: null },
          { slug: null },
          { title: null },
          { overview: null },
          { posterPath: null },
          { backdropPath: null },
        ],
      },
      orderBy: [{ popularity: "desc" }, { updatedAt: "desc" }],
      take: 50,
      select: {
        id: true,
        imdbId: true,
        mediaType: true,
        title: true,
        slug: true,
        overview: true,
        posterPath: true,
        backdropPath: true,
        updatedAt: true,
      },
    }),
    candidateImdbIds.length
      ? db.titleTranslation.findMany({
          where: { imdbId: { in: candidateImdbIds } },
          select: {
            imdbId: true,
            language: true,
            region: true,
            title: true,
            overview: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    candidateImdbIds.length
      ? db.titleAsset.findMany({
          where: { imdbId: { in: candidateImdbIds }, type: { in: ["poster", "backdrop"] } },
          select: {
            imdbId: true,
            type: true,
            language: true,
            region: true,
            assetKey: true,
            sourceUrl: true,
            isPrimary: true,
            updatedAt: true,
          },
        })
      : Promise.resolve([]),
    db.poplogRefreshQueue.findMany({
      where: { status: "failed" },
      orderBy: { updatedAt: "desc" },
      take: 25,
    }),
    db.engineApiCallLog.findMany({
      where: { success: false, ts: { gte: coldCutoff } },
      orderBy: { ts: "desc" },
      take: 25,
      select: {
        id: true,
        ts: true,
        api: true,
        op: true,
        origin: true,
        mediaType: true,
        tmdbId: true,
        cacheStatus: true,
        durationMs: true,
        httpStatus: true,
        error: true,
      },
    }),
    db.adminActionLog.findMany({
      where: logWhere,
      orderBy: { createdAt: "desc" },
      take: 80,
      select: {
        id: true,
        actorUserId: true,
        entityType: true,
        entityId: true,
        action: true,
        field: true,
        language: true,
        region: true,
        cacheInvalidated: true,
        createdAt: true,
      },
    }),
    db.continuitySectionCache.findMany({
      where: { sectionKey: { startsWith: "radar_trakt_general:" } },
      orderBy: { updatedAt: "desc" },
      take: 12,
      select: {
        sectionKey: true,
        region: true,
        language: true,
        updatedAt: true,
        expiresAt: true,
      },
    }),
    inspectTitleCache({ imdbId, language, region }),
  ]);

  const providerTitleMap = await titlesByImdb(
    providerRows.map((row) => row.imdbId).filter((id): id is string => Boolean(id)),
  );
  const translationByKey = new Map(
    translations.map((row) => [`${row.imdbId}:${row.language}:${row.region}`, row]),
  );
  const assetsByImdb = new Map<string, typeof assets>();
  for (const asset of assets) {
    const list = assetsByImdb.get(asset.imdbId) ?? [];
    list.push(asset);
    assetsByImdb.set(asset.imdbId, list);
  }

  const translationReview = candidateTitles
    .map((title) => {
      const titleImdbId = title.imdbId ?? "";
      const localized = translationByKey.get(`${titleImdbId}:${language}:${region}`);
      const languageOnly = translations.find((row) => row.imdbId === titleImdbId && row.language === language);
      const issues = [
        !localized ? "missing_locale" : null,
        localized && !localized.overview?.trim() ? "missing_overview" : null,
        !languageOnly ? "missing_language" : null,
      ].filter((issue): issue is string => Boolean(issue));
      return {
        imdbId: titleImdbId,
        mediaType: title.mediaType,
        title: title.title,
        slug: title.slug,
        issues,
        updatedAt: iso(localized?.updatedAt ?? title.updatedAt),
      };
    })
    .filter((row) => row.issues.length)
    .slice(0, 40);

  const assetReview = candidateTitles
    .map((title) => {
      const titleImdbId = title.imdbId ?? "";
      const titleAssets = assetsByImdb.get(titleImdbId) ?? [];
      const hasPosterAsset = titleAssets.some((asset) => asset.type === "poster" && asset.assetKey);
      const hasBackdropAsset = titleAssets.some((asset) => asset.type === "backdrop" && asset.assetKey);
      const issues = [
        !title.posterPath ? "missing_source_poster" : null,
        !hasPosterAsset ? "missing_local_poster" : null,
        title.backdropPath && !hasBackdropAsset ? "missing_local_backdrop" : null,
      ].filter((issue): issue is string => Boolean(issue));
      return {
        imdbId: titleImdbId,
        mediaType: title.mediaType,
        title: title.title,
        slug: title.slug,
        issues,
      };
    })
    .filter((row) => row.issues.length)
    .slice(0, 40);

  return {
    ok: true,
    generatedAt: now.toISOString(),
    locale: { language, region },
    alerts: {
      overdueJobs: queueStats.health.overdueQueued,
      staleRunningJobs: queueStats.health.staleRunning,
      failedJobs: queueStats.totals.failed ?? 0,
      cronHealthy: queueStats.health.lastCronHealthy,
      providerExpired: providerCounts[0],
      providerFallback: providerCounts[1],
      providerNegative: providerCounts[2],
      seoReview: seoRows.length,
      translationReview: translationReview.length,
      assetReview: assetReview.length,
      hydrationErrors: failedJobs.length + engineErrors.length,
    },
    workers: queueStats,
    providers: {
      problemRows: providerRows.map((row) => {
        const meta = row.imdbId ? providerTitleMap.get(row.imdbId) : null;
        return {
          ...row,
          id: row.id.toString(),
          tmdbId: row.tmdbId?.toString() ?? null,
          title: meta?.title ?? null,
          slug: meta?.slug ?? null,
          checkedAt: iso(row.checkedAt),
          expiresAt: iso(row.expiresAt),
          staleUntil: iso(row.staleUntil),
        };
      }),
    },
    seo: {
      rows: seoRows.map((row) => ({
        ...row,
        issues: [
          !row.imdbId ? "missing_imdb" : null,
          !row.slug ? "missing_slug" : null,
          !row.title ? "missing_title" : null,
          !row.overview ? "missing_overview" : null,
          !row.posterPath ? "missing_poster" : null,
          !row.backdropPath ? "missing_backdrop" : null,
        ].filter((issue): issue is string => Boolean(issue)),
        updatedAt: iso(row.updatedAt),
      })),
    },
    translations: { rows: translationReview },
    assets: { rows: assetReview },
    cache: cacheInspection,
    hydrationErrors: {
      failedJobs: failedJobs.map(serializeRefreshJob),
      engineErrors: engineErrors.map((row) => ({
        ...row,
        id: row.id.toString(),
        ts: iso(row.ts),
      })),
    },
    radar: {
      caches: radarCaches.map((row) => ({
        ...row,
        updatedAt: iso(row.updatedAt),
        expiresAt: iso(row.expiresAt),
      })),
    },
    logs: logs.map((log) => ({
      ...log,
      createdAt: iso(log.createdAt),
    })),
  };
}

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "catalog:read");

  return NextResponse.json(await dashboardSnapshot(request), {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  const body = await request.json().catch(() => ({} as Record<string, unknown>));
  const action = cleanString(body.action);
  const imdbId = cleanImdbId(body.imdbId);
  const mediaType = cleanMediaType(body.mediaType);
  const language = normalizeCatalogLanguage(cleanString(body.language));
  const region = normalizeCatalogRegion(cleanString(body.region));

  if (!action) {
    return NextResponse.json({ ok: false, error: "action required" }, { status: 400 });
  }

  if (action === "rehydrate-provider") {
    assertAdminPermission(context, "provider:write");
    if (!imdbId) return NextResponse.json({ ok: false, error: "imdbId required" }, { status: 400 });
    const title = await getTitleForAction(imdbId, mediaType);
    const effectiveMediaType = mediaType ?? title?.mediaType;
    if (!effectiveMediaType) return NextResponse.json({ ok: false, error: "mediaType required" }, { status: 400 });

    const result = await getTitleAvailabilityWithDebug({
      mediaType: effectiveMediaType,
      imdbId,
      tmdbId: title?.tmdbId ?? null,
      title: title?.title ?? null,
      year: title?.year ?? null,
      releaseDate: iso(title?.releaseDate),
      firstAirDate: iso(title?.firstAirDate),
      region,
      language,
      cacheOnly: false,
      bypassNegativeCache: true,
      bypassProviderCache: true,
      suppressAutoWarm: true,
    });

    await recordAdminAction({
      context,
      entityType: "provider",
      entityId: imdbId,
      action: "provider.rehydrate",
      language,
      region,
      nextJson: {
        state: result.summary.state,
        source: result.summary.source,
        providerCount: providerCount(result.summary),
        debug: result.debug.providerRequest,
      },
      metadata: { route: "/api/admin/operations" },
    });

    return NextResponse.json({
      ok: true,
      action,
      summary: {
        state: result.summary.state,
        source: result.summary.source,
        providerCount: providerCount(result.summary),
        bestProvider: result.summary.bestProvider,
      },
      debug: result.debug,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "rehydrate-title") {
    assertAdminPermission(context, "catalog:read");
    if (!imdbId) return NextResponse.json({ ok: false, error: "imdbId required" }, { status: 400 });
    const title = await getTitleForAction(imdbId, mediaType);
    const effectiveMediaType = mediaType ?? title?.mediaType;
    if (!effectiveMediaType) return NextResponse.json({ ok: false, error: "mediaType required" }, { status: 400 });

    const payload = await getTitlePageData({
      mediaType: effectiveMediaType,
      id: imdbId,
      sourceHint: "imdb",
      force: true,
      country: region,
      language,
      debugSource: true,
    });
    const cache = await invalidateCatalogCaches({ imdbId, language, region });

    await recordAdminAction({
      context,
      entityType: "title",
      entityId: imdbId,
      action: "title.rehydrate",
      language,
      region,
      nextJson: {
        found: Boolean(payload),
        title: payload?.title ?? null,
        mediaType: payload?.mediaType ?? effectiveMediaType,
      },
      cacheKey: cache.cacheKey,
      cacheInvalidated: cache.invalidated > 0,
      metadata: { route: "/api/admin/operations" },
    });

    return NextResponse.json({
      ok: true,
      action,
      title: payload ? { title: payload.title, mediaType: payload.mediaType, id: payload.id } : null,
      cache,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "rehydrate-episodes") {
    assertAdminPermission(context, "worker:write");
    if (!imdbId) return NextResponse.json({ ok: false, error: "imdbId required" }, { status: 400 });
    const title = await getTitleForAction(imdbId, "tv");
    if (!title) return NextResponse.json({ ok: false, error: "tv title not found" }, { status: 404 });

    if (body.runNow === true) {
      const result = await hydrateSeriesEpisodesFromSources({
        seriesTmdbId: title.tmdbId,
        imdbId,
        traktId: title.traktId?.toString() ?? null,
        title: title.title,
        year: title.year,
        numberOfSeasons: title.numberOfSeasons,
        force: true,
      });
      await recordAdminAction({
        context,
        entityType: "title",
        entityId: imdbId,
        action: "episodes.rehydrate_now",
        nextJson: result,
        metadata: { route: "/api/admin/operations" },
      });
      return NextResponse.json({ ok: true, action, result }, { headers: { "Cache-Control": "no-store" } });
    }

    const job = await enqueueSeriesEpisodeHydrationJob({
      seriesTmdbId: title.tmdbId,
      imdbId,
      traktId: title.traktId?.toString() ?? null,
      slug: title.slug,
      priority: 25,
    });
    await recordAdminAction({
      context,
      entityType: "worker",
      entityId: job.id.toString(),
      action: "episodes.enqueue_rehydrate",
      nextJson: serializeRefreshJob(job),
      metadata: { route: "/api/admin/operations", imdbId },
    });
    return NextResponse.json({ ok: true, action, job: serializeRefreshJob(job) }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "rehydrate-assets") {
    assertAdminPermission(context, "asset:write");
    if (!imdbId) return NextResponse.json({ ok: false, error: "imdbId required" }, { status: 400 });
    const result = await cacheKnownTitleAssets({ imdbId, language, region });
    const cache = await invalidateCatalogCaches({ imdbId, language, region });
    await recordAdminAction({
      context,
      entityType: "asset",
      entityId: imdbId,
      action: "asset.rehydrate",
      language,
      region,
      nextJson: {
        attempted: result.attempted,
        cached: result.cached.length,
        errors: result.errors,
      },
      cacheKey: cache.cacheKey,
      cacheInvalidated: cache.invalidated > 0,
      metadata: { route: "/api/admin/operations" },
    });
    return NextResponse.json({ ok: true, action, result, cache }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "clear-title-cache") {
    assertAdminPermission(context, "cache:write");
    if (!imdbId) return NextResponse.json({ ok: false, error: "imdbId required" }, { status: 400 });
    const cache = await invalidateCatalogCaches({ imdbId, language, region });
    const redisDeleted = await Promise.all([
      redisDeleteByPattern(`*${imdbId}*`),
      redisDeleteByPattern(`${titleCacheKey(imdbId, { catalogLanguage: language, region })}*`),
      redisDeleteByPattern(`${providersCacheKey(imdbId, region)}*`),
      redisDeleteByPattern(`${posterCacheKey(imdbId, language)}*`),
    ]).then((counts) => counts.reduce((sum, count) => sum + count, 0)).catch(() => 0);

    await recordAdminAction({
      context,
      entityType: "cache",
      entityId: imdbId,
      action: "cache.clear_title",
      language,
      region,
      nextJson: { dbDeleted: cache.invalidated, redisDeleted },
      cacheKey: cache.cacheKey,
      cacheInvalidated: cache.invalidated > 0 || redisDeleted > 0,
      metadata: { route: "/api/admin/operations" },
    });
    return NextResponse.json({ ok: true, action, cache, redisDeleted }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "reprocess-radar") {
    assertAdminPermission(context, "cache:write");
    await invalidateRadarCache(region, language);
    const deleted = await db.continuitySectionCache.deleteMany({
      where: { sectionKey: { startsWith: "radar_trakt_general:" }, region, language },
    });
    const key = radarCacheKey(region, language, RADAR_WINDOW_DAYS);
    const payload = await getRadarCachedPayload(key, region, language, () =>
      buildRadarGeneralPayload({ region, language, debug: true }),
    );
    await recordAdminAction({
      context,
      entityType: "radar",
      entityId: `${region}:${language}`,
      action: "radar.reprocess",
      language,
      region,
      nextJson: {
        deleted: deleted.count,
        sections: payload.stats.sectionCounts,
        normalizedEvents: payload.stats.normalizedEvents,
      },
      cacheKey: key,
      cacheInvalidated: deleted.count > 0,
      metadata: { route: "/api/admin/operations" },
    });
    return NextResponse.json({
      ok: true,
      action,
      deleted: deleted.count,
      stats: payload.stats,
      key,
    }, { headers: { "Cache-Control": "no-store" } });
  }

  if (action === "enqueue-title" || action === "enqueue-assets" || action === "enqueue-provider" || action === "enqueue-radar") {
    assertAdminPermission(context, "worker:write");
    const kind =
      action === "enqueue-provider" ? "availability" :
      action === "enqueue-assets" ? "assets" :
      action === "enqueue-radar" ? "radar" : "title";
    const title = imdbId ? await getTitleForAction(imdbId, mediaType) : null;
    const effectiveMediaType = mediaType ?? title?.mediaType ?? null;
    if (kind !== "radar" && !imdbId) {
      return NextResponse.json({ ok: false, error: "imdbId required" }, { status: 400 });
    }
    if ((kind === "availability" || kind === "title") && !effectiveMediaType) {
      return NextResponse.json({ ok: false, error: "mediaType required" }, { status: 400 });
    }
    const cacheKey =
      kind === "availability" && imdbId && effectiveMediaType
        ? `availability:${effectiveMediaType}:${imdbId}:${region}:${language}`
        : kind === "radar"
          ? `radar:any:${region}:${language}`
          : undefined;
    const job = await enqueueRefreshJob({
      kind,
      cacheKey,
      mediaType: effectiveMediaType,
      imdbId,
      poplogId: title?.tmdbId != null ? String(title.tmdbId) : null,
      traktId: title?.traktId ?? null,
      slug: title?.slug ?? null,
      priority: toNumber(body.priority) ?? 30,
    });
    await recordAdminAction({
      context,
      entityType: "worker",
      entityId: job.id.toString(),
      action: `worker.${kind}.enqueue`,
      nextJson: serializeRefreshJob(job),
      metadata: { route: "/api/admin/operations" },
    });
    return NextResponse.json({ ok: true, action, job: serializeRefreshJob(job) }, { headers: { "Cache-Control": "no-store" } });
  }

  return NextResponse.json(
    { ok: false, error: `Unknown action: ${action}` },
    { status: 400, headers: { "Cache-Control": "no-store" } },
  );
}
