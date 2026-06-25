import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";
import { getTraktClientStatus } from "@/server/api-clients/trakt/client";

export async function GET(request: Request) {
  if (!(await isAdminRequest(request))) return adminUnauthorizedResponse();

  return NextResponse.json({
    ok: true,
    service: "poplog3",
    env: {
      tmdb: Boolean(process.env.TMDB_ACCESS_TOKEN),
      watchmode: Boolean(process.env.WATCHMODE_API_KEY),
      movieofthenight: Boolean(process.env.MOVIEOFTHENIGHT_API_KEY),
      trakt: getTraktClientStatus(),
      databaseUrl: Boolean(process.env.DATABASE_URL),
      authSecret: Boolean(process.env.AUTH_SECRET),
      authGoogleId: Boolean(process.env.AUTH_GOOGLE_ID),
      localAuthEnabled: process.env.POPLOG_LOCAL_AUTH_ENABLED === "true",
    },
  });
}
