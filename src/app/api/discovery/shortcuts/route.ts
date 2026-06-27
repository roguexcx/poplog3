import { NextResponse } from "next/server";
import {
  TRENDING_SHORTCUTS,
  CURATED_GROUPS,
  STANDALONE_GENRES,
  MOODS,
} from "@/lib/discovery/shortcuts-config";

export async function GET() {
  return NextResponse.json({
    ok: true,
    trending: TRENDING_SHORTCUTS,
    genres: [...CURATED_GROUPS, ...STANDALONE_GENRES],
    moods: MOODS,
  });
}
