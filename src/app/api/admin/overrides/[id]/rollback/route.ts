import { NextRequest, NextResponse } from "next/server";

import { rollbackTitleOverride, adminContextFromRequest } from "@/server/admin/admin-actions";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: RouteContext) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { reason?: string | null };
  const context = await adminContextFromRequest(request);

  try {
    const result = await rollbackTitleOverride({
      context,
      overrideId: id,
      reason: body.reason ?? null,
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status =
      message === "Override not found." ? 404 :
      message.startsWith("Missing admin permission") ? 403 :
      500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
