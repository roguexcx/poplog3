"use client";

import type { ReactNode } from "react";
import type { MouseEvent } from "react";

type Props = {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  active?: boolean;
  saving?: boolean;
  activeClass?: string;
  children: ReactNode;
};

export function CardActionButton({
  onClick,
  disabled = false,
  title,
  active = false,
  saving = false,
  activeClass = "",
  children,
}: Props) {
  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    onClick();
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={disabled || saving}
      title={title}
      aria-label={title}
      aria-pressed={active}
      className={[
        "grid h-[30px] w-[30px] place-items-center rounded-full border backdrop-blur-[10px]",
        "transition-[transform,background,border-color,box-shadow,opacity] duration-200",
        "active:scale-90 disabled:cursor-not-allowed disabled:opacity-50",
        active
          ? activeClass
          : "border-white/[0.18] bg-black/[0.72] text-white/60 hover:border-white/[0.30] hover:text-white/90",
        saving ? "cursor-wait" : "hover:scale-110",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {saving ? (
        <span className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent" />
      ) : (
        children
      )}
    </button>
  );
}
