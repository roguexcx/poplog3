import type { ReactNode } from "react";

/**
 * Status canônicos do POPLOG. Cobre estado do usuário (user_titles)
 * e estados editoriais (em breve, novo episódio, etc).
 */
export type StatusBadgeVariant =
  | "watchlist"
  | "watching"
  | "watched"
  | "abandoned"
  | "fridge"
  | "coming-soon"
  | "new-episode"
  | "finished"
  | "in-season"
  | "neutral";

type StatusBadgeProps = {
  variant: StatusBadgeVariant;
  /** Override do texto exibido. Se omitido, usa o label canônico do variant. */
  label?: string;
  /** Glyph opcional à esquerda */
  icon?: ReactNode;
  size?: "xs" | "sm" | "md";
  className?: string;
};

const VARIANT_STYLES: Record<StatusBadgeVariant, string> = {
  watchlist:
    "border-indigo-300/25 bg-indigo-500/15 text-indigo-100/90",
  watching:
    "border-cyan-300/25 bg-cyan-500/15 text-cyan-100/90",
  watched:
    "border-emerald-300/25 bg-emerald-500/15 text-emerald-100/90",
  abandoned:
    "border-rose-300/25 bg-rose-500/15 text-rose-100/90",
  fridge:
    "border-sky-300/25 bg-sky-500/15 text-sky-100/90",
  "coming-soon":
    "border-amber-300/25 bg-amber-500/15 text-amber-100/90",
  "new-episode":
    "border-fuchsia-300/30 bg-fuchsia-500/15 text-fuchsia-100/90",
  finished:
    "border-violet-300/25 bg-violet-500/15 text-violet-100/90",
  "in-season":
    "border-teal-300/25 bg-teal-500/15 text-teal-100/90",
  neutral:
    "border-white/[0.12] bg-black/55 text-white/78",
};

const DEFAULT_LABEL: Record<StatusBadgeVariant, string> = {
  watchlist: "Watchlist",
  watching: "Assistindo",
  watched: "Assistido",
  abandoned: "Abandonado",
  fridge: "Geladeira",
  "coming-soon": "Em breve",
  "new-episode": "Novo episódio",
  finished: "Finalizada",
  "in-season": "Em temporada",
  neutral: "—",
};

const SIZE_STYLES: Record<NonNullable<StatusBadgeProps["size"]>, string> = {
  xs: "px-2 py-0.5 text-[9px] tracking-[0.12em]",
  sm: "px-2.5 py-1 text-[10px] tracking-[0.14em]",
  md: "px-3 py-1.5 text-[11px] tracking-[0.16em]",
};

export default function StatusBadge({
  variant,
  label,
  icon,
  size = "sm",
  className = "",
}: StatusBadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border font-black uppercase backdrop-blur-md ${VARIANT_STYLES[variant]} ${SIZE_STYLES[size]} ${className}`}
    >
      {icon && <span className="inline-flex">{icon}</span>}
      {label ?? DEFAULT_LABEL[variant]}
    </span>
  );
}
