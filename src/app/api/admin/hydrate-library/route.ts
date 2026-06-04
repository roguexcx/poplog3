import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const adminSecret = request.headers.get("x-admin-secret");

  if (adminSecret !== process.env.ADMIN_SECRET) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    {
      ok: false,
      error: "TMDB hydration removed",
      note: "Balloonerismm/TVDB hydration pending",
      usedTmdbApi: false,
    },
    { status: 410 },
  );
}
