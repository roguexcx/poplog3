import { Prisma } from "@prisma/client";

import { resolveCatalogImage } from "@/lib/images/resolve";
import { db } from "@/server/db/client";
import type { AssetKind } from "@/server/source-engine/asset-keys";
import {
  buildAssetKey,
  getStorageProvider,
  type AssetFormat,
  type AssetVariant,
} from "@/server/source-engine/storage";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
} from "@/server/source-engine/locale";

type SharpLike = (input: Buffer) => {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  resize(input: { width?: number; withoutEnlargement?: boolean }): SharpPipeline;
};

type SharpPipeline = {
  webp(input?: { quality?: number }): { toBuffer(): Promise<Buffer> };
  avif(input?: { quality?: number }): { toBuffer(): Promise<Buffer> };
};

type CachedAsset = {
  id: string;
  assetKey: string;
  kind: AssetKind;
  format: AssetFormat;
  variant: AssetVariant;
  width: number | null;
  height: number | null;
};

const VARIANT_WIDTH: Record<AssetVariant, number | null> = {
  card: 342,
  detail: 780,
  hero: 1280,
  main: null,
};

function isAssetKind(value: string): value is AssetKind {
  return value === "poster" || value === "backdrop" || value === "profile" || value === "logo";
}

function sourceFormat(contentType: string, url: string): AssetFormat {
  const lowerUrl = url.toLowerCase();
  if (contentType.includes("png") || lowerUrl.endsWith(".png")) return "png";
  if (contentType.includes("avif") || lowerUrl.endsWith(".avif")) return "avif";
  if (contentType.includes("webp") || lowerUrl.endsWith(".webp")) return "webp";
  return "jpg";
}

async function loadSharp(): Promise<SharpLike | null> {
  try {
    const moduleName = "sharp";
    const mod = await import(moduleName);
    return (mod.default ?? mod) as SharpLike;
  } catch {
    return null;
  }
}

async function downloadImage(url: string): Promise<{ buffer: Buffer; contentType: string }> {
  const response = await fetch(url, {
    headers: {
      Accept: "image/avif,image/webp,image/*,*/*;q=0.8",
      "User-Agent": "POPLOG/2.0 local-admin-asset-worker",
    },
  });
  if (!response.ok) throw new Error(`Image download failed with HTTP ${response.status}.`);

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/")) throw new Error(`Unsupported image content-type: ${contentType}.`);

  return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
}

async function upsertAsset(input: {
  imdbId: string;
  kind: AssetKind;
  language: string;
  region: string;
  assetKey: string;
  sourceUrl: string;
  source: string;
  width?: number | null;
  height?: number | null;
  format: AssetFormat;
  variant: AssetVariant;
  isPrimary: boolean;
}): Promise<CachedAsset> {
  const metadata: Prisma.InputJsonValue = {
    format: input.format,
    variant: input.variant,
    worker: "admin-asset-worker",
  };
  const data = {
    imdbId: input.imdbId,
    type: input.kind,
    language: input.language,
    region: input.region,
    assetKey: input.assetKey,
    sourceUrl: input.sourceUrl,
    source: input.source,
    width: input.width ?? null,
    height: input.height ?? null,
    isPrimary: input.isPrimary,
    isOverride: false,
    metadata,
  };
  const existing = await db.titleAsset.findFirst({
    where: {
      imdbId: input.imdbId,
      type: input.kind,
      language: input.language,
      region: input.region,
      assetKey: input.assetKey,
    },
    select: { id: true },
  });

  const row = existing
    ? await db.titleAsset.update({ where: { id: existing.id }, data })
    : await db.titleAsset.create({ data });

  return {
    id: row.id,
    assetKey: input.assetKey,
    kind: input.kind,
    format: input.format,
    variant: input.variant,
    width: input.width ?? null,
    height: input.height ?? null,
  };
}

export async function cacheTitleAssetFromUrl(input: {
  imdbId: string;
  kind: AssetKind;
  url: string;
  language?: string | null;
  region?: string | null;
  source?: string | null;
  variants?: AssetVariant[];
}): Promise<CachedAsset[]> {
  if (!/^tt\d+$/i.test(input.imdbId)) throw new Error("Invalid IMDb id.");
  if (!isAssetKind(input.kind)) throw new Error("Invalid asset kind.");

  const resolvedUrl = resolveCatalogImage(input.url, input.kind === "backdrop" ? "w1280" : "w780");
  if (!resolvedUrl || !/^https:\/\//i.test(resolvedUrl)) {
    throw new Error("Asset source must resolve to HTTPS.");
  }

  const language = normalizeCatalogLanguage(input.language);
  const region = normalizeCatalogRegion(input.region);
  const { buffer, contentType } = await downloadImage(resolvedUrl);
  const storage = getStorageProvider();
  const sharp = await loadSharp();
  const written: CachedAsset[] = [];
  const variants: AssetVariant[] = input.variants?.length
    ? input.variants
    : ["main", "card", "detail", "hero"];

  if (sharp) {
    const metadata = await sharp(buffer).metadata();
    for (const variant of variants) {
      const width = VARIANT_WIDTH[variant] ?? metadata.width ?? null;
      const resizeWidth = VARIANT_WIDTH[variant] ?? undefined;
      const webpBuffer = await sharp(buffer)
        .resize({ width: resizeWidth, withoutEnlargement: true })
        .webp({ quality: 82 })
        .toBuffer();
      const webpKey = buildAssetKey({
        imdbId: input.imdbId,
        kind: input.kind,
        language,
        variant,
        format: "webp",
      });
      await storage.write({ assetKey: webpKey, buffer: webpBuffer, contentType: "image/webp" });
      written.push(await upsertAsset({
        imdbId: input.imdbId,
        kind: input.kind,
        language,
        region,
        assetKey: webpKey,
        sourceUrl: resolvedUrl,
        source: input.source ?? "admin",
        width,
        height: metadata.height ?? null,
        format: "webp",
        variant,
        isPrimary: variant === "main" && input.kind === "poster",
      }));

      try {
        const avifBuffer = await sharp(buffer)
          .resize({ width: resizeWidth, withoutEnlargement: true })
          .avif({ quality: 58 })
          .toBuffer();
        const avifKey = buildAssetKey({
          imdbId: input.imdbId,
          kind: input.kind,
          language,
          variant,
          format: "avif",
        });
        await storage.write({ assetKey: avifKey, buffer: avifBuffer, contentType: "image/avif" });
        written.push(await upsertAsset({
          imdbId: input.imdbId,
          kind: input.kind,
          language,
          region,
          assetKey: avifKey,
          sourceUrl: resolvedUrl,
          source: input.source ?? "admin",
          width,
          height: metadata.height ?? null,
          format: "avif",
          variant,
          isPrimary: false,
        }));
      } catch {
        // AVIF support is optional in the local image pipeline.
      }
    }
    return written;
  }

  const format = sourceFormat(contentType, resolvedUrl);
  const variant = variants[0] ?? "main";
  const assetKey = buildAssetKey({ imdbId: input.imdbId, kind: input.kind, language, variant, format });
  await storage.write({ assetKey, buffer, contentType });
  written.push(await upsertAsset({
    imdbId: input.imdbId,
    kind: input.kind,
    language,
    region,
    assetKey,
    sourceUrl: resolvedUrl,
    source: input.source ?? "admin",
    format,
    variant,
    isPrimary: input.kind === "poster",
  }));
  return written;
}

export async function cacheKnownTitleAssets(input: {
  imdbId: string;
  language?: string | null;
  region?: string | null;
}) {
  const title = await db.poplog3Title.findFirst({
    where: { imdbId: input.imdbId },
    select: { posterPath: true, backdropPath: true },
  });
  const existing = await db.titleAsset.findMany({
    where: { imdbId: input.imdbId, sourceUrl: { not: null } },
    orderBy: [{ isPrimary: "desc" }, { updatedAt: "desc" }],
    take: 20,
    select: { type: true, sourceUrl: true },
  });

  const candidates = new Map<string, { kind: AssetKind; url: string }>();
  if (title?.posterPath) candidates.set(`poster:${title.posterPath}`, { kind: "poster", url: title.posterPath });
  if (title?.backdropPath) candidates.set(`backdrop:${title.backdropPath}`, { kind: "backdrop", url: title.backdropPath });
  for (const asset of existing) {
    if (!asset.sourceUrl || !isAssetKind(asset.type)) continue;
    candidates.set(`${asset.type}:${asset.sourceUrl}`, { kind: asset.type, url: asset.sourceUrl });
  }

  const cached: CachedAsset[] = [];
  const errors: Array<{ url: string; error: string }> = [];
  for (const candidate of candidates.values()) {
    try {
      cached.push(...await cacheTitleAssetFromUrl({
        imdbId: input.imdbId,
        kind: candidate.kind,
        url: candidate.url,
        language: input.language,
        region: input.region,
        source: "admin-rehydrate",
      }));
    } catch (error) {
      errors.push({
        url: candidate.url,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    attempted: candidates.size,
    cached,
    errors,
  };
}
