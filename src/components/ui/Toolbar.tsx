import type { ReactNode } from "react";

type ToolbarProps = {
  children: ReactNode;
  /** Slot esquerdo (label, contagem, tabs) */
  left?: ReactNode;
  /** Slot direito (filtros, sort, ação primária) */
  right?: ReactNode;
  /** Variante visual. "card" envolve em glass, "bare" deixa flat */
  variant?: "card" | "bare";
  /** Alinhamento mobile: stack ou row */
  stack?: boolean;
  className?: string;
};

export default function Toolbar({
  children,
  left,
  right,
  variant = "card",
  stack = true,
  className = "",
}: ToolbarProps) {
  const layout = stack
    ? "flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
    : "flex items-center justify-between gap-4";

  const skin =
    variant === "card"
      ? "rounded-2xl border border-white/[0.08] bg-white/[0.035] p-3 backdrop-blur-md sm:p-4"
      : "";

  // Se left/right estiverem definidos, eles têm prioridade sobre children
  if (left || right) {
    return (
      <div className={`${layout} ${skin} ${className}`}>
        {left && <div className="flex items-center gap-3">{left}</div>}
        {right && (
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            {right}
          </div>
        )}
      </div>
    );
  }

  return <div className={`${layout} ${skin} ${className}`}>{children}</div>;
}
