import type { MediaType, UserTitle } from "@/types/user";

export type TitleIdentityInput = {
  tmdbId?: number | null;
  poplogId?: string | number | null;
  imdbId?: string | null;
  slug?: string | null;
  mediaType: MediaType;
};

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" || typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed !== 0 ? parsed : null;
}

export function titleIdentityKeys(input: TitleIdentityInput): string[] {
  const keys = new Set<string>();
  const mediaType = input.mediaType;
  const poplogId = stringOrNull(input.poplogId);
  const imdbId = stringOrNull(input.imdbId);
  const slug = stringOrNull(input.slug);
  const tmdbId = numberOrNull(input.tmdbId);

  if (poplogId) keys.add(`${mediaType}:poplog:${poplogId}`);
  if (imdbId) keys.add(`${mediaType}:imdb:${imdbId.toLowerCase()}`);
  if (slug) keys.add(`${mediaType}:slug:${slug.toLowerCase()}`);
  if (tmdbId) keys.add(`${mediaType}:tmdb:${tmdbId}`);

  return Array.from(keys);
}

export function userTitleIdentityKeys(title: UserTitle): string[] {
  return titleIdentityKeys({
    mediaType: title.media_type,
    tmdbId: title.externalIds?.tmdbId ?? title.tmdb_id,
    poplogId: title.poplogId,
    imdbId: title.externalIds?.imdbId ?? title.imdb_id,
    slug: title.externalIds?.slug,
  });
}

export function findUserTitleByIdentity(
  titles: UserTitle[],
  input: TitleIdentityInput,
): UserTitle | undefined {
  const wanted = new Set(titleIdentityKeys(input));
  if (wanted.size === 0) return undefined;

  return titles.find((title) =>
    userTitleIdentityKeys(title).some((key) => wanted.has(key)),
  );
}
