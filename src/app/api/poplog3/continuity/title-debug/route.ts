import { NextResponse } from "next/server";

import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  return NextResponse.json(
    { ok: false, message: "Requires MySQL/Prisma — not yet implemented" },
    { status: 501 },
  );
}
