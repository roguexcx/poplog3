import { NextResponse } from "next/server";

// MOTN v4 direct API — 500 req/mês → cache 24h obrigatório
const MOTN_BASE = "https://api.movieofthenight.com/v4";
const CACHE_REVALIDATE = 86_400; // 24h

export type LeavingItem = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_url: string | null;
  backdrop_url: string | null;
  platform_name: string;
  platform_logo: string | null;
  leaving_date: string; // ISO date "YYYY-MM-DD"
  days_left: number;
};

type MotnChange = {
  changeType?: string;
  itemType?: string;
  showId?: string;
  service?: {
    id?: string;
    name?: string;
    imageSet?: { lightThemeImage?: string; darkThemeImage?: string };
  };
  expiresOn?: number; // unix timestamp seconds
};

type MotnShow = {
  title?: string;
  showType?: string;
  tmdbId?: string;
  imageSet?: {
    verticalPoster?: { w240?: string; w360?: string };
    horizontalBackdrop?: { w720?: string; w1080?: string };
  };
};

type MotnChangesResponse = {
  changes?: MotnChange[];
  shows?: Record<string, MotnShow>;
  hasMore?: boolean;
  nextCursor?: string;
};

// Serviços de streaming com presença relevante no Brasil
const BR_CATALOGS = [
  "netflix",
  "prime",
  "disney",
  "paramount",
  "apple",
  "hbo",
  "globoplay",
  "star",
];

const MAX_DAYS_AHEAD = 30;
const MAX_ITEMS = 20;

export async function GET() {
  const apiKey = process.env.MOVIEOFTHENIGHT_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ items: [] });
  }

  try {
    const url = new URL(`${MOTN_BASE}/changes`);
    url.searchParams.set("country", "br");
    url.searchParams.set("change_type", "expiring");
    for (const catalog of BR_CATALOGS) {
      url.searchParams.append("catalogs", catalog);
    }

    const res = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
      next: { revalidate: CACHE_REVALIDATE },
    });

    if (!res.ok) {
      console.error("[leaving-soon] MOTN error:", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ items: [] });
    }

    const data: MotnChangesResponse = await res.json();
    const changes = data.changes ?? [];
    const shows = data.shows ?? {};

    const now = Date.now();
    const seen = new Set<string>(); // dedup por showId+service
    const items: LeavingItem[] = [];

    for (const change of changes) {
      if (!change.showId) continue;

      const show = shows[change.showId];
      if (!show) continue;

      const tmdbId = show.tmdbId ? parseInt(show.tmdbId, 10) : null;
      if (!tmdbId || isNaN(tmdbId)) continue;

      // expiresOn é unix timestamp em segundos
      const expiresOnMs = change.expiresOn ? change.expiresOn * 1000 : null;
      if (!expiresOnMs) continue;

      const daysLeft = Math.ceil((expiresOnMs - now) / 86_400_000);
      if (daysLeft < 0 || daysLeft > MAX_DAYS_AHEAD) continue;

      const dedupeKey = `${change.showId}-${change.service?.id ?? ""}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);

      const leaving_date = new Date(expiresOnMs).toISOString().slice(0, 10);
      const media_type: "movie" | "tv" = show.showType === "movie" ? "movie" : "tv";

      items.push({
        id: tmdbId,
        media_type,
        title: show.title ?? `Título ${tmdbId}`,
        poster_url: show.imageSet?.verticalPoster?.w360 ?? show.imageSet?.verticalPoster?.w240 ?? null,
        backdrop_url: show.imageSet?.horizontalBackdrop?.w720 ?? null,
        platform_name: change.service?.name ?? change.service?.id ?? "Streaming",
        platform_logo: change.service?.imageSet?.lightThemeImage ?? null,
        leaving_date,
        days_left: daysLeft,
      });
    }

    // Urgência crescente: menos dias primeiro
    items.sort((a, b) => a.days_left - b.days_left);

    return NextResponse.json(
      { items: items.slice(0, MAX_ITEMS) },
      { headers: { "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    console.error("[leaving-soon] unhandled error:", err);
    return NextResponse.json({ items: [] });
  }
}
