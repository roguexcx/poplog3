import { NextRequest, NextResponse } from "next/server";
import { getTitlePageData } from "@/server/titles/get-title-page-data";
import type { PoplogTitleSourceHint } from "@/server/titles/poplog-title-identity";
import { normalizeStreamingRegion } from "@/server/streaming/region";
import { resolveLocaleScope } from "@/server/source-engine/locale";

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
  const id = resolved.id;

  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("force") === "1";

  const localeScope = resolveLocaleScope({
    language:
      request.nextUrl.searchParams.get("language") ??
      request.nextUrl.searchParams.get("locale") ??
      request.cookies.get("poplog_catalog_language")?.value,
    region:
      request.nextUrl.searchParams.get("region") ??
      request.nextUrl.searchParams.get("country") ??
      request.cookies.get("poplog_region")?.value,
  });
  const country = normalizeStreamingRegion(
    request.nextUrl.searchParams.get("country") ?? localeScope.region,
    {
    source: "api:poplog3-title:country",
    explicit: request.nextUrl.searchParams.has("country"),
    },
  );
  const sourceHint =
    (request.nextUrl.searchParams.get("sourceHint") ?? "auto") as PoplogTitleSourceHint;
  const debugSource = request.nextUrl.searchParams.get("debugSource") === "1";

  if (mediaType !== "movie" && mediaType !== "tv") {
    return NextResponse.json(
      { ok: false, error: "Invalid media type" },
      { status: 400 },
    );
  }

  if (!id?.trim()) {
    return NextResponse.json(
      { ok: false, error: "Invalid title id" },
      { status: 400 },
    );
  }

  const payload = await getTitlePageData({
    mediaType,
    id,
    sourceHint,
    force: refresh,
    country,
    language: localeScope.catalogLanguage,
    debugSource,
  });

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
      "x-poplog-language": localeScope.catalogLanguage,
      "x-poplog-region": country,
      "x-poplog-availability": String(
        payload.cacheInfo?.availability?.source ?? "unknown",
      ),
    },
  });
}
