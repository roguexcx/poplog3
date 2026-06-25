import { NextRequest, NextResponse } from "next/server";

import {
  adminContextFromRequest,
  assertAdminPermission,
  saveTitleOverride,
} from "@/server/admin/admin-actions";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { db } from "@/server/db/client";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
} from "@/server/source-engine/locale";
import { resolveAssetUrl } from "@/server/source-engine/asset-urls";

type RouteContext = { params: Promise<{ imdbId: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "catalog:read");

  const { imdbId } = await params;
  if (!/^tt\d+$/i.test(imdbId)) {
    return NextResponse.json({ ok: false, error: "IMDb inválido." }, { status: 400 });
  }

  const type = request.nextUrl.searchParams.get("type") ?? "poster";
  const assets = await db.titleAsset.findMany({
    where: { imdbId, type },
    orderBy: [{ isOverride: "desc" }, { isPrimary: "desc" }, { language: "asc" }, { createdAt: "desc" }],
    take: 100,
  });

  return NextResponse.json(
    {
      ok: true,
      assets: assets.map((asset) => ({
        ...asset,
        publicUrl: resolveAssetUrl(asset.assetKey ?? asset.sourceUrl),
        createdAt: asset.createdAt.toISOString(),
        updatedAt: asset.updatedAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "asset:write");

  const { imdbId } = await params;
  const body = await request.json().catch(() => null) as {
    assetId?: string;
    language?: string | null;
    region?: string | null;
    reason?: string | null;
  } | null;

  if (!/^tt\d+$/i.test(imdbId)) {
    return NextResponse.json({ ok: false, error: "IMDb inválido." }, { status: 400 });
  }
  if (!body?.assetId) {
    return NextResponse.json({ ok: false, error: "assetId obrigatório." }, { status: 400 });
  }

  const asset = await db.titleAsset.findFirst({
    where: { id: body.assetId, imdbId, type: "poster" },
  });
  if (!asset) return NextResponse.json({ ok: false, error: "Asset não encontrado." }, { status: 404 });

  const language = normalizeCatalogLanguage(body.language ?? asset.language);
  const region = normalizeCatalogRegion(body.region ?? asset.region);

  await db.titleAsset.updateMany({
    where: { imdbId, type: "poster", language, region },
    data: { isPrimary: false, isOverride: false },
  });
  const selected = await db.titleAsset.update({
    where: { id: asset.id },
    data: { isPrimary: true, isOverride: true, language, region },
  });

  const result = await saveTitleOverride({
    context,
    imdbId,
    field: "poster",
    language,
    region,
    value: {
      assetId: selected.id,
      assetKey: selected.assetKey,
      sourceUrl: selected.sourceUrl,
      publicUrl: resolveAssetUrl(selected.assetKey ?? selected.sourceUrl),
    },
    reason: body.reason ?? "Seleção manual de pôster",
  });

  return NextResponse.json({
    ok: true,
    asset: {
      ...selected,
      publicUrl: resolveAssetUrl(selected.assetKey ?? selected.sourceUrl),
      createdAt: selected.createdAt.toISOString(),
      updatedAt: selected.updatedAt.toISOString(),
    },
    override: {
      ...result.override,
      createdAt: result.override.createdAt.toISOString(),
      updatedAt: result.override.updatedAt.toISOString(),
    },
    cache: { key: result.cacheKey, invalidated: result.invalidated },
  });
}
