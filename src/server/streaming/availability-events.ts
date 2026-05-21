export type LeavingAvailabilityItem = {
  id: number;
  media_type: "movie" | "tv";
  title: string;
  poster_url: string | null;
  backdrop_url: string | null;
  platform_name: string;
  platform_logo: string | null;
  leaving_date: string;
  days_left: number;
};

type MotnChangesResponse = {
  changes?: Array<{
    showId?: string;
    service?: {
      id?: string;
      name?: string;
      imageSet?: { lightThemeImage?: string };
    };
    expiresOn?: number;
  }>;
  shows?: Record<
    string,
    {
      title?: string;
      showType?: string;
      tmdbId?: string;
      imageSet?: {
        verticalPoster?: { w240?: string; w360?: string };
        horizontalBackdrop?: { w720?: string };
      };
    }
  >;
};

const MOTN_BASE = "https://api.movieofthenight.com/v4";
const BR_CATALOGS = ["netflix", "prime", "disney", "paramount", "apple", "hbo", "globoplay", "star"];

export async function getLeavingSoonAvailabilityEvents(): Promise<LeavingAvailabilityItem[]> {
  const apiKey = process.env.MOVIEOFTHENIGHT_API_KEY;
  if (!apiKey) return [];

  try {
    const url = new URL(`${MOTN_BASE}/changes`);
    url.searchParams.set("country", "br");
    url.searchParams.set("change_type", "expiring");
    for (const catalog of BR_CATALOGS) {
      url.searchParams.append("catalogs", catalog);
    }

    const response = await fetch(url.toString(), {
      headers: { "X-API-Key": apiKey },
      next: { revalidate: 86_400 },
    });
    if (!response.ok) return [];

    const data = (await response.json()) as MotnChangesResponse;
    const items: LeavingAvailabilityItem[] = [];
    const seen = new Set<string>();

    for (const change of data.changes ?? []) {
      if (!change.showId || !change.expiresOn) continue;
      const show = data.shows?.[change.showId];
      const tmdbId = show?.tmdbId ? Number(show.tmdbId) : null;
      if (!show || !tmdbId) continue;

      const daysLeft = Math.ceil((change.expiresOn * 1000 - Date.now()) / 86_400_000);
      if (daysLeft < 0 || daysLeft > 30) continue;

      const key = `${change.showId}-${change.service?.id ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);

      items.push({
        id: tmdbId,
        media_type: show.showType === "movie" ? "movie" : "tv",
        title: show.title ?? `Título ${tmdbId}`,
        poster_url: show.imageSet?.verticalPoster?.w360 ?? show.imageSet?.verticalPoster?.w240 ?? null,
        backdrop_url: show.imageSet?.horizontalBackdrop?.w720 ?? null,
        platform_name: change.service?.name ?? change.service?.id ?? "Streaming",
        platform_logo: change.service?.imageSet?.lightThemeImage ?? null,
        leaving_date: new Date(change.expiresOn * 1000).toISOString().slice(0, 10),
        days_left: daysLeft,
      });
    }

    return items.sort((a, b) => a.days_left - b.days_left).slice(0, 20);
  } catch {
    return [];
  }
}
