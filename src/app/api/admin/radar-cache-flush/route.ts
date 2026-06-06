import { NextResponse } from "next/server";
import { db } from "@/server/db/client";
import { invalidateRadarCache } from "@/server/radar-trakt/radar-cache.service";

function isAuthorized(req: Request): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get("x-admin-secret") === secret;
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rows = await db.continuitySectionCache.findMany({
    where: { sectionKey: { startsWith: "radar_trakt_general:" } },
    orderBy: { updatedAt: "desc" },
    take: 10,
  });

  return NextResponse.json({
    ok: true,
    source: "trakt",
    caches: rows.map((row) => ({
      key: row.sectionKey,
      region: row.region,
      language: row.language,
      cachedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      ageHours: Number(((Date.now() - row.updatedAt.getTime()) / 3_600_000).toFixed(2)),
    })),
  });
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const triggerRebuild = url.searchParams.get("rebuild") !== "false";
  await invalidateRadarCache();
  const deleted = await db.continuitySectionCache.deleteMany({
    where: { sectionKey: { startsWith: "radar_trakt_general:" } },
  });

  let rebuildTriggered = false;
  if (triggerRebuild) {
    const origin = new URL(req.url).origin;
    void fetch(`${origin}/api/radar?mode=general`, {
      method: "GET",
      headers: { "x-background-refresh": "1" },
    }).catch((err: unknown) => {
      console.warn("[radar-cache-flush] rebuild trigger failed:", err);
    });
    rebuildTriggered = true;
  }

  return NextResponse.json({
    ok: true,
    source: "trakt",
    flushed: true,
    deleted: deleted.count,
    rebuildTriggered,
  });
}
