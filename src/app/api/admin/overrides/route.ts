import { NextRequest, NextResponse } from "next/server";

import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import {
  adminContextFromRequest,
  assertAdminPermission,
  saveTitleOverride,
} from "@/server/admin/admin-actions";
import { db } from "@/server/db/client";
import {
  normalizeCatalogLanguage,
  normalizeCatalogRegion,
} from "@/server/source-engine/locale";

const ALLOWED_FIELDS = new Set([
  "poster",
  "title",
  "overview",
  "provider",
  "trailer",
  "tags",
  "aliases",
]);

export async function GET(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  assertAdminPermission(context, "catalog:read");

  const imdbId = request.nextUrl.searchParams.get("imdbId")?.trim();
  if (!imdbId || !/^tt\d+$/i.test(imdbId)) {
    return NextResponse.json({ ok: false, error: "Use imdbId=tt..." }, { status: 400 });
  }

  const rows = await db.titleOverride.findMany({
    where: {
      imdbId,
      field: request.nextUrl.searchParams.get("field") ?? undefined,
      active: request.nextUrl.searchParams.get("active") === "1" ? true : undefined,
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return NextResponse.json(
    {
      ok: true,
      overrides: rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: NextRequest) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const context = await adminContextFromRequest(request);
  const body = await request.json().catch(() => null) as {
    imdbId?: string;
    field?: string;
    language?: string | null;
    region?: string | null;
    value?: unknown;
    reason?: string | null;
  } | null;

  if (!body?.imdbId || !/^tt\d+$/i.test(body.imdbId)) {
    return NextResponse.json({ ok: false, error: "imdbId inválido." }, { status: 400 });
  }
  if (!body.field || !ALLOWED_FIELDS.has(body.field)) {
    return NextResponse.json({ ok: false, error: "Campo de override inválido." }, { status: 400 });
  }
  if (body.value === undefined) {
    return NextResponse.json({ ok: false, error: "value é obrigatório." }, { status: 400 });
  }

  try {
    const result = await saveTitleOverride({
      context,
      imdbId: body.imdbId,
      field: body.field,
      language: body.language ? normalizeCatalogLanguage(body.language) : null,
      region: body.region ? normalizeCatalogRegion(body.region) : null,
      value: body.value,
      reason: body.reason ?? null,
    });

    return NextResponse.json({
      ok: true,
      override: {
        ...result.override,
        createdAt: result.override.createdAt.toISOString(),
        updatedAt: result.override.updatedAt.toISOString(),
      },
      cache: { key: result.cacheKey, invalidated: result.invalidated },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("Missing admin permission") ? 403 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
