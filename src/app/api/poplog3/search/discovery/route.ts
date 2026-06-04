import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: false,
    disabled: true,
    reason: "TMDB discovery removed",
    trending: [],
    popularMovies: [],
    popularSeries: [],
    genres: [],
  });
}
