"use client";

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

import { resolveForRender } from "@/lib/images/proxy";
import type { ImageKind } from "@/lib/images/sizes";

// ─── V2-style default export (para componentes migrados do V2) ────────────────

export type TmdbImageProps = Omit<ImageProps, "src" | "alt"> & {
  path: string | null | undefined;
  alt: string;
  kind: ImageKind;
  size: string;
  fallback?: ReactNode;
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export default function TmdbImage({ path, kind, size,
  alt,
  fallback = null,
  ...rest
}: TmdbImageProps) {
  const [errored, setErrored] = useState(false);

  const src = resolveForRender(path, size);
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

type TmdbImageV3Props = {
  path: string | null;
  fallbackPath?: string | null;
  size?: "w185" | "w300" | "w342" | "w500" | "w780" | "w1280" | "original";
  alt?: string;
  className?: string;
  priority?: boolean;
  fallbackLabel?: string;
};

export function TmdbImageLegacy({
  path,
  fallbackPath = null,
  size = "w500",
  alt = "",
  className = "",
  priority = false,
  fallbackLabel = "Sem imagem",
}: TmdbImageV3Props) {
  const src = resolveForRender(path ?? fallbackPath, size);

  if (!src) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-white/35 ${className}`}
      >
        {fallbackLabel}
      </div>
    );
  }

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
