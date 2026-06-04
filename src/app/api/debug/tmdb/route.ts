import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json(
    {
      ok: false,
      error: "TMDB debug route removed",
      usedTmdbApi: false,
    },
    { status: 410 },
  );
}
