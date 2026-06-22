"use client";

/**
 * TmdbImage — wrapper de compatibilidade.
 *
 * O nome "Tmdb" é histórico (pré-migração POPLOG). A renderização e a resolução
 * de URL são UNIFICADAS em {@link CatalogImage}/{@link CatalogPoster} — este
 * arquivo apenas adapta a API antiga (`path`/`kind`) para a canônica (`src`),
 * mantendo os ~20 call-sites existentes sem alteração.
 *
 * Para código novo, prefira importar `CatalogImage` diretamente.
 */

import type { ImageProps } from "next/image";
import { type ReactNode } from "react";

import type { ImageKind } from "@/lib/images/sizes";
import type { CatalogImageSize } from "@/lib/images/resolve";
import CatalogImage, { CatalogPoster } from "./CatalogImage";

// ─── API V2 (default export) ──────────────────────────────────────────────────

export type TmdbImageProps = Omit<ImageProps, "src" | "alt"> & {
  path: string | null | undefined;
  alt: string;
  /** Mantido por compatibilidade; a resolução de URL não depende do kind. */
  kind?: ImageKind;
  size: string;
  fallback?: ReactNode;
};

export default function TmdbImage({
  path,
  size,
  alt,
  fallback = null,
  kind: _kind,
  ...rest
}: TmdbImageProps) {
  return (
    <CatalogImage
      src={path}
      size={size as CatalogImageSize}
      alt={alt}
      fallback={fallback}
      {...rest}
    />
  );
}

// ─── API V3 (named export) ──────────────────────────────────────────────────

type TmdbImageV3Props = {
  path: string | null;
  fallbackPath?: string | null;
  size?: CatalogImageSize;
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
  return (
    <CatalogPoster
      src={path}
      fallbackSrc={fallbackPath}
      size={size}
      alt={alt}
      className={className}
      priority={priority}
      fallbackLabel={fallbackLabel}
    />
  );
}
