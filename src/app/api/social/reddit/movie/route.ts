import { NextResponse } from "next/server";
import { getRedditSocialForTitle } from "@/server/social/reddit-service";

export const dynamic = "force-dynamic";

function parseNumber(value: string | null, fallback: number | null = null) {
  if (!value) return fallback;

  const parsed = Number(value);

  if (Number.isNaN(parsed)) return fallback;

  return parsed;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const title = searchParams.get("title")?.trim();
    const originalTitle = searchParams.get("originalTitle")?.trim() || null;
    const translatedTitle = searchParams.get("translatedTitle")?.trim() || null;

    const year = parseNumber(searchParams.get("year"), null);

    const creator =
      searchParams.get("creator")?.trim() ||
      searchParams.get("director")?.trim() ||
      null;

    const network =
      searchParams.get("studio")?.trim() ||
      searchParams.get("distributor")?.trim() ||
      null;

    const cast =
      searchParams
        .get("cast")
        ?.split(",")
        .map((item) => item.trim())
        .filter(Boolean) || [];

    const maxThreads = parseNumber(searchParams.get("maxThreads"), 5) || 5;

    const maxCommentsPerThread =
      parseNumber(searchParams.get("maxCommentsPerThread"), 8) || 8;

    if (!title && !originalTitle && !translatedTitle) {
      return NextResponse.json(
        {
          error: "Missing movie title",
          example:
            "/api/social/reddit/movie?title=The%20Batman&year=2022&director=Matt%20Reeves",
        },
        { status: 400 }
      );
    }

    const result = await getRedditSocialForTitle({
      title: title || originalTitle || translatedTitle || "",
      originalTitle,
      translatedTitle,
      mediaType: "movie",
      year,
      creator,
      network,
      cast,
      maxThreads,
      maxCommentsPerThread,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      {
        error: "Reddit movie social search failed",
        message: error?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}