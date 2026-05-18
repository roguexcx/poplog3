"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface UseScrollRowOptions {
  step?: number;
}

interface UseScrollRowReturn {
  ref: React.RefObject<HTMLDivElement | null>;
  canScrollLeft: boolean;
  canScrollRight: boolean;
  scrollLeft: () => void;
  scrollRight: () => void;
}

export function useScrollRow({
  step = 600,
}: UseScrollRowOptions = {}): UseScrollRowReturn {
  const ref = useRef<HTMLDivElement | null>(null);

  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(true);

  const sync = useCallback(() => {
    const el = ref.current;

    if (!el) {
      setCanScrollLeft(false);
      setCanScrollRight(false);
      return;
    }

    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    function attachListeners(el: HTMLDivElement) {
      sync();

      const raf = requestAnimationFrame(sync);

      el.addEventListener("scroll", sync, { passive: true });

      const resizeObserver = new ResizeObserver(sync);
      resizeObserver.observe(el);
      Array.from(el.children).forEach((child) => {
        resizeObserver.observe(child);
      });

      const mutationObserver = new MutationObserver(() => {
        Array.from(el.children).forEach((child) => {
          resizeObserver.observe(child);
        });
        requestAnimationFrame(sync);
      });

      mutationObserver.observe(el, {
        childList: true,
        subtree: true,
      });

      window.addEventListener("resize", sync);

      return () => {
        cancelAnimationFrame(raf);
        el.removeEventListener("scroll", sync);
        window.removeEventListener("resize", sync);
        mutationObserver.disconnect();
        resizeObserver.disconnect();
      };
    }

    const el = ref.current;

    if (el) {
      return attachListeners(el);
    }

    const parent = document.querySelector("section") ?? document.body;

    const mutationObserver = new MutationObserver(() => {
      const currentEl = ref.current;

      if (currentEl) {
        mutationObserver.disconnect();
        cleanup = attachListeners(currentEl);
      }
    });

    let cleanup: (() => void) | undefined;

    mutationObserver.observe(parent, {
      childList: true,
      subtree: true,
    });

    return () => {
      mutationObserver.disconnect();
      cleanup?.();
    };
  }, [sync]);

  const scrollLeft = useCallback(() => {
    ref.current?.scrollBy({
      left: -step,
      behavior: "smooth",
    });
    window.setTimeout(sync, 350);
  }, [step, sync]);

  const scrollRight = useCallback(() => {
    ref.current?.scrollBy({
      left: step,
      behavior: "smooth",
    });
    window.setTimeout(sync, 350);
  }, [step, sync]);

  return {
    ref,
    canScrollLeft,
    canScrollRight,
    scrollLeft,
    scrollRight,
  };
}
