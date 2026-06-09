import { NextRequest, NextResponse } from "next/server";
import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type {
  BalloonerismPersonDetails,
  BalloonerismPersonCombinedCredits,
} from "@/server/api-clients/balloonerismm/types";

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;

  if (!id) {
    return NextResponse.json({ ok: false, error: "Missing person id" }, { status: 400 });
  }

  const [profile, credits] = await Promise.all([
    balloonerismGet<BalloonerismPersonDetails>(`/person/${id}`, { ttlSeconds: 86400 }),
    balloonerismGet<BalloonerismPersonCombinedCredits>(`/person/${id}/combined_credits`, {
      params: { language: "pt-BR" },
      ttlSeconds: 86400,
    }),
  ]);

  if (!profile) {
    return NextResponse.json({ ok: false, error: "Person not found", person: null }, { status: 404 });
  }

  // Normalize credits
  type CreditItem = {
    imdb_id?: string;
    title: string;
    media_type: "movie" | "tv";
    year?: number | null;
    character?: string;
    job?: string;
    department?: string;
    poster_path?: string | null;
  };

  type RawCreditItem = NonNullable<BalloonerismPersonCombinedCredits["cast"]>[number] & { job?: string; department?: string };
  function normalizeCredit(item: RawCreditItem): CreditItem | null {
    const title = item?.title ?? item?.name;
    if (!title) return null;
    return {
      imdb_id: item.imdb_id ?? undefined,
      title,
      media_type: item.media_type === "tv" ? "tv" : "movie",
      year: item.year ?? null,
      character: item.character ?? undefined,
      job: item.job ?? undefined,
      department: item.department ?? undefined,
      poster_path: item.images?.poster ?? null,
    };
  }

  const acting = (credits?.cast ?? [])
    .map((c) => normalizeCredit(c as Parameters<typeof normalizeCredit>[0]))
    .filter((c): c is CreditItem => Boolean(c))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const crew = (credits?.crew ?? [])
    .map((c) => normalizeCredit(c as Parameters<typeof normalizeCredit>[0]))
    .filter((c): c is CreditItem => Boolean(c))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  return NextResponse.json({
    ok: true,
    person: {
      imdb_id: profile.imdb_id ?? id,
      name: profile.name,
      biography: profile.biography ?? null,
      birthday: profile.birthday ?? null,
      deathday: profile.deathday ?? null,
      place_of_birth: profile.place_of_birth ?? null,
      profile_path: profile.profile_path ?? null,
      known_for_department: profile.known_for_department ?? null,
    },
    acting,
    crew,
  });
}
