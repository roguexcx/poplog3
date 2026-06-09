import { type NextRequest, NextResponse } from "next/server";

import { EXTERNAL_IMAGE_DOMAINS } from "@/lib/images/proxy";

export const runtime = "edge";

const ALLOWED_HOSTNAMES = new Set<string>(EXTERNAL_IMAGE_DOMAINS);

function isDomainAllowed(hostname: string): boolean {
  if (ALLOWED_HOSTNAMES.has(hostname)) return true;
  // aceita subdomínios de domínios autorizados
  return EXTERNAL_IMAGE_DOMAINS.some((d) => hostname.endsWith(`.${d}`));
}

export async function GET(req: NextRequest) {
  const rawParam = req.nextUrl.searchParams.get("url");
  if (!rawParam) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  let externalUrl: URL;
  try {
    externalUrl = new URL(rawParam);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (externalUrl.protocol !== "https:") {
    return NextResponse.json({ error: "only https allowed" }, { status: 403 });
  }

  if (!isDomainAllowed(externalUrl.hostname)) {
    return NextResponse.json({ error: "domain not allowed" }, { status: 403 });
  }

  let upstream: Response;
  try {
    upstream = await fetch(externalUrl.toString(), {
      headers: {
        "User-Agent": "POPLOG/1.0",
        Accept: "image/webp,image/avif,image/*,*/*;q=0.8",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }

  if (!upstream.ok) {
    return new NextResponse(null, { status: upstream.status });
  }

  const contentType = upstream.headers.get("content-type") ?? "image/jpeg";
  const body = await upstream.arrayBuffer();

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=604800, stale-while-revalidate=86400",
      "X-Poplog-Image-Source": externalUrl.hostname,
      Vary: "Accept",
    },
  });
}
