import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { getTraktClientStatus, traktGet } from "@/server/api-clients/trakt/client";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  const data = await traktGet<unknown[]>("/movies/popular", {
    ttlSeconds: 300,
    cache: "no-store",
  });

  return NextResponse.json({
    ok: Boolean(data),
    status: getTraktClientStatus(),
    sampleCount: Array.isArray(data) ? data.length : 0,
    sample: Array.isArray(data) ? data.slice(0, 2) : null,
  });
}
