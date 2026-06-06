import type { MediaType, UserTitle } from "@/types/user";

export type { MediaType, UserTitle };

type TitleInput = {
  userId: string;
  tmdbId: number;
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  mediaType: MediaType;
  title: string;
  releaseYear?: number | null;
};

type IdentityInput = Pick<TitleInput, "poplogId" | "imdbId" | "slug">;

function validTmdbId(value: unknown): number | null {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}

function hasUsableIdentity(tmdbId: number, identity?: IdentityInput): boolean {
  return (
    validTmdbId(tmdbId) !== null ||
    Boolean(identity?.poplogId) ||
    Boolean(identity?.imdbId) ||
    Boolean(identity?.slug)
  );
}

function titleIdentityParams(
  tmdbId: number,
  mediaType: MediaType,
  identity?: IdentityInput,
) {
  const params = new URLSearchParams({ mediaType });
  const safeTmdbId = validTmdbId(tmdbId);
  if (safeTmdbId !== null) params.set("tmdbId", String(safeTmdbId));
  if (identity?.poplogId) params.set("poplogId", String(identity.poplogId));
  if (identity?.imdbId) params.set("imdbId", identity.imdbId);
  if (identity?.slug) params.set("slug", identity.slug);
  return params.toString();
}

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
  identity?: IdentityInput,
): Promise<boolean> {
  if (!hasUsableIdentity(tmdbId, identity)) return false;

  const res = await fetch(
    `/api/library/title?${titleIdentityParams(tmdbId, mediaType, identity)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { data?: { status?: string } };
  return json.data?.status === "watchlist";
}

export async function toggleWatchlist({
  userId,
  tmdbId,
  poplogId,
  imdbId,
  slug,
  mediaType,
  title,
  releaseYear,
}: TitleInput): Promise<boolean> {
  const identity = { poplogId, imdbId, slug };
  const safeTmdbId = validTmdbId(tmdbId);
  if (!hasUsableIdentity(tmdbId, identity)) {
    throw new Error("Título sem identificador válido");
  }
  const inWatchlist = await isTitleInWatchlist(userId, tmdbId, mediaType, identity);

  if (inWatchlist) {
    const res = await fetch("/api/library/title", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(safeTmdbId !== null ? { tmdbId: safeTmdbId } : {}), poplogId, imdbId, slug, mediaType }),
    });
    if (!res.ok && res.status !== 401) throw new Error(`DELETE ${res.status}`);
    return false;
  }

  const res = await fetch("/api/library/title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(safeTmdbId !== null ? { tmdbId: safeTmdbId } : {}), poplogId, imdbId, slug, mediaType, status: "watchlist", title, releaseYear }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  return true;
}

export async function isTitleWatched(
  _userId: string,
  tmdbId: number,
  mediaType: MediaType,
  identity?: IdentityInput,
): Promise<boolean> {
  if (!hasUsableIdentity(tmdbId, identity)) return false;

  const res = await fetch(
    `/api/library/title?${titleIdentityParams(tmdbId, mediaType, identity)}`,
    { cache: "no-store" },
  );
  if (!res.ok) return false;
  const json = (await res.json()) as { data?: { status?: string } };
  return json.data?.status === "watched";
}

export async function toggleWatched({
  userId,
  tmdbId,
  poplogId,
  imdbId,
  slug,
  mediaType,
  title,
  releaseYear,
}: TitleInput): Promise<boolean> {
  const identity = { poplogId, imdbId, slug };
  const safeTmdbId = validTmdbId(tmdbId);
  if (!hasUsableIdentity(tmdbId, identity)) {
    throw new Error("Título sem identificador válido");
  }
  const isWatched = await isTitleWatched(userId, tmdbId, mediaType, identity);

  if (isWatched) {
    const res = await fetch("/api/library/title", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(safeTmdbId !== null ? { tmdbId: safeTmdbId } : {}), poplogId, imdbId, slug, mediaType }),
    });
    if (!res.ok && res.status !== 401) throw new Error(`DELETE ${res.status}`);
    return false;
  }

  const res = await fetch("/api/library/title", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(safeTmdbId !== null ? { tmdbId: safeTmdbId } : {}), poplogId, imdbId, slug, mediaType, status: "watched", title, releaseYear }),
  });
  if (!res.ok) throw new Error(`POST ${res.status}`);
  return true;
}
