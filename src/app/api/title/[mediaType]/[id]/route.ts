import { NextRequest, NextResponse } from "next/server";

import {
  getPoplogTitleDetails,
  getPoplogTitleDetailsDebugSource,
} from "@/server/titles/poplog-title-details";
import type { PoplogTitleSourceHint } from "@/server/titles/poplog-title-identity";

type MediaType = "movie" | "tv";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{
      mediaType: string;
      id: string;
    }>;
  }
) {
  const resolvedParams = await params;

  const mediaType = resolvedParams.mediaType as MediaType;
  const id = resolvedParams.id;

  const sourceHint =
    (request.nextUrl.searchParams.get("sourceHint") ?? "auto") as PoplogTitleSourceHint;
  const debugSource = request.nextUrl.searchParams.get("debugSource") === "1";

  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      { ok: false, error: "Invalid media type" },
      { status: 400 }
    );
  }

  if (!id?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Invalid title id" },
      { status: 400 }
    );
  }

  try {
    const poplogDetails = await getPoplogTitleDetails({
      mediaType,
      id,
      sourceHint,
      region: "BR",
      locale: "pt-BR",
    });

    if (poplogDetails && poplogDetails.sourceMeta.primarySource !== "legacy") {
      const response = {
        ok: true,
        source: poplogDetails.sourceMeta.primarySource,
        cache_status: poplogDetails.sourceMeta.fallbackUsed ? "legacy_fallback_needed" : "fresh",
        refreshed: false,
        result: poplogDetails,
        ...(debugSource
          ? {
              debugSource: getPoplogTitleDetailsDebugSource(poplogDetails),
            }
          : {}),
      };

      return NextResponse.json(response);
    }

    console.warn("[title route] legacy TMDB fallback blocked", {
      mediaType,
      requestedId: id,
      resolvedFrom: poplogDetails?.sourceMeta.resolvedFrom,
      fallbackReason: poplogDetails?.sourceMeta.fallbackReason ?? "legacy_tmdb_fallback",
    });

    return NextResponse.json({
      ok: Boolean(poplogDetails),
      source: poplogDetails?.sourceMeta.primarySource ?? "unavailable",
      cache_status: poplogDetails?.sourceMeta.fallbackUsed ? "tmdb_fallback_blocked" : "fresh",
      refreshed: false,
      result: poplogDetails,
      ...(debugSource
        ? {
            debugSource: getPoplogTitleDetailsDebugSource(poplogDetails, {
              usedLegacy: false,
              usedTmdbApi: false,
              fallbackReason: "tmdb_fallback_blocked",
            }),
          }
        : {}),
    });
  } catch (error) {
    console.error("[title route]", error);

    return NextResponse.json(
      {
        ok: false,
        error: "Failed to fetch title",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    );
  }
}
