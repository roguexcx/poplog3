"use client";

import { useEffect, useState } from "react";

import ActionButton from "@/components/ui/ActionButton";

import type { TitleTrailer as TitleTrailerData } from "./types";

type TitleTrailerProps = {
  trailer: TitleTrailerData;
  variant?: "card" | "inline";
};

export default function TitleTrailer({
  trailer,
  variant = "card",
}: TitleTrailerProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const trigger = (
    <ActionButton
      variant={variant === "card" ? "primary" : "secondary"}
      size="md"
      leftIcon={
        <span aria-hidden className="text-[12px]">
          ▶
        </span>
      }
      onClick={() => setOpen(true)}
    >
      Assistir trailer
    </ActionButton>
  );

  return (
    <>
      {variant === "card" ? (
        <section className="relative overflow-hidden rounded-[1.5rem] border border-white/[0.08] bg-white/[0.035] p-5 backdrop-blur-xl sm:p-6">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_50%,rgba(244,114,182,0.10),transparent_55%)]"
            aria-hidden
          />
          <div className="relative flex flex-col gap-3">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-rose-200/70">
              Trailer oficial
            </p>
            <h3 className="text-base font-black tracking-[-0.02em] text-white sm:text-lg">
              {trailer.name}
            </h3>
            <div className="mt-1">{trigger}</div>
          </div>
        </section>
      ) : (
        trigger
      )}

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Trailer: ${trailer.name}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/82 p-4 backdrop-blur-md"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-5xl overflow-hidden rounded-[1.5rem] border border-white/[0.12] bg-black/85 shadow-[0_30px_120px_rgba(0,0,0,0.7)]"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/[0.16] bg-black/55 text-white/85 backdrop-blur-md transition hover:border-white/[0.32] hover:bg-black/70"
            >
              ×
            </button>

            <div className="relative aspect-video w-full">
              <iframe
                src={`${trailer.embedUrl}?autoplay=1&rel=0`}
                title={trailer.name}
                className="absolute inset-0 h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
