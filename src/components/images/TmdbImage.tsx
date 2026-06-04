"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

import { buildTmdbUrlLoose } from "@/lib/images/url";
import type { ImageKind } from "@/lib/images/sizes";

// ─── V2-style default export (para componentes migrados do V2) ────────────────

export type TmdbImageProps = Omit<ImageProps, "src" | "alt"> & {
  path: string | null | undefined;
  alt: string;
  kind: ImageKind;
  size: string;
  fallback?: ReactNode;
};

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

// ─── V3-style named export (backward compat para componentes existentes do V3) ─

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

type TmdbImageV3Props = {
  path: string | null;
  fallbackPath?: string | null;
  size?: "w185" | "w300" | "w342" | "w500" | "w780" | "w1280" | "original";
  alt?: string;
  className?: string;
  priority?: boolean;
  fallbackLabel?: string;
};

function normalizePath(path: string | null | undefined) {
  if (!path) return null;
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return path.startsWith("/") ? path : `/${path}`;
}

function buildImageSrc(path: string, size: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) return path;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function TmdbImageLegacy({
  path,
  fallbackPath = null,
  size = "w500",
  alt = "",
  className = "",
  priority = false,
  fallbackLabel = "Sem imagem",
}: TmdbImageV3Props) {
  const imagePath = normalizePath(path) ?? normalizePath(fallbackPath);

  if (!imagePath) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-white/35 ${className}`}
      >
        {fallbackLabel}
      </div>
    );
  }

  const src = buildImageSrc(imagePath, size);

  return (
    <Image
      src={src}
      alt={alt}
      fill
      priority={priority}
      unoptimized
      sizes="(max-width: 768px) 50vw, (max-width: 1280px) 20vw, 16vw"
      className={className}
    />
  );
}
