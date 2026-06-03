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
  throw new Error("Requires MySQL/Prisma — not yet implemented");
}

export async function isTitleInWatchlist(
  _userId: string,
  _tmdbId: number,
  _mediaType: MediaType
): Promise<boolean> {
  throw new Error("Requires MySQL/Prisma — not yet implemented");
}

export async function toggleWatchlist({
  userId,
  tmdbId,
  mediaType,
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
    body: JSON.stringify({ tmdbId, mediaType, status: "watchlist" }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  return true;
}

export async function isTitleWatched(
  _userId: string,
  _tmdbId: number,
  _mediaType: MediaType
): Promise<boolean> {
  throw new Error("Requires MySQL/Prisma — not yet implemented");
}

export async function toggleWatched({
  userId,
  tmdbId,
  mediaType,
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
    body: JSON.stringify({ tmdbId, mediaType, status: "watched" }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  return true;
}
