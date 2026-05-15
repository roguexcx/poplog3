"use client";

import type {
  ButtonHTMLAttributes,
  ForwardedRef,
  ReactNode,
} from "react";
import { forwardRef } from "react";

type ActionButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ActionButtonSize = "sm" | "md" | "lg";

type ActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  children: ReactNode;
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  /** Glyph à esquerda */
  leftIcon?: ReactNode;
  /** Glyph à direita */
  rightIcon?: ReactNode;
  /** Estado de loading */
  loading?: boolean;
  /** Estado ativo (pill toggleável) */
  active?: boolean;
  /** Ocupar largura inteira */
  full?: boolean;
};

const VARIANT_STYLES: Record<ActionButtonVariant, string> = {
  primary:
    "bg-white text-zinc-950 hover:bg-white/92 active:bg-white/85 shadow-[0_8px_28px_rgba(255,255,255,0.18)]",
  secondary:
    "border border-white/[0.14] bg-white/[0.06] text-white/90 hover:border-white/[0.22] hover:bg-white/[0.10] backdrop-blur-md",
  ghost:
    "text-white/70 hover:text-white hover:bg-white/[0.06]",
  danger:
    "border border-rose-300/30 bg-rose-500/15 text-rose-100 hover:bg-rose-500/22",
};

const ACTIVE_OVERRIDE: Record<ActionButtonVariant, string> = {
  primary:
    "bg-indigo-400 text-zinc-950 hover:bg-indigo-300 shadow-[0_8px_28px_rgba(129,140,248,0.35)]",
  secondary:
    "border-indigo-300/45 bg-indigo-500/22 text-indigo-50 hover:bg-indigo-500/30",
  ghost: "text-indigo-200 bg-indigo-500/14",
  danger:
    "border-rose-300/45 bg-rose-500/30 text-rose-50 hover:bg-rose-500/40",
};

const SIZE_STYLES: Record<ActionButtonSize, string> = {
  sm: "h-9 px-3.5 text-[12px] gap-1.5",
  md: "h-11 px-5 text-[13px] gap-2",
  lg: "h-12 px-6 text-sm gap-2",
};

const ActionButton = forwardRef(function ActionButton(
  {
    children,
    variant = "secondary",
    size = "md",
    leftIcon,
    rightIcon,
    loading = false,
    active = false,
    full = false,
    disabled,
    className = "",
    type = "button",
    ...rest
  }: ActionButtonProps,
  ref: ForwardedRef<HTMLButtonElement>
) {
  const isBusy = loading;
  const isDisabled = disabled || isBusy;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={isBusy}
      aria-pressed={active}
      className={[
        "inline-flex items-center justify-center rounded-full font-semibold tracking-[-0.01em]",
        "transition-[transform,background,border-color,box-shadow,opacity] duration-200",
        "disabled:cursor-not-allowed disabled:opacity-60",
        active ? ACTIVE_OVERRIDE[variant] : VARIANT_STYLES[variant],
        SIZE_STYLES[size],
        full ? "w-full" : "",
        isBusy ? "cursor-wait" : "",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      {...rest}
    >
      {isBusy ? (
        <span
          className="h-3.5 w-3.5 animate-spin rounded-full border border-current border-t-transparent"
          aria-hidden
        />
      ) : (
        leftIcon && <span className="inline-flex">{leftIcon}</span>
      )}

      <span className="inline-flex items-center">{children}</span>

      {!isBusy && rightIcon && <span className="inline-flex">{rightIcon}</span>}
    </button>
  );
});

export default ActionButton;
