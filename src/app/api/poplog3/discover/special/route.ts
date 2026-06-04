import { NextRequest, NextResponse } from "next/server";

export async function GET(_request: NextRequest) {
  return NextResponse.json({
    ok: false,
    disabled: true,
    reason: "TMDB discover/special removed",
    results: [],
    popular: [],
    popularSeries: [],
    popularMovies: [],
  });
}
