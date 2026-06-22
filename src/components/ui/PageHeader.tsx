import type { ReactNode } from "react";

type PageHeaderAccent = "indigo" | "cyan" | "amber" | "rose" | "neutral";

type PageHeaderProps = {
  /** Mini-label acima do título. Ex: "POPLOG LIBRARY" */
  eyebrow?: string;
  /** Título principal da página */
  title: string;
  /** Descrição curta (1-2 linhas) abaixo do título */
  description?: string;
  /** Slot opcional do lado direito (stats, filtros, ação primária) */
  children?: ReactNode;
  /** Cor de destaque das radiais de fundo */
  accent?: PageHeaderAccent;
  /** Variante visual */
  variant?: "hero" | "minimal";
  className?: string;
};

const ACCENT_RADIALS: Record<PageHeaderAccent, string> = {
  indigo:
    "bg-[radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_90%_20%,rgba(217,70,239,0.10),transparent_28%)]",
  cyan:
    "bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_92%_30%,rgba(99,102,241,0.14),transparent_30%)]",
  amber:
    "bg-[radial-gradient(circle_at_18%_0%,rgba(251,191,36,0.16),transparent_38%),radial-gradient(circle_at_88%_25%,rgba(244,114,182,0.10),transparent_32%)]",
  rose:
    "bg-[radial-gradient(circle_at_18%_0%,rgba(244,114,182,0.18),transparent_36%),radial-gradient(circle_at_88%_25%,rgba(129,140,248,0.12),transparent_30%)]",
  neutral:
    "bg-[radial-gradient(circle_at_18%_0%,rgba(255,255,255,0.08),transparent_38%),radial-gradient(circle_at_92%_25%,rgba(255,255,255,0.05),transparent_30%)]",
};

const ACCENT_LINE: Record<PageHeaderAccent, string> = {
  indigo: "bg-indigo-300/80",
  cyan: "bg-cyan-300/80",
  amber: "bg-amber-300/80",
  rose: "bg-rose-300/80",
  neutral: "bg-white/40",
};

const ACCENT_LABEL: Record<PageHeaderAccent, string> = {
  indigo: "text-indigo-200/80",
  cyan: "text-cyan-200/80",
  amber: "text-amber-200/80",
  rose: "text-rose-200/80",
  neutral: "text-white/60",
};

export default function PageHeader({
  eyebrow,
  title,
  description,
  children,
  accent = "indigo",
  variant = "hero",
  className = "",
}: PageHeaderProps) {
  if (variant === "minimal") {
    return (
      <header className={`flex flex-col gap-3 sm:gap-4 ${className}`}>
        {eyebrow && (
          <div className="flex items-center gap-2">
            <span
              className={`h-px w-8 ${ACCENT_LINE[accent]} sm:w-10`}
              aria-hidden
            />
            <span
              className={`text-[10px] font-black uppercase tracking-[0.24em] ${ACCENT_LABEL[accent]} sm:text-[11px]`}
            >
              {eyebrow}
            </span>
          </div>
        )}

        <h1 className="max-w-4xl text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl md:text-4xl">
          {title}
        </h1>

        {description && (
          <p className="max-w-2xl text-sm leading-6 text-white/55 sm:text-base sm:leading-7">
            {description}
          </p>
        )}

        {children && <div className="mt-2">{children}</div>}
      </header>
    );
  }

  return (
    <header className={`relative w-full ${className}`}>
      <div className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:rounded-[1.75rem] sm:p-6 md:p-8 lg:rounded-[2rem] lg:p-10">
        <div
          className={`pointer-events-none absolute inset-0 ${ACCENT_RADIALS[accent]}`}
          aria-hidden
        />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
          aria-hidden
        />

        <div className="relative grid gap-4 sm:gap-5 md:gap-7 xl:grid-cols-[1.1fr_0.9fr] xl:items-end">
          <div className="max-w-3xl">
            {eyebrow && (
              <div className="mb-2 flex items-center gap-2 sm:mb-3 md:mb-5">
                <span
                  className={`h-px w-6 ${ACCENT_LINE[accent]} sm:w-8 md:w-10`}
                  aria-hidden
                />
                <span
                  className={`text-[8px] font-black uppercase tracking-[0.22em] ${ACCENT_LABEL[accent]} sm:text-[9px] md:text-[10px] md:tracking-[0.28em]`}
                >
                  {eyebrow}
                </span>
              </div>
            )}

            <h1 className="max-w-4xl text-2xl font-black tracking-[-0.05em] text-white sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl">
              {title}
            </h1>

            {description && (
              <p className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5 text-white/54 sm:mt-3 sm:text-sm sm:leading-6 md:mt-5 md:text-[17px] md:leading-7">
                {description}
              </p>
            )}
          </div>

          {children && <div className="relative">{children}</div>}
        </div>
      </div>
    </header>
  );
}
