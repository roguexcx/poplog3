"use client";

import { useState } from "react";

type Props = {
  text: string | null;
  collapsedLines?: 2 | 3 | 4;
  className?: string;
};

export default function SynopsisText({
  text,
  collapsedLines = 3,
  className = "",
}: Props) {
  const [expanded, setExpanded] = useState(false);

  if (!text) return null;

  const clampClass = expanded
    ? ""
    : collapsedLines === 2
      ? "line-clamp-2"
      : collapsedLines === 3
        ? "line-clamp-3"
        : "line-clamp-4";

  return (
    <div className={className}>
      <p className={`text-[13px] leading-5 text-zinc-300 ${clampClass}`}>
        {text}
      </p>

      <button
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setExpanded((current) => !current);
        }}
        className="mt-1.5 text-[11px] font-bold text-sky-300 transition hover:text-sky-200"
      >
        {expanded ? "Mostrar menos" : "Continuar lendo"}
      </button>
    </div>
  );
}
