import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const adminSecret = request.headers.get("x-admin-secret");

  if (!process.env.ADMIN_SECRET || adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "TMDB season hydration removed",
      note: "TVDB season hydration pending",
      usedTmdbApi: false,
    },
    { status: 410 },
  );
}
