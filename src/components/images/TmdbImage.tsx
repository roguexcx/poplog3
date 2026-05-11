// src/components/images/TmdbImage.tsx
"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

import { buildTmdbUrlLoose } from "@/lib/images/url";
import type { ImageKind } from "@/lib/images/sizes";

export type TmdbImageProps = Omit<ImageProps, "src" | "alt"> & {
  /** TMDB path (e.g. `/abc.jpg`). May be null/undefined — in that case `fallback` is rendered. */
  path: string | null | undefined;
  /** Alt text (required). Pass `""` for purely decorative images. */
  alt: string;
  /** Semantic image kind (poster, backdrop, profile, still, logo). */
  kind: ImageKind;
  /**
   * Semantic size for this context (e.g. `"card"`, `"hero"`, `"detail"`).
   * See `IMAGE_SIZES` in `@/lib/images/sizes` for the full table per kind.
   * The builder also accepts raw TMDB size codes (`"w342"`, `"original"`)
   * for compatibility with call-sites still being migrated.
   */
  size: string;
  /** Node rendered when `path` is nullish or the image errors at runtime. */
  fallback?: ReactNode;
};

/**
 * next/image wrapper integrated with the central TMDB image system.
 *
 * - Accepts optional `path` — when nullish, renders `fallback` (default: null).
 * - Auto-fallback on runtime errors via `onError`.
 * - All other props (lazy-load, sizes, srcset, fill, priority, etc.) pass
 *   through to next/image via the spread.
 */
export default function TmdbImage({
  path,
  kind,
  size,
  alt,
  fallback = null,
  ...rest
}: TmdbImageProps) {
  const [errored, setErrored] = useState(false);

  const src = buildTmdbUrlLoose(kind, size, path);
  if (!src || errored) return <>{fallback}</>;

  return (
    <Image
      src={src}
      alt={alt}
      onError={() => setErrored(true)}
      {...rest}
    />
  );
}
