// src/components/images/RandomTmdbImage.tsx
//
// Server component: resolves a random poster/backdrop for the title and
// delegates the actual render to <TmdbImage />. Lazy-loading, sizes and
// priority pass through unchanged.
//
// Note: the props are named `mediaType` and `tmdbId` (not `type`/`id`)
// because `type` and `id` are native HTML attributes on <img> and would
// be merged into ImageProps by next/image's typings — TypeScript would
// then collapse them to `never` due to the union mismatch.

import { RANDOMIZATION_ENABLED } from "@/lib/images/config";
import { getRandomTitleImagePath } from "@/lib/images/random";

import TmdbImage, { type TmdbImageProps } from "./TmdbImage";

type Props = Omit<TmdbImageProps, "path"> & {
  /** TMDB media type. */
  mediaType: "movie" | "tv";
  /** TMDB id of the title. */
  tmdbId: number;
  /**
   * Path used as fallback when global randomization is disabled. For poster-like
   * images it is also used when /images has no eligible variant. Backdrops are
   * stricter while randomization is enabled: if there is no textless variant,
   * the visual fallback is rendered instead of a possibly text-bearing path.
   *
   * Typically the `poster_path` / `backdrop_path` the caller already has.
   */
  fallbackPath: string | null | undefined;
};

export default async function RandomTmdbImage({
  mediaType,
  tmdbId,
  fallbackPath,
  kind,
  size,
  alt,
  ...rest
}: Props) {
  let path: string | null | undefined = fallbackPath ?? null;

  if (RANDOMIZATION_ENABLED) {
    const random = await getRandomTitleImagePath(mediaType, tmdbId, kind);
    path = kind === "backdrop" ? random : random ?? fallbackPath ?? null;
  }

  return (
    <TmdbImage
      path={path}
      kind={kind}
      size={size}
      alt={alt}
      {...rest}
    />
  );
}
