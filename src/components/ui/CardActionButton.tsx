"use client";
// src/components/ui/CardActionButton.tsx
// Botão de ação circular (30px) usado nos cards de poster em todo o sistema.

import type { ReactNode } from "react";

type Props = {
  onClick: () => void;
  disabled: boolean;
  title: string;
  active: boolean;
  saving: boolean;
  activeClass: string;
  children: ReactNode;
};

export function CardActionButton({
  onClick,
  disabled,
  title,
  active,
  saving,
  activeClass,
  children,
}: Props) {
  const unavailable = disabled || saving;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (unavailable) return;
        onClick();
      }}
      title={saving ? "Salvando..." : title}
      aria-busy={saving}
      aria-disabled={unavailable}
      className={[
        "grid h-[30px] w-[30px] place-items-center rounded-full border backdrop-blur-[10px]",
        "transition-[transform,background,border-color,box-shadow,opacity] duration-200",
        saving ? "cursor-wait opacity-90" : "cursor-pointer hover:scale-110",
        disabled && !saving ? "opacity-60" : "",
        active
          ? activeClass
          : "border-white/[0.18] bg-black/[0.72] text-white/85 hover:border-violet-500/60 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]",
      ].join(" ")}
    >
      {saving ? (
        <span className="h-[12px] w-[12px] animate-spin rounded-full border border-current border-t-transparent" />
      ) : (
        children
      )}
    </button>
  );
}
