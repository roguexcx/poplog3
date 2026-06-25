import { NextRequest, NextResponse } from "next/server";

import {
  adminContextFromRequest,
  assertAdminPermission,
  recordAdminAction,
} from "@/server/admin/admin-actions";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { db } from "@/server/db/client";

export async function DELETE(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "cache:write");

  const body = await request.json().catch(() => ({})) as {
    sectionKey?: string;
    userId?: string | null;
    region?: string | null;
    language?: string | null;
  };

  const result = await db.continuitySectionCache.deleteMany({
    where: {
      sectionKey: body.sectionKey,
      userId: body.userId ?? undefined,
      region: body.region ?? undefined,
      language: body.language ?? undefined,
    },
  });

  await recordAdminAction({
    context,
    entityType: "cache",
    entityId: body.sectionKey ?? "continuity_section_cache",
    action: "cache.clear",
    nextJson: {
      sectionKey: body.sectionKey ?? null,
      userId: body.userId ?? null,
      region: body.region ?? null,
      language: body.language ?? null,
      deleted: result.count,
    },
    cacheInvalidated: result.count > 0,
  });

  return NextResponse.json({ ok: true, deleted: result.count });
}
