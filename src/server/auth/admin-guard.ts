import { NextResponse } from "next/server";

import { getCurrentUser } from "@/server/auth/get-current-user";
import { db } from "@/server/db/client";

async function currentUserIsAdmin(): Promise<boolean> {
  const user = await getCurrentUser().catch(() => null);
  if (!user?.id) return false;

  const row = await db.user.findUnique({
    where: { id: user.id },
    select: { role: true, accessStatus: true },
  }).catch(() => null);

  return Boolean(row && row.accessStatus !== "blocked" && (row.role === "admin" || row.role === "master"));
}

export async function isAdminRequest(request: Request): Promise<boolean> {
  const secret = process.env.ADMIN_SECRET;
  if (secret && request.headers.get("x-admin-secret") === secret) return true;

  return currentUserIsAdmin();
}

export function adminUnauthorizedResponse() {
  return NextResponse.json(
    { ok: false, error: "Unauthorized" },
    { status: 401, headers: { "Cache-Control": "no-store" } },
  );
}

