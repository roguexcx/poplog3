import Link from "next/link";
import type { ReactNode } from "react";

import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import {
  friendlyTitlePlaceholder,
  sanitizeDisplayTitle,
  type MediaTypeLike,
  type TitleTechnicalIds,
} from "@/lib/titles/display-title";

type ProgressCardProps = {
  /** Título principal (nome da série/filme) */
  title: string;
  /** Subtítulo discreto. Ex: "S03 E07" ou "Aguardando temporada 4" */
  subtitle?: string;
  /** Texto da "próxima ação". Ex: "Próximo: Episódio 8 — sexta" */
  nextHint?: string;
  /** 0-100. Se omitido, a barra fica oculta. */
  progress?: number | null;
  /** Texto curto à direita da barra. Ex: "62%" ou "7/12" */
  progressLabel?: string;
  /** Caminho TMDB do backdrop/poster usado como ambientação */
  imagePath?: string | null;
  fallbackImagePath?: string | null;
  /** Link de navegação */
  href?: string;
  /** Slot inferior (botão de ação, etc) */
  action?: ReactNode;
  /** Slot tag (StatusBadge geralmente) */
  badge?: ReactNode;
  className?: string;
  /** Contexto opcional p/ placeholder amigável caso o título seja um ID. */
  mediaType?: MediaTypeLike;
  /** IDs técnicos conhecidos, para nunca exibi-los como nome. */
  ids?: TitleTechnicalIds;
};

export default function ProgressCard({
  title,
  subtitle,
  nextHint,
  progress,
  progressLabel,
  imagePath,
  fallbackImagePath,
  href,
  action,
  badge,
  className = "",
  mediaType,
  ids,
}: ProgressCardProps) {
  // Defesa final: nunca renderizar um ID técnico como título.
  const safeTitle =
    sanitizeDisplayTitle(title, ids) ?? friendlyTitlePlaceholder(mediaType);
  const hasProgress = typeof progress === "number";
  const clampedProgress = hasProgress
    ? Math.max(0, Math.min(100, progress as number))
    : 0;

  const content = (
    <article
      className={`group relative overflow-hidden rounded-[1.35rem] border border-white/[0.08] bg-white/[0.035] shadow-[0_18px_50px_rgba(0,0,0,0.28)] transition duration-300 hover:-translate-y-1 hover:border-white/[0.16] hover:bg-white/[0.055] ${className}`}
    >
      <div className="relative aspect-[16/9] overflow-hidden bg-white/[0.04]">
        <TmdbImage
          path={imagePath ?? null}
          fallbackPath={fallbackImagePath ?? null}
          size="w780"
          alt={safeTitle}
          fallbackLabel={safeTitle}
          className="h-full w-full object-cover brightness-[0.78] saturate-[1.08] transition duration-500 group-hover:scale-[1.04] group-hover:brightness-[0.9]"
        />

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/92 via-black/40 to-black/15"
          aria-hidden
        />

        {badge && <div className="absolute left-3 top-3 z-10">{badge}</div>}
      </div>

      <div className="relative -mt-12 px-4 pb-4 sm:px-5 sm:pb-5">
        <h3 className="line-clamp-1 text-base font-black tracking-[-0.03em] text-white sm:text-lg">
          {safeTitle}
        </h3>

        {subtitle && (
          <p className="mt-1 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/55">
            {subtitle}
          </p>
        )}

        {hasProgress && (
          <div className="mt-3 flex items-center gap-3">
            <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-cyan-300/90 via-indigo-300/90 to-fuchsia-300/90"
                style={{ width: `${clampedProgress}%` }}
              />
            </div>
            {progressLabel && (
              <span className="text-[11px] font-bold text-white/65">
                {progressLabel}
              </span>
            )}
          </div>
        )}

        {nextHint && (
          <p className="mt-3 line-clamp-2 text-[13px] leading-[1.45] text-white/68">
            {nextHint}
          </p>
        )}

        {action && <div className="mt-4">{action}</div>}
      </div>
    </article>
  );

  if (href) {
    return (
      <Link href={href} className="block">
        {content}
      </Link>
    );
  }

  return content;
}
