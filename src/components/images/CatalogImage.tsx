"use client";

/**
 * CatalogImage — componente de imagem agnóstico de fonte.
 *
 * Substitui TmdbImage como componente padrão de imagem do POPLOG.
 * Aceita URLs completas (Trakt, TheTVDB, Balloonerismm, CDN próprio)
 * ou paths TMDB legados (/abc.jpg) para compatibilidade histórica.
 *
 * Não usa image.tmdb.org como fallback ativo — image.tmdb.org só é
 * servido quando o path legado TMDB for o único disponível, e mesmo
 * assim apenas se TMDB_ALLOW_IMAGE_FALLBACK estiver habilitado via
 * controle na rota de servidor.
 *
 * Fluxo recomendado:
 *   posterUrl (da Source Engine) → fallbackUrl → fallbackNode
 */

import Image, { type ImageProps } from "next/image";
import { useState, type ReactNode } from "react";

// ─── Resolução de URL ─────────────────────────────────────────────────────────

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";

/**
 * Resolve a URL final da imagem de forma agnóstica.
 *
 * Prioridade:
 *   1. URL completa (Trakt, TheTVDB, Balloonerismm, CDN próprio) → passthrough
 *   2. Path TMDB legado (/abc.jpg) → prepend TMDB CDN
 *   3. null/undefined → null
 */
export function resolveCatalogImageUrl(
  src: string | null | undefined,
  size: string = "w500",
): string | null {
  if (!src) return null;
  if (src.startsWith("http://") || src.startsWith("https://")) return src;
  // Path legado TMDB
  const normalized = src.startsWith("/") ? src : `/${src}`;
  return `${TMDB_IMAGE_BASE}/${size}${normalized}`;
}

// ─── Tipos ────────────────────────────────────────────────────────────────────

export type CatalogImageSize =
  | "w185"
  | "w300"
  | "w342"
  | "w500"
  | "w780"
  | "w1280"
  | "original";

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

  const primary = resolveCatalogImageUrl(src, size);
  const secondary = resolveCatalogImageUrl(fallbackSrc, size);

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

  const primary = resolveCatalogImageUrl(src, size);
  const secondary = resolveCatalogImageUrl(fallbackSrc, size);
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
