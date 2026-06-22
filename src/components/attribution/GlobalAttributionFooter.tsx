"use client";

import { useState } from "react";

import AttributionModal from "./AttributionModal";

export default function GlobalAttributionFooter() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <footer className="mx-auto mt-1 w-full max-w-[1600px] px-1 pb-0 text-center md:mt-4 md:pb-1 md:text-left">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[9px] font-bold uppercase tracking-[0.16em] text-white/16 transition hover:text-white/42 md:text-[10px] md:tracking-[0.18em]"
        >
          Fontes de dados
        </button>
      </footer>

      <AttributionModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
