import { Metadata } from "next";
import { notFound } from "next/navigation";
import { balloonerismGet } from "@/server/api-clients/balloonerismm/client";
import type {
  BalloonerismPersonDetails,
  BalloonerismPersonCombinedCredits,
} from "@/server/api-clients/balloonerismm/types";
import PersonPageClient from "./PersonPageClient";

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

type Props = { params: Promise<{ id: string }> };

async function fetchPersonData(id: string) {
  const [profile, credits] = await Promise.all([
    balloonerismGet<BalloonerismPersonDetails>(`/person/${id}`, { ttlSeconds: 86400 }),
    balloonerismGet<BalloonerismPersonCombinedCredits>(`/person/${id}/combined_credits`, {
      params: { language: "pt-BR" },
      ttlSeconds: 86400,
    }),
  ]);
  return { profile, credits };
}

function normalizeCredit(
  item: NonNullable<BalloonerismPersonCombinedCredits["cast"]>[number] & { job?: string; department?: string }
): CreditItem | null {
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

function groupCrew(credits: BalloonerismPersonCombinedCredits): {
  directing: CreditItem[];
  writing: CreditItem[];
  producing: CreditItem[];
  other: CreditItem[];
} {
  const crew = credits.crew ?? [];
  const directing: CreditItem[] = [];
  const writing: CreditItem[] = [];
  const producing: CreditItem[] = [];
  const other: CreditItem[] = [];

  for (const item of crew) {
    const credit = normalizeCredit(item as Parameters<typeof normalizeCredit>[0]);
    if (!credit) continue;
    const dept = (item.department ?? "").toLowerCase();
    const job = (item.job ?? "").toLowerCase();
    if (dept === "directing" || job.includes("direct")) directing.push(credit);
    else if (dept === "writing" || job.includes("writ") || job.includes("story")) writing.push(credit);
    else if (dept === "production" || job.includes("produc") || job.includes("executive")) producing.push(credit);
    else other.push(credit);
  }

  const byYear = (a: CreditItem, b: CreditItem) => (b.year ?? 0) - (a.year ?? 0);
  return {
    directing: directing.sort(byYear),
    writing: writing.sort(byYear),
    producing: producing.sort(byYear),
    other: other.sort(byYear),
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const { profile } = await fetchPersonData(id);
  const name = profile?.name ?? "Pessoa";
  const description = profile?.biography
    ? profile.biography.slice(0, 155) + (profile.biography.length > 155 ? "..." : "")
    : `Filmografia e créditos de ${name} no catálogo POPLOG.`;
  return {
    title: `${name} — POPLOG`,
    description,
  };
}

export default async function PersonPage({ params }: Props) {
  const { id } = await params;
  const { profile, credits } = await fetchPersonData(id);

  if (!profile) notFound();

  const acting = (credits?.cast ?? [])
    .map((c) => normalizeCredit(c as Parameters<typeof normalizeCredit>[0]))
    .filter((c): c is CreditItem => Boolean(c))
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const crew = credits ? groupCrew(credits) : { directing: [], writing: [], producing: [], other: [] };

  return (
    <PersonPageClient
      person={{
        imdb_id: profile.imdb_id ?? id,
        name: profile.name,
        biography: profile.biography ?? null,
        birthday: profile.birthday ?? null,
        deathday: profile.deathday ?? null,
        place_of_birth: profile.place_of_birth ?? null,
        profile_path: profile.profile_path ?? null,
        known_for_department: profile.known_for_department ?? null,
      }}
      acting={acting}
      directing={crew.directing}
      writing={crew.writing}
      producing={crew.producing}
      otherCrew={crew.other}
    />
  );
}
