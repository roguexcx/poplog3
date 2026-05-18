import Link from "next/link";
import type { ReactNode } from "react";

import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";

type PosterCardProps = {
  /** Caminho do poster TMDB. Pode incluir ou não a `/` inicial. */
  posterPath: string | null | undefined;
  /** Caminho de fallback (geralmente backdrop) caso o poster falte. */
  fallbackPath?: string | null;
  /** Texto principal do card */
  title: string;
  /** Subtítulo discreto (ano, status, etc) */
  subtitle?: string;
  /** Tipo de mídia (afeta meta-row no rodapé) */
  mediaType?: "movie" | "tv";
  /** Ano de lançamento */
  year?: number | string | null;
  /** Link de navegação. Se omitido, o card vira não-clicável. */
  href?: string;
  /** Slot superior esquerdo do poster (geralmente StatusBadge) */
  topLeft?: ReactNode;
  /** Slot superior direito do poster (geralmente rating star) */
  topRight?: ReactNode;
  /** Slot inferior (aparece on-hover) */
  bottomOverlay?: ReactNode;
  /** Slot fora do poster, abaixo do título */
  footer?: ReactNode;
  /** Loading priority pra Next.js Image */
  priority?: boolean;
  /** Aspect ratio. Default 2:3 (poster). */
  aspectRatio?: "2/3" | "16/9";
  /** Acento da glow on-hover */
  accent?: "indigo" | "cyan" | "amber" | "rose";
  className?: string;
};

const ACCENT_GLOW: Record<NonNullable<PosterCardProps["accent"]>, string> = {
  indigo:
    "bg-[radial-gradient(circle_at_50%_115%,rgba(99,102,241,0.28),transparent_58%)]",
  cyan:
    "bg-[radial-gradient(circle_at_50%_115%,rgba(34,211,238,0.28),transparent_58%)]",
  amber:
    "bg-[radial-gradient(circle_at_50%_115%,rgba(251,191,36,0.24),transparent_58%)]",
  rose:
    "bg-[radial-gradient(circle_at_50%_115%,rgba(244,114,182,0.26),transparent_58%)]",
};

const ASPECT_CLASS: Record<NonNullable<PosterCardProps["aspectRatio"]>, string> = {
  "2/3": "aspect-[2/3]",
  "16/9": "aspect-[16/9]",
};

export default function PosterCard({
  posterPath,
  fallbackPath = null,
  title,
  subtitle,
  mediaType,
  year,
  href,
  topLeft,
  topRight,
  bottomOverlay,
  footer,
  priority = false,
  aspectRatio = "2/3",
  accent = "indigo",
  className = "",
}: PosterCardProps) {
  const content = (
    <article className={`relative ${className}`}>
      <div className="relative overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-white/[0.035] shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition duration-300 group-hover:-translate-y-1 group-hover:border-white/[0.16] group-hover:bg-white/[0.055] group-hover:shadow-[0_26px_70px_rgba(0,0,0,0.48)]">
        <div
          className={`relative ${ASPECT_CLASS[aspectRatio]} overflow-hidden bg-white/[0.04]`}
        >
          <TmdbImage
            path={posterPath ?? null}
            fallbackPath={fallbackPath}
            size="w500"
            alt={title}
            fallbackLabel={title}
            priority={priority}
            className="h-full w-full object-cover brightness-[0.92] saturate-[1.04] transition duration-500 group-hover:scale-[1.045] group-hover:brightness-100"
          />

          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/82 via-black/10 to-black/20"
            aria-hidden
          />

          <div
            className={`pointer-events-none absolute inset-0 opacity-0 transition duration-500 group-hover:opacity-100 ${ACCENT_GLOW[accent]}`}
            aria-hidden
          />

          {topLeft && (
            <div className="absolute left-3 top-3 z-10">{topLeft}</div>
          )}

          {topRight && (
            <div className="absolute right-3 top-3 z-10">{topRight}</div>
          )}

          {bottomOverlay && (
            <div className="absolute inset-x-0 bottom-0 p-3 opacity-0 transition duration-300 group-hover:opacity-100 sm:p-4">
              {bottomOverlay}
            </div>
          )}
        </div>
      </div>

      <div className="px-1 pb-1 pt-3">
        <h3 className="line-clamp-2 text-[13px] font-semibold leading-[1.35] tracking-[-0.015em] text-white/92">
          {title}
        </h3>

        {(subtitle || year || mediaType) && (
          <div className="mt-1.5 flex items-center gap-2 text-[11px] text-white/36">
            {subtitle ? (
              <span className="truncate">{subtitle}</span>
            ) : (
              <>
                <span>{year ?? "—"}</span>
                {mediaType && (
                  <>
                    <span
                      className="h-1 w-1 rounded-full bg-white/18"
                      aria-hidden
                    />
                    <span>{mediaType === "movie" ? "Filme" : "Série"}</span>
                  </>
                )}
              </>
            )}
          </div>
        )}

        {footer && <div className="mt-2">{footer}</div>}
      </div>
    </article>
  );

  if (href) {
    return (
      <Link href={href} className="group block">
        {content}
      </Link>
    );
  }

  return <div className="group block">{content}</div>;
}
