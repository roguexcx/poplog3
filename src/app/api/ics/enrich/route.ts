import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    ok: false,
    disabled: true,
    usedTmdbApi: false,
    skippedReasons: ["tmdb_enrichment_removed"],
    results: {},
  });
}
