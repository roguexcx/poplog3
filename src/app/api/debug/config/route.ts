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
  supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  supabaseServiceRole: Boolean(
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ),
},
  });
}
