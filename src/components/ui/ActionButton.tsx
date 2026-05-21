"use client";

import type { ButtonHTMLAttributes, ForwardedRef, ReactNode } from "react";
import { forwardRef } from "react";

type ActionButtonVariant =
  | "primary"
  | "secondary"
  | "social"
  | "utility"
  | "ghost"
  | "danger";

type ActionButtonSize = "sm" | "md" | "lg";

type ActionButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  children: ReactNode;
  variant?: ActionButtonVariant;
  size?: ActionButtonSize;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  loading?: boolean;
  active?: boolean;
  full?: boolean;
};

const BASE =
  "group relative isolate inline-flex items-center justify-center overflow-hidden rounded-full font-semibold tracking-[-0.015em] outline-none";

const MOTION =
  "transition-[transform,background,border-color,box-shadow,opacity,color] duration-200 ease-out active:scale-[0.97] hover:-translate-y-0.5";

const DISABLED =
  "disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0";

const VARIANT_STYLES: Record<ActionButtonVariant, string> = {
  primary:
    "border border-white/[0.18] bg-white text-zinc-950 shadow-[0_14px_36px_rgba(255,255,255,0.18)] hover:bg-white/95 hover:shadow-[0_18px_46px_rgba(255,255,255,0.24)]",

  secondary:
    "border border-white/[0.14] bg-white/[0.065] text-white/88 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl hover:border-white/[0.25] hover:bg-white/[0.105] hover:text-white hover:shadow-[0_12px_34px_rgba(0,0,0,0.22)]",

  social:
    "border border-white/[0.11] bg-white/[0.045] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl hover:border-white/[0.22] hover:bg-white/[0.085] hover:text-white",

  utility:
    "border border-white/[0.11] bg-white/[0.045] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl hover:border-cyan-200/[0.28] hover:bg-cyan-950/[0.18] hover:text-cyan-50",

  ghost:
    "border border-transparent text-white/62 hover:border-white/[0.10] hover:bg-white/[0.055] hover:text-white",

  danger:
    "border border-white/[0.11] bg-white/[0.045] text-white/70 shadow-[inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-xl hover:border-rose-300/30 hover:bg-rose-500/10 hover:text-rose-100",
};

const ACTIVE_OVERRIDE: Record<ActionButtonVariant, string> = {
  primary:
    "border-cyan-200/45 bg-gradient-to-r from-cyan-200 via-white to-indigo-200 text-zinc-950 shadow-[0_16px_44px_rgba(103,232,249,0.28)] hover:shadow-[0_20px_54px_rgba(103,232,249,0.36)]",

  secondary:
    "border-indigo-200/35 bg-indigo-500/22 text-indigo-50 shadow-[0_12px_34px_rgba(99,102,241,0.20),inset_0_1px_0_rgba(255,255,255,0.10)] hover:border-indigo-200/48 hover:bg-indigo-500/30",

  social:
    "border-amber-200/32 bg-amber-400/[0.14] text-amber-50 shadow-[0_10px_28px_rgba(251,191,36,0.14),inset_0_1px_0_rgba(255,255,255,0.10)] hover:border-amber-200/45 hover:bg-amber-400/[0.20]",

  utility:
    "border-cyan-200/55 bg-cyan-400/[0.20] text-cyan-50 shadow-[0_0_0_1px_rgba(103,232,249,0.18),0_14px_38px_rgba(34,211,238,0.22),inset_0_1px_0_rgba(255,255,255,0.14)] hover:border-cyan-200/70 hover:bg-cyan-400/[0.26]",

  ghost:
    "border-white/[0.12] bg-white/[0.075] text-white",

  danger:
    "border-rose-300/55 bg-rose-500/28 text-rose-50 shadow-[0_0_0_1px_rgba(253,164,175,0.18),0_14px_38px_rgba(244,63,94,0.22)] hover:bg-rose-500/36",
};

const SIZE_STYLES: Record<ActionButtonSize, string> = {
  sm: "h-9 px-3.5 text-[12px] gap-1.5",
  md: "h-11 px-5 text-[13px] gap-2",
  lg: "h-12 px-6 text-sm gap-2.5",
};

const GLOW_STYLES: Record<ActionButtonVariant, string> = {
  primary:
    "before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(circle_at_50%_0%,rgba(255,255,255,0.38),transparent_54%)] before:opacity-80",

  secondary:
    "before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(circle_at_50%_0%,rgba(129,140,248,0.18),transparent_58%)] before:opacity-0 before:transition-opacity before:duration-200 hover:before:opacity-100",

  social:
    "before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(circle_at_50%_0%,rgba(251,191,36,0.14),transparent_60%)] before:opacity-0 before:transition-opacity before:duration-200 hover:before:opacity-100",

  utility:
    "before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.20),transparent_60%)] before:opacity-0 before:transition-opacity before:duration-200 hover:before:opacity-100",

  ghost: "",

  danger:
    "before:absolute before:inset-0 before:-z-10 before:bg-[radial-gradient(circle_at_50%_0%,rgba(244,63,94,0.18),transparent_60%)] before:opacity-0 before:transition-opacity before:duration-200 hover:before:opacity-100",
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
        BASE,
        MOTION,
        DISABLED,
        active ? ACTIVE_OVERRIDE[variant] : VARIANT_STYLES[variant],
        GLOW_STYLES[variant],
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
        leftIcon && (
          <span className="inline-flex shrink-0 items-center justify-center text-current/90 transition-transform duration-200 group-hover:scale-105">
            {leftIcon}
          </span>
        )
      )}

      <span className="inline-flex items-center whitespace-nowrap">{children}</span>

      {!isBusy && rightIcon && (
        <span className="inline-flex shrink-0 items-center justify-center text-current/80 transition-transform duration-200 group-hover:translate-x-0.5">
          {rightIcon}
        </span>
      )}
    </button>
  );
});

export default ActionButton;
