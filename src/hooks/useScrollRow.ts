// src/hooks/useScrollRow.ts
"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseScrollRowOptions {
  step?: number;
}

interface UseScrollRowReturn {
  ref: React.RefObject<HTMLDivElement>;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollLeft: () => void;
  scrollRight: () => void;
}

export function useScrollRow({ step = 600 }: UseScrollRowOptions = {}): UseScrollRowReturn {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft]   = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const sync = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  // Usa MutationObserver + ResizeObserver para detectar quando o div
  // aparece no DOM (após loading terminar) e sincroniza imediatamente.
  useEffect(() => {
    const el = ref.current;
    if (!el) {
      // Div ainda não existe — observa o pai para saber quando ele aparecer
      const parent = document.querySelector("section") ?? document.body;
      const mo = new MutationObserver(() => {
        if (ref.current) {
          mo.disconnect();
          attachListeners(ref.current);
        }
      });
      mo.observe(parent, { childList: true, subtree: true });
      return () => mo.disconnect();
    }
    return attachListeners(el);
  }, [sync]); // eslint-disable-line react-hooks/exhaustive-deps

  function attachListeners(el: HTMLDivElement) {
    // Sync imediato + após próximo frame (garante que scrollWidth foi calculado)
    sync();
    const raf = requestAnimationFrame(sync);

    el.addEventListener("scroll", sync, { passive: true });
    const ro = new ResizeObserver(sync);
    ro.observe(el);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("scroll", sync);
      ro.disconnect();
    };
  }

  const scrollLeft = useCallback(() => {
    ref.current?.scrollBy({ left: -step, behavior: "smooth" });
  }, [step]);

  const scrollRight = useCallback(() => {
    ref.current?.scrollBy({ left: step, behavior: "smooth" });
  }, [step]);

  return { ref, canScrollLeft, canScrollRight, scrollLeft, scrollRight };
}