import { NextRequest, NextResponse } from "next/server";
import { getTitlePageData } from "@/server/titles/get-title-page-data";

type MediaType = "movie" | "tv";

export async function GET(
  request: NextRequest,
  {
    params,
  }: {
    params: Promise<{ mediaType: string; id: string }>;
  },
) {
  const resolved = await params;
  const mediaType = resolved.mediaType as MediaType;
  const id = Number(resolved.id);

  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("force") === "1";

  const country =
    request.nextUrl.searchParams.get("country")?.toUpperCase() ?? "BR";

  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      { ok: false, error: "Invalid media type" },
      { status: 400 },
    );
  }

  if (!id || Number.isNaN(id)) {
    return NextResponse.json(
      { ok: false, error: "Invalid TMDB id" },
      { status: 400 },
    );
  }

  const payload = await getTitlePageData({ mediaType, id, force: refresh, country });

  if (!payload) {
    return NextResponse.json(
      { ok: false, error: "Failed to fetch title" },
      { status: 500 },
    );
  }

  return NextResponse.json(payload, {
    headers: {
      "x-poplog-source": String(payload.cacheInfo?.title?.source ?? "unknown"),
      "x-poplog-cache": String(payload.cacheInfo?.title?.status ?? "unknown"),
      "x-poplog-availability": String(
        payload.cacheInfo?.availability?.source ?? "unknown",
      ),
    },
  });
}
