import type { MediaType, UserTitle } from "@/types/user";

export type { MediaType, UserTitle };

type TitleInput = {
  userId: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  releaseYear?: number | null;
};

export async function getUserTitles(_userId: string): Promise<UserTitle[]> {
  const res = await fetch("/api/library", { cache: "no-store" });
  if (!res.ok) return [];
  const json = (await res.json()) as { data?: UserTitle[] };
  return json.data ?? [];
}

export async function isTitleInWatchlist(
  _userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<boolean> {
  const res = await fetch(
    `/api/library/title?tmdbId=${tmdbId}&mediaType=${mediaType}`,
    { cache: "no-store" },
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { data?: { status?: string } };
  return json.data?.status === "watchlist";
}

export async function toggleWatchlist({
  userId,
  tmdbId,
  mediaType,
  title,
  releaseYear,
}: TitleInput): Promise<boolean> {
  const inWatchlist = await isTitleInWatchlist(userId, tmdbId, mediaType);

  if (inWatchlist) {
    const res = await fetch("/api/library/title", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId, mediaType }),
    });
    if (!res.ok && res.status !== 401) throw new Error(`DELETE ${res.status}`);
    return false;
  }

  const res = await fetch("/api/library/title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tmdbId, mediaType, status: "watchlist", title, releaseYear }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  return true;
}

export async function isTitleWatched(
  _userId: string,
  tmdbId: number,
  mediaType: MediaType,
): Promise<boolean> {
  const res = await fetch(
    `/api/library/title?tmdbId=${tmdbId}&mediaType=${mediaType}`,
    { cache: "no-store" },
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { data?: { status?: string } };
  return json.data?.status === "watched";
}

export async function toggleWatched({
  userId,
  tmdbId,
  mediaType,
  title,
  releaseYear,
}: TitleInput): Promise<boolean> {
  const isWatched = await isTitleWatched(userId, tmdbId, mediaType);

  if (isWatched) {
    const res = await fetch("/api/library/title", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tmdbId, mediaType }),
    });
    if (!res.ok && res.status !== 401) throw new Error(`DELETE ${res.status}`);
    return false;
  }

  const res = await fetch("/api/library/title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tmdbId, mediaType, status: "watched", title, releaseYear }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  return true;
}
