import { NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { sanitizeAssetKey } from "@/server/source-engine/asset-keys";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ path?: string[] }> };

function localAssetPath(assetKey: string): string {
  const safeKey = sanitizeAssetKey(assetKey);
  const root = path.join(process.cwd(), "storage");
  const absolute = path.join(root, safeKey);
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Asset key escapes local storage root.");
  }
  return absolute;
}

function contentTypeForAssetKey(assetKey: string): string {
  const ext = path.extname(assetKey).toLowerCase();
  if (ext === ".webp") return "image/webp";
  if (ext === ".avif") return "image/avif";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

export async function GET(_request: Request, { params }: RouteContext) {
  const { path = [] } = await params;
  const rawKey = path.join("/");

  let assetKey: string;
  try {
    assetKey = sanitizeAssetKey(rawKey);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid asset key." }, { status: 400 });
  }

  let buffer: Buffer;
  let info;
  try {
    const filePath = localAssetPath(assetKey);
    [buffer, info] = await Promise.all([readFile(filePath), stat(filePath)]);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[storage] local asset read failed", { assetKey, error });
    }
    return NextResponse.json({ ok: false, error: "Asset not found." }, { status: 404 });
  }

  const body = buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer;

  return new NextResponse(body, {
    headers: {
      "Content-Type": contentTypeForAssetKey(assetKey),
      "Content-Length": String(info.size),
      "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
      "Last-Modified": info.mtime.toUTCString(),
      "X-Poplog-Asset-Key": assetKey,
      "X-Poplog-Storage": "local",
    },
  });
}
