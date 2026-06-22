import type { ReactNode } from "react";

type EmptyStateAccent = "indigo" | "cyan" | "amber" | "rose" | "neutral";

type EmptyStateProps = {
  /** Glyph/emoji/letra única exibida no avatar circular */
  icon?: ReactNode;
  /** Mini-label uppercase acima do título */
  kicker?: string;
  /** Mensagem principal */
  title: string;
  /** Descrição opcional */
  description?: string;
  /** Botão ou link opcional */
  action?: ReactNode;
  accent?: EmptyStateAccent;
  className?: string;
};

const ACCENT_RADIAL: Record<EmptyStateAccent, string> = {
  indigo:
    "bg-[radial-gradient(circle_at_50%_0%,rgba(129,140,248,0.16),transparent_42%)]",
  cyan:
    "bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.16),transparent_42%)]",
  amber:
    "bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.14),transparent_42%)]",
  rose:
    "bg-[radial-gradient(circle_at_50%_0%,rgba(244,114,182,0.16),transparent_42%)]",
  neutral:
    "bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.08),transparent_42%)]",
};

const ACCENT_KICKER: Record<EmptyStateAccent, string> = {
  indigo: "text-indigo-200/65",
  cyan: "text-cyan-200/65",
  amber: "text-amber-200/65",
  rose: "text-rose-200/65",
  neutral: "text-white/55",
};

export default function EmptyState({
  icon = "◎",
  kicker,
  title,
  description,
  action,
  accent = "indigo",
  className = "",
}: EmptyStateProps) {
  return (
    <div
      className={`relative overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.035] px-6 py-14 text-center shadow-[0_22px_70px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:px-8 md:py-20 ${className}`}
    >
      <div
        className={`pointer-events-none absolute inset-0 ${ACCENT_RADIAL[accent]}`}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent"
        aria-hidden
      />

      <div className="relative mx-auto max-w-xl">
        <div className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl border border-white/[0.1] bg-black/20 text-2xl shadow-inner">
          {icon}
        </div>

        {kicker && (
          <p
            className={`text-[10px] font-black uppercase tracking-[0.24em] ${ACCENT_KICKER[accent]}`}
          >
            {kicker}
          </p>
        )}

        <h2 className="mt-3 text-2xl font-black tracking-[-0.04em] text-white sm:text-3xl">
          {title}
        </h2>

        {description && (
          <p className="mx-auto mt-4 max-w-md text-sm leading-7 text-white/50">
            {description}
          </p>
        )}

        {action && <div className="mt-6 flex justify-center">{action}</div>}
      </div>
    </div>
  );
}
