import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const key = process.env.TRAKT_CLIENT_ID;

  const response = await fetch("https://api.trakt.tv/movies/popular", {
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": "POPLOG/3.0 (contact: local-dev)",
      "trakt-api-version": "2",
      "trakt-api-key": key ?? "",
    },
  });

  const text = await response.text();

  return NextResponse.json({
    hasKey: Boolean(key),
    keyLength: key?.length ?? 0,
    status: response.status,
    body: text.slice(0, 500),
  });
}