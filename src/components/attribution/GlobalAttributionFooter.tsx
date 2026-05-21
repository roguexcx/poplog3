"use client";

import { useState } from "react";

import AttributionModal from "./AttributionModal";

export default function GlobalAttributionFooter() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <footer className="mx-auto mt-14 w-full max-w-[1600px] px-1 pb-4 text-center md:text-left">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/18 transition hover:text-white/42"
        >
          Fontes de dados
        </button>
      </footer>

      <AttributionModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
