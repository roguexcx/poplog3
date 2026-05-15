import type { ReactNode } from "react";

type SectionHeaderAccent = "indigo" | "cyan" | "amber" | "rose" | "neutral";

type SectionHeaderProps = {
  /** Pequena label uppercase acima do título da seção */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** Slot do lado direito (filtros, contagem, "ver tudo") */
  action?: ReactNode;
  accent?: SectionHeaderAccent;
  /** Tamanho do título */
  size?: "sm" | "md" | "lg";
  className?: string;
};

const ACCENT_LABEL: Record<SectionHeaderAccent, string> = {
  indigo: "text-indigo-200/70",
  cyan: "text-cyan-200/70",
  amber: "text-amber-200/70",
  rose: "text-rose-200/70",
  neutral: "text-white/50",
};

const TITLE_SIZE: Record<NonNullable<SectionHeaderProps["size"]>, string> = {
  sm: "text-lg sm:text-xl",
  md: "text-xl sm:text-2xl md:text-3xl",
  lg: "text-2xl sm:text-3xl md:text-4xl",
};

export default function SectionHeader({
  eyebrow,
  title,
  subtitle,
  action,
  accent = "indigo",
  size = "md",
  className = "",
}: SectionHeaderProps) {
  return (
    <div
      className={`flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-6 ${className}`}
    >
      <div className="min-w-0 flex-1">
        {eyebrow && (
          <p
            className={`text-[10px] font-black uppercase tracking-[0.22em] ${ACCENT_LABEL[accent]} sm:text-[11px]`}
          >
            {eyebrow}
          </p>
        )}

        <h2
          className={`mt-1.5 font-black tracking-[-0.03em] text-white ${TITLE_SIZE[size]}`}
        >
          {title}
        </h2>

        {subtitle && (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-white/45">
            {subtitle}
          </p>
        )}
      </div>

      {action && <div className="shrink-0 self-start sm:self-end">{action}</div>}
    </div>
  );
}
