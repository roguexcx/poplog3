import { NextRequest, NextResponse } from "next/server";

export async function GET(
  _request: NextRequest,
  context: {
    params: Promise<{ id: string }>;
  }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json(
      { ok: false, error: "Missing person id" },
      { status: 400 }
    );
  }

  return NextResponse.json({
    ok: false,
    error: "Person data unavailable",
    person: null,
    knownFor: [],
    acting: [],
    directing: [],
    creating: [],
    appearances: [],
    _debug: {
      usedTmdbApi: false,
      usedLegacy: false,
      source: null,
      peopleSource: null,
      fallbackUsed: false,
      fallbackReason: "no_poplog_alternative_for_person_profile",
      poplogId: null,
      externalIds: { tmdb_person_id: id },
      identityUsed: "tmdb_person_id",
      skippedReasons: ["tmdb_disabled"],
    },
  });
}
