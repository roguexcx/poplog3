import { NextRequest, NextResponse } from "next/server";

import { tmdbFetch } from "@/server/api-clients/tmdb/client";
import { normalizeTmdbTitle } from "@/server/normalizers/tmdb-title";
import { filterValidTitles } from "@/server/utils/filter-valid-titles";
import { upsertCachedTitle } from "@/server/cache/title-cache";

type TmdbCredit = {
  id: number;
  media_type?: "movie" | "tv";
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
  popularity?: number;
  title?: string;
  release_date?: string;
  name?: string;
  first_air_date?: string;
  overview?: string;
  genre_ids?: number[];
  character?: string;
  job?: string;
  department?: string;
};

type TmdbPersonResponse = {
  id: number;
  name: string;
  biography?: string | null;
  birthday?: string | null;
  deathday?: string | null;
  place_of_birth?: string | null;
  known_for_department?: string | null;
  profile_path?: string | null;
  popularity?: number;
  movie_credits?: { cast?: TmdbCredit[]; crew?: TmdbCredit[] };
  tv_credits?: { cast?: TmdbCredit[]; crew?: TmdbCredit[] };
  external_ids?: {
    imdb_id?: string | null;
    instagram_id?: string | null;
    twitter_id?: string | null;
    tiktok_id?: string | null;
  };
  images?: { profiles?: { file_path: string }[] };
};

function normalizeCredits(credits: TmdbCredit[] = []) {
  return filterValidTitles(
    credits
      .filter((item) => item.media_type === "movie" || item.media_type === "tv")
      .map((item) =>
        normalizeTmdbTitle({
          ...item,
          media_type: item.media_type,
        })
      )
  );
}

function dedupeTitles<T extends { tmdb_id: number; media_type: string }>(
  titles: T[]
) {
  const seen = new Set<string>();

  return titles.filter((title) => {
    const key = `${title.media_type}-${title.tmdb_id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getCreditPenalty(credit: TmdbCredit) {
  const character = credit.character?.toLowerCase() ?? "";
  const title = `${credit.title ?? credit.name ?? ""}`.toLowerCase();

  const isSelf =
    character.includes("self") ||
    character.includes("himself") ||
    character.includes("herself") ||
    character.includes("guest") ||
    character.includes("host") ||
    character.includes("cameo") ||
    character.includes("archive footage");

  const isTalkOrInterview =
    title.includes("talk show") ||
    title.includes("late night") ||
    title.includes("tonight show") ||
    title.includes("jimmy fallon") ||
    title.includes("jimmy kimmel") ||
    title.includes("stephen colbert") ||
    title.includes("graham norton") ||
    title.includes("kelly clarkson") ||
    title.includes("jennifer hudson") ||
    title.includes("live with kelly") ||
    title.includes("actors on actors") ||
    title.includes("variety studio") ||
    title.includes("interview");

  const isAwardOrCeremony =
    title.includes("oscars") ||
    title.includes("golden globe") ||
    title.includes("awards") ||
    title.includes("choice awards") ||
    title.includes("ceremony") ||
    title.includes("hall of fame") ||
    title.includes("mtv");

  const isRealityOrSpecial =
    title.includes("project runway") ||
    title.includes("dancing with the stars") ||
    title.includes("america's next top model") ||
    title.includes("the talk") ||
    title.includes("quotidien") ||
    title.includes("you quiz on the block") ||
    title.includes("special");

  const isDocOrBehindScenes =
    title.includes("documentary") ||
    title.includes("doc") ||
    title.includes("behind the scenes") ||
    title.includes("making of") ||
    title.includes("inside the dream");

  if (isTalkOrInterview || isAwardOrCeremony) return 100;
  if (isSelf && isRealityOrSpecial) return 70;
  if (isSelf) return 55;
  if (isRealityOrSpecial || isDocOrBehindScenes) return 30;

  return 0;
}

function isLowPriorityAppearance(credit: TmdbCredit) {
  return getCreditPenalty(credit) >= 70;
}

function sortByCareerRelevance<
  T extends { popularity?: number | null; vote_average?: number | null }
>(titles: T[]) {
  return [...titles].sort((a, b) => {
    const scoreA =
      (typeof a.popularity === "number" ? a.popularity : 0) +
      (typeof a.vote_average === "number" ? a.vote_average * 4 : 0);

    const scoreB =
      (typeof b.popularity === "number" ? b.popularity : 0) +
      (typeof b.vote_average === "number" ? b.vote_average * 4 : 0);

    return scoreB - scoreA;
  });
}

function removeExistingTitles<T extends { tmdb_id: number; media_type: string }>(
  source: T[],
  existing: T[]
) {
  const existingKeys = new Set(
    existing.map((title) => `${title.media_type}-${title.tmdb_id}`)
  );

  return source.filter(
    (title) => !existingKeys.has(`${title.media_type}-${title.tmdb_id}`)
  );
}

export async function GET(
  request: NextRequest,
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

  try {
    const person = await tmdbFetch<TmdbPersonResponse>(`/person/${id}`, {
      params: {
        append_to_response: "movie_credits,tv_credits,external_ids,images",
      },
    });

    const movieCredits = person.movie_credits?.cast ?? [];
    const tvCredits = person.tv_credits?.cast ?? [];

    const mainMovieCast = normalizeCredits(
      movieCredits
        .filter((item) => !isLowPriorityAppearance(item))
        .map((item) => ({ ...item, media_type: "movie" }))
    );

    const mainTvCast = normalizeCredits(
      tvCredits
        .filter((item) => !isLowPriorityAppearance(item))
        .map((item) => ({ ...item, media_type: "tv" }))
    );

    const lowPriorityAppearances = normalizeCredits([
      ...movieCredits
        .filter((item) => isLowPriorityAppearance(item))
        .map((item) => ({ ...item, media_type: "movie" as const })),
      ...tvCredits
        .filter((item) => isLowPriorityAppearance(item))
        .map((item) => ({ ...item, media_type: "tv" as const })),
    ]);

    const directing = normalizeCredits(
      (person.movie_credits?.crew ?? [])
        .filter((item) => item.job === "Director")
        .map((item) => ({ ...item, media_type: "movie" }))
    );

    const creating = normalizeCredits(
      (person.tv_credits?.crew ?? [])
        .filter(
          (item) =>
            item.job === "Creator" ||
            item.job === "Writer" ||
            item.department === "Writing"
        )
        .map((item) => ({ ...item, media_type: "tv" }))
    );

    const rawActing = sortByCareerRelevance(
      dedupeTitles([...mainMovieCast, ...mainTvCast])
    ).slice(0, 50);

    const rawAppearances = sortByCareerRelevance(
      dedupeTitles(lowPriorityAppearances)
    ).slice(0, 24);

    const knownFor = sortByCareerRelevance(
      dedupeTitles([...rawActing, ...directing, ...creating])
    ).slice(0, 12);

    const acting = removeExistingTitles(rawActing, knownFor).slice(0, 40);

    const directingClean = removeExistingTitles(directing, [
      ...knownFor,
      ...acting,
    ]).slice(0, 40);

    const creatingClean = removeExistingTitles(creating, [
      ...knownFor,
      ...acting,
      ...directingClean,
    ]).slice(0, 40);

    const appearances = removeExistingTitles(rawAppearances, [
      ...knownFor,
      ...acting,
      ...directingClean,
      ...creatingClean,
    ]).slice(0, 20);

    const allTitles = dedupeTitles([
      ...knownFor,
      ...acting,
      ...directingClean,
      ...creatingClean,
      ...appearances,
    ]);

    await Promise.all(
      allTitles.map(async (title) => {
        try {
          await upsertCachedTitle(title, {
            id: title.tmdb_id,
            media_type: title.media_type,
            poster_path: title.poster_path,
            backdrop_path: title.backdrop_path,
            vote_average: title.vote_average,
            popularity: title.popularity,
            overview: title.overview,
            ...(title.media_type === "movie"
              ? {
                  title: title.title,
                  release_date: title.release_date,
                }
              : {
                  name: title.title,
                  first_air_date: title.first_air_date,
                }),
          });
        } catch (error) {
          console.warn(
            `[poplog3/person] falha ao cachear ${title.media_type}/${title.tmdb_id}:`,
            error instanceof Error ? error.message : error
          );
        }
      })
    );

    return NextResponse.json({
      ok: true,
      person: {
        tmdb_id: person.id,
        name: person.name,
        biography: person.biography ?? null,
        birthday: person.birthday ?? null,
        deathday: person.deathday ?? null,
        place_of_birth: person.place_of_birth ?? null,
        known_for_department: person.known_for_department ?? null,
        popularity: person.popularity ?? 0,
        profile_path: person.profile_path ?? null,
        external_ids: {
          imdb_id: person.external_ids?.imdb_id ?? null,
          instagram_id: person.external_ids?.instagram_id ?? null,
          twitter_id: person.external_ids?.twitter_id ?? null,
          tiktok_id: person.external_ids?.tiktok_id ?? null,
        },
        images: person.images?.profiles?.slice(0, 12) ?? [],
      },
      knownFor,
      acting,
      directing: directingClean,
      creating: creatingClean,
      appearances,
    });
  } catch (error) {
    console.error("[poplog3/people]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to load person",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}