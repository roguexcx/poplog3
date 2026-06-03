import { NextResponse } from "next/server";
import { adminUnauthorizedResponse, isAdminRequest } from "@/server/auth/admin-guard";

export async function GET(request: Request) {
  if (!isAdminRequest(request)) return adminUnauthorizedResponse();

  return NextResponse.json({
    ok: true,
    service: "poplog3",
    env: {
      tmdb: Boolean(process.env.TMDB_ACCESS_TOKEN),
      omdb: Boolean(process.env.OMDB_API_KEY),
      watchmode: Boolean(process.env.WATCHMODE_API_KEY),
      movieofthenight: Boolean(process.env.MOVIEOFTHENIGHT_API_KEY),
      databaseUrl: Boolean(process.env.DATABASE_URL),
      authSecret: Boolean(process.env.AUTH_SECRET),
      authGoogleId: Boolean(process.env.AUTH_GOOGLE_ID),
      localAuthEnabled: process.env.POPLOG_LOCAL_AUTH_ENABLED === "true",
    },
  });
}
