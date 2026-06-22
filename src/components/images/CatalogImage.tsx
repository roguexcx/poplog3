"use client";

/**
 * CatalogImage — componente de imagem agnóstico de fonte.
 *
 * Substitui TmdbImage como componente padrão de imagem do POPLOG.
 * Aceita URLs completas (Trakt, TheTVDB, Balloonerismm, CDN próprio)
 * ou paths TMDB legados (/abc.jpg) para compatibilidade histórica.
 *
 * Fluxo recomendado:
 *   posterUrl (da Source Engine) → fallbackUrl → fallbackNode
 */

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

import { type CatalogImageSize } from "@/lib/images/resolve";
import { resolveForRender } from "@/lib/images/proxy";

// Re-exporta para compatibilidade com código que importava daqui
export { resolveCatalogImage as resolveCatalogImageUrl, resolveCatalogImage } from "@/lib/images/resolve";
export { resolveForRender } from "@/lib/images/proxy";
export type { CatalogImageSize } from "@/lib/images/resolve";

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CatalogImageProps = Omit<ImageProps, "src" | "alt"> & {
  /** URL completa ou path legado TMDB */
  src: string | null | undefined;
  alt: string;
  /** Tamanho para paths TMDB legados (ignorado para URLs completas) */
  size?: CatalogImageSize;
  /** URL de fallback caso a primária falhe */
  fallbackSrc?: string | null;
  /** Node renderizado quando não há imagem disponível */
  fallback?: ReactNode;
};

// ─── Componente fill (padrão — para cards, posters, etc.) ────────────────────

/**
 * Componente padrão — ocupa o container pai (fill=true).
 * Use dentro de um container com position: relative e tamanho definido.
 */
export default function CatalogImage({
  src,
  alt,
  size = "w500",
  fallbackSrc,
  fallback = null,
  ...rest
}: CatalogImageProps) {
  const [errorCount, setErrorCount] = useState(0);

  const primary = resolveForRender(src, size);
  const secondary = resolveForRender(fallbackSrc, size);

  const resolved =
    errorCount === 0 ? primary :
    errorCount === 1 ? secondary :
    null;

  if (!resolved) return <>{fallback}</>;

  return (
    <Image
      src={resolved}
      alt={alt}
      onError={() => setErrorCount((n) => n + 1)}
      {...rest}
    />
  );
}

// ─── Variante inline (tamanho fixo via width/height) ─────────────────────────

export type CatalogImageInlineProps = {
  src: string | null | undefined;
  alt?: string;
  width: number;
  height: number;
  size?: CatalogImageSize;
  fallbackSrc?: string | null;
  fallback?: ReactNode;
  className?: string;
  priority?: boolean;
};

export function CatalogImageInline({
  src,
  alt = "",
  width,
  height,
  size = "w500",
  fallbackSrc,
  fallback = null,
  className,
  priority,
}: CatalogImageInlineProps) {
  const [errorCount, setErrorCount] = useState(0);

  const primary = resolveForRender(src, size);
  const secondary = resolveForRender(fallbackSrc, size);
  const resolved =
    errorCount === 0 ? primary :
    errorCount === 1 ? secondary :
    null;

  if (!resolved) return <>{fallback}</>;

  return (
    <Image
      src={resolved}
      alt={alt}
      width={width}
      height={height}
      className={className}
      priority={priority}
      onError={() => setErrorCount((n) => n + 1)}
    />
  );
}

// ─── Variante fill com placeholder (cards de lista) ──────────────────────────

type CatalogPosterProps = {
  src: string | null | undefined;
  alt?: string;
  size?: CatalogImageSize;
  fallbackSrc?: string | null;
  fallbackLabel?: string;
  className?: string;
  priority?: boolean;
};

export function CatalogPoster({
  src,
  alt = "",
  size = "w342",
  fallbackSrc,
  fallbackLabel = "Sem imagem",
  className = "",
  priority = false,
}: CatalogPosterProps) {
  return (
    <CatalogImage
      src={src}
      alt={alt}
      size={size}
      fallbackSrc={fallbackSrc}
      fill
      unoptimized
      priority={priority}
      sizes="(max-width: 768px) 50vw, (max-width: 1280px) 20vw, 16vw"
      className={className}
      fallback={
        <div
          className={`flex h-full w-full items-center justify-center bg-gradient-to-br from-zinc-900 via-zinc-950 to-black p-4 text-center text-xs font-semibold uppercase tracking-[0.18em] text-white/35 ${className}`}
        >
          {fallbackLabel}
        </div>
      }
    />
  );
}
