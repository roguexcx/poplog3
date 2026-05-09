// src/features/title/TitleTrailerModal.tsx
"use client";

import { useState, useEffect } from "react";

export default function TitleTrailerModal({ trailerKey }: { trailerKey: string }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("poplog:open-trailer", handler);
    return () => window.removeEventListener("poplog:open-trailer", handler);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.88)" }}
      onClick={() => setOpen(false)}
    >
      <div
        style={{
          position: "relative",
          width: "min(90vw, 900px)",
          aspectRatio: "16/9",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <iframe
          src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1`}
          allowFullScreen
          allow="autoplay; encrypted-media"
          style={{
            width: "100%",
            height: "100%",
            borderRadius: 12,
            border: "none",
          }}
          title="Trailer"
        />
        <button
          type="button"
          onClick={() => setOpen(false)}
          style={{
            position: "absolute",
            top: -30,
            right: 0,
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.5)",
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          Fechar ×
        </button>
      </div>
    </div>
  );
}
