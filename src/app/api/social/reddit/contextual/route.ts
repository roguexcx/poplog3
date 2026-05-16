import { NextResponse } from "next/server";
import { getRedditSocialForTitle } from "@/server/social/reddit-service";
import { buildSocialContextFromTmdb } from "@/server/social/social-context-builder";

export const dynamic = "force-dynamic";

function parseNumber(value: string | null, fallback: number | null = null) {
  if (!value) return fallback;

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) return fallback;

  return parsed;
}

function parseMediaType(value: string | null) {
  return value === "movie" ? "movie" : "tv";
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const tmdbId = parseNumber(searchParams.get("tmdbId"));
    const mediaType = parseMediaType(searchParams.get("mediaType"));

    const seasonNumber = parseNumber(searchParams.get("seasonNumber"));
    const episodeNumber = parseNumber(searchParams.get("episodeNumber"));

    const maxThreads = parseNumber(searchParams.get("maxThreads"), 5) || 5;
    const maxCommentsPerThread =
      parseNumber(searchParams.get("maxCommentsPerThread"), 8) || 8;

    const force =
      searchParams.get("force") === "1" ||
      searchParams.get("refresh") === "1";

    if (!tmdbId) {
      return NextResponse.json(
        {
          error: "Missing tmdbId",
          example:
            "/api/social/reddit/contextual?tmdbId=257994&mediaType=tv&seasonNumber=1&episodeNumber=2",
        },
        { status: 400 },
      );
    }

    if (mediaType === "tv" && (!seasonNumber || !episodeNumber)) {
      return NextResponse.json(
        {
          error: "Missing seasonNumber or episodeNumber for tv",
          example:
            "/api/social/reddit/contextual?tmdbId=257994&mediaType=tv&seasonNumber=1&episodeNumber=2",
        },
        { status: 400 },
      );
    }

    const context = await buildSocialContextFromTmdb({
      tmdbId,
      mediaType,
      seasonNumber,
      episodeNumber,
      force,
    });

    const result = await getRedditSocialForTitle({
      title: context.canonicalTitle,
      originalTitle: context.originalTitle,
      translatedTitle: context.translatedTitle,
      mediaType,
      year: context.releaseYear,
      // Usar sempre os valores do input (authoritative) — context.episode pode
      // ter season_number desatualizado se o cache TMDB foi gravado antes da
      // temporada existir (ex: Euphoria S02 cacheado retornando season_number:2
      // quando buscamos S03).
      season: seasonNumber,
      episode: episodeNumber,
      episodeTitle: context.episode?.title,
      airDate: context.episode?.airDate ?? null,
      creator: context.people.creators
        .concat(context.people.directors)
        .concat(context.people.writers)
        .slice(0, 6)
        .join(", "),
      network: context.metadata.networks
        .concat(context.metadata.productionCompanies)
        .slice(0, 6)
        .join(", "),
      cast: context.people.cast.slice(0, 8),
      maxThreads,
      maxCommentsPerThread,
    });

    return NextResponse.json({
  ...result,
  source: "reddit_contextual_social",
  context,
});
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Reddit contextual search failed",
        message: error?.message || "Unknown error",
      },
      { status: 500 },
    );
  }
}