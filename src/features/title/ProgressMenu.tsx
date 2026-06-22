"use client";

import { useEffect, useRef, useState } from "react";

import ActionButton from "@/components/ui/ActionButton";

type ProgressMenuProps = {
  statusLabel: string;
  isUpToDate?: boolean;
  loading?: boolean;
  onUpdateProgress: () => void;
  onMarkUpToDate: () => void;
};

export default function ProgressMenu({
  statusLabel,
  isUpToDate = false,
  loading = false,
  onUpdateProgress,
  onMarkUpToDate,
}: ProgressMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (!rootRef.current) return;

      if (!rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  function runAction(callback: () => void) {
    callback();
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="relative inline-flex">
      <ActionButton
        variant={isUpToDate ? "utility" : "secondary"}
        size="md"
        active={isUpToDate}
        loading={loading}
        onClick={() => setOpen((current) => !current)}
        rightIcon={
          <span
            aria-hidden
            className={[
              "text-[11px] transition-transform duration-200",
              open ? "rotate-180" : "",
            ].join(" ")}
          >
            ▾
          </span>
        }
      >
        {statusLabel}
      </ActionButton>

      {open && (
        <div className="absolute left-0 top-[calc(100%+10px)] z-50 w-[280px] overflow-hidden rounded-2xl border border-white/[0.12] bg-zinc-950/92 p-1.5 shadow-[0_24px_70px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl">
          <button
            type="button"
            onClick={() => runAction(onUpdateProgress)}
            className="group flex w-full flex-col rounded-xl px-3.5 py-3 text-left transition-colors duration-200 hover:bg-white/[0.07]"
          >
            <span className="text-[13px] font-bold text-white">
              Atualizar progresso
            </span>

            <span className="mt-0.5 text-[11px] font-medium leading-snug text-white/48">
              Escolha até qual episódio você assistiu.
            </span>
          </button>

          <div className="my-1 h-px bg-white/[0.08]" />

          <button
            type="button"
            onClick={() => runAction(onMarkUpToDate)}
            className="group flex w-full flex-col rounded-xl px-3.5 py-3 text-left transition-colors duration-200 hover:bg-cyan-300/[0.08]"
          >
            <span className="text-[13px] font-bold text-cyan-50">
              Marcar como em dia
            </span>

            <span className="mt-0.5 text-[11px] font-medium leading-snug text-cyan-50/50">
              Marca tudo que já foi lançado.
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
