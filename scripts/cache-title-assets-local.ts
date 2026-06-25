import "dotenv/config";

import { db } from "@/server/db/client";
import {
  type AssetFormat,
  type AssetKind,
  type AssetVariant,
  buildAssetKey,
  getStorageProvider,
} from "@/server/source-engine/storage";
import { normalizeCatalogLanguage, normalizeCatalogRegion } from "@/server/source-engine/locale";

type SharpLike = (input: Buffer) => {
  metadata(): Promise<{ width?: number; height?: number; format?: string }>;
  resize(input: { width?: number; height?: number; withoutEnlargement?: boolean }): SharpPipeline;
};

type SharpPipeline = {
  webp(input?: { quality?: number }): { toBuffer(): Promise<Buffer> };
  avif(input?: { quality?: number }): { toBuffer(): Promise<Buffer> };
};

const VARIANT_WIDTH: Record<AssetVariant, number | null> = {
  card: 342,
  detail: 780,
  hero: 1280,
  main: null,
};

function arg(name: string, fallback?: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.find((item) => item.startsWith(prefix))?.slice(prefix.length) ?? fallback;
}

function isAssetKind(value: string): value is AssetKind {
  return value === "poster" || value === "backdrop" || value === "profile" || value === "logo";
}

function isAssetVariant(value: string): value is AssetVariant {
  return value === "card" || value === "detail" || value === "hero" || value === "main";
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
      "User-Agent": "POPLOG/2.0 local-asset-worker",
    },
  });
  if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}.`);

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  if (!contentType.startsWith("image/")) throw new Error(`Unsupported content-type: ${contentType}.`);

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
  format: string;
  variant: string;
  isPrimary: boolean;
}) {
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
    metadata: {
      format: input.format,
      variant: input.variant,
      worker: "cache-title-assets-local",
    },
  };

  if (existing) {
    await db.titleAsset.update({ where: { id: existing.id }, data });
    return existing.id;
  }

  const row = await db.titleAsset.create({ data });
  return row.id;
}

async function main() {
  const imdbId = arg("imdb");
  const url = arg("url");
  const kindRaw = arg("kind", "poster")!;
  const language = normalizeCatalogLanguage(arg("language", "pt-BR"));
  const region = normalizeCatalogRegion(arg("region", "BR"));
  const source = arg("source", "manual")!;
  const variantRaw = arg("variant", "main")!;

  if (!imdbId || !/^tt\d+$/i.test(imdbId)) throw new Error("Use --imdb=tt... para registrar o asset.");
  if (!url || !/^https:\/\//i.test(url)) throw new Error("Use --url=https://... para baixar a imagem.");
  if (!isAssetKind(kindRaw)) throw new Error("Use --kind=poster|backdrop|profile|logo.");
  if (!isAssetVariant(variantRaw)) throw new Error("Use --variant=main|card|detail|hero.");

  const { buffer, contentType } = await downloadImage(url);
  const storage = getStorageProvider();
  const sharp = await loadSharp();
  const written: Array<{ assetKey: string; format: string; variant: AssetVariant; width?: number; height?: number }> = [];

  if (sharp) {
    const source = sharp(buffer);
    const metadata = await source.metadata();
    const variants = variantRaw === "main"
      ? (["main", "card", "detail", "hero"] as AssetVariant[])
      : [variantRaw];

    for (const variant of variants) {
      const width = VARIANT_WIDTH[variant] ?? metadata.width;
      const pipeline = sharp(buffer).resize({
        width: VARIANT_WIDTH[variant] ?? undefined,
        withoutEnlargement: true,
      });
      const webp = await pipeline.webp({ quality: 82 }).toBuffer();
      const webpKey = buildAssetKey({ imdbId, kind: kindRaw, language, variant, format: "webp" });
      await storage.write({ assetKey: webpKey, buffer: webp, contentType: "image/webp" });
      written.push({ assetKey: webpKey, format: "webp", variant, width, height: metadata.height });

      try {
        const avif = await sharp(buffer)
          .resize({ width: VARIANT_WIDTH[variant] ?? undefined, withoutEnlargement: true })
          .avif({ quality: 58 })
          .toBuffer();
        const avifKey = buildAssetKey({ imdbId, kind: kindRaw, language, variant, format: "avif" });
        await storage.write({ assetKey: avifKey, buffer: avif, contentType: "image/avif" });
        written.push({ assetKey: avifKey, format: "avif", variant, width, height: metadata.height });
      } catch {
        console.warn(`[asset-worker] AVIF skipped for ${variant}.`);
      }
    }
  } else {
    const format = sourceFormat(contentType, url);
    const assetKey = buildAssetKey({ imdbId, kind: kindRaw, language, variant: variantRaw, format });
    await storage.write({ assetKey, buffer, contentType });
    written.push({ assetKey, format, variant: variantRaw });
    console.warn("[asset-worker] sharp not installed; stored original image without WebP/AVIF variants.");
  }

  for (const asset of written) {
    await upsertAsset({
      imdbId,
      kind: kindRaw,
      language,
      region,
      assetKey: asset.assetKey,
      sourceUrl: url,
      source,
      width: asset.width ?? null,
      height: asset.height ?? null,
      format: asset.format,
      variant: asset.variant,
      isPrimary: asset.variant === "main" && asset.format === "webp",
    });
  }

  console.log("[asset-worker] done", {
    imdbId,
    kind: kindRaw,
    language,
    region,
    written: written.map((item) => item.assetKey),
  });
}

main()
  .catch((error) => {
    console.error("[asset-worker] failed", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect().catch(() => undefined);
  });
