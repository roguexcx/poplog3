import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import {
  adminContextFromRequest,
  assertAdminPermission,
} from "@/server/admin/admin-actions";
import { db } from "@/server/db/client";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
} from "@/server/source-engine/locale";
import { resolveAssetUrl } from "@/server/source-engine/asset-urls";

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "catalog:read");

  const imdbId = request.nextUrl.searchParams.get("imdbId")?.trim();
  if (!imdbId || !/^tt\d+$/i.test(imdbId)) {
    return NextResponse.json(
      { ok: false, error: "Use imdbId=tt..." },
      { status: 400, headers: { "Cache-Control": "no-store" } },
    );
  }

  const language = normalizeCatalogLanguage(request.nextUrl.searchParams.get("language"));
  const region = normalizeCatalogRegion(request.nextUrl.searchParams.get("region"));

  const [
    title,
    sourceIdentities,
    translations,
    aliases,
    assets,
    providers,
    overrides,
    logs,
    libraryCount,
  ] = await Promise.all([
    db.poplog3Title.findFirst({
      where: { imdbId },
      select: {
        id: true,
        imdbId: true,
        tmdbId: true,
        traktId: true,
        slug: true,
        mediaType: true,
        title: true,
        originalTitle: true,
        overview: true,
        posterPath: true,
        backdropPath: true,
        year: true,
        source: true,
        cacheStatus: true,
        updatedAt: true,
      },
    }),
    db.titleSourceIdentity.findMany({
      where: { imdbId },
      orderBy: [{ source: "asc" }, { externalId: "asc" }],
    }),
    db.titleTranslation.findMany({
      where: { imdbId },
      orderBy: [{ language: "asc" }, { region: "asc" }],
    }),
    db.titleAlias.findMany({
      where: { imdbId },
      orderBy: [{ language: "asc" }, { value: "asc" }],
      take: 100,
    }),
    db.titleAsset.findMany({
      where: { imdbId },
      orderBy: [{ isOverride: "desc" }, { isPrimary: "desc" }, { language: "asc" }, { createdAt: "desc" }],
      take: 80,
    }),
    db.catalogAvailability.findMany({
      where: { imdbId, providerRegion: region },
      orderBy: [{ providerType: "asc" }, { providerName: "asc" }],
      take: 80,
    }),
    db.titleOverride.findMany({
      where: { imdbId },
      orderBy: [{ active: "desc" }, { createdAt: "desc" }],
      take: 80,
    }),
    db.adminActionLog.findMany({
      where: { entityType: "title", entityId: imdbId },
      orderBy: { createdAt: "desc" },
      take: 80,
    }),
    db.userLibraryIdentity.count({ where: { imdbId } }).catch(() => 0),
  ]);

  return NextResponse.json(
    {
      ok: true,
      locale: { language, region },
      title: title
        ? {
            ...title,
            traktId: title.traktId?.toString() ?? null,
            updatedAt: title.updatedAt.toISOString(),
            posterUrl: resolveAssetUrl(title.posterPath),
            backdropUrl: resolveAssetUrl(title.backdropPath),
          }
        : null,
      sourceIdentities,
      translations,
      aliases,
      assets: assets.map((asset) => ({
        ...asset,
        publicUrl: resolveAssetUrl(asset.assetKey ?? asset.sourceUrl),
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
      })),
      providers: providers.map((provider) => ({
        ...provider,
        id: provider.id.toString(),
        traktId: provider.traktId?.toString() ?? null,
        tmdbId: provider.tmdbId?.toString() ?? null,
        checkedAt: provider.checkedAt.toISOString(),
        expiresAt: provider.expiresAt.toISOString(),
        createdAt: provider.createdAt.toISOString(),
        updatedAt: provider.updatedAt.toISOString(),
      })),
      overrides: overrides.map((override) => ({
        ...override,
        createdAt: override.createdAt.toISOString(),
        updatedAt: override.updatedAt.toISOString(),
      })),
      logs: logs.map((log) => ({
        ...log,
        createdAt: log.createdAt.toISOString(),
      })),
      library: { usersWithTitle: libraryCount },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
