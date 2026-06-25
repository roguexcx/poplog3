"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
/**
 * StarRating
 *
 * Componente de avaliação por estrelas. Suporta meia-estrela (0.5 incrementos).
 * Funciona em dois modos:
 *   interactive  → usuário pode selecionar uma nota (hover + click)
 *   readonly     → exibe a nota sem interação
 *
 * Props:
 *   value        → nota atual (0–5). null = sem avaliação.
 *   max          → número de estrelas (padrão: 5)
 *   size         → "sm" | "md" | "lg"
 *   interactive  → habilita hover e clique
 *   onChange     → callback chamado com o novo valor ao clicar
 *   className    → classe extra no container
 */
import { useState, useCallback } from "react";
type StarRatingSize = "sm" | "md" | "lg";
type StarRatingProps = {
    value?: number | null;
    max?: number;
    size?: StarRatingSize;
    interactive?: boolean;
    onChange?: (value: number) => void;
    className?: string;
    /** Mostra a nota numérica ao lado das estrelas */
    showLabel?: boolean;
    /** Label de acessibilidade */
    ariaLabel?: string;
};
const SIZE_MAP: Record<StarRatingSize, {
    star: string;
    gap: string;
    label: string;
}> = {
    sm: { star: "w-3.5 h-3.5", gap: "gap-0.5", label: "text-[11px]" },
    md: { star: "w-5 h-5", gap: "gap-1", label: "text-[13px]" },
    lg: { star: "w-7 h-7", gap: "gap-1.5", label: "text-base" },
};
// SVG de meia estrela — lado esquerdo preenchido, direito vazio
function StarSvg({ fill, className, }: {
    fill: "full" | "half" | "empty";
    className?: string;
}) {
    return (<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" className={className} aria-hidden>
      <defs>
        <linearGradient id={`half-${fill}`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="50%" stopColor={fill === "empty" ? "currentColor" : "rgb(250 204 21)"} stopOpacity={fill === "empty" ? "0.25" : "1"}/>
          <stop offset="50%" stopColor="currentColor" stopOpacity="0.25"/>
        </linearGradient>
      </defs>
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" fill={fill === "full"
            ? "rgb(250 204 21)"
            : fill === "half"
                ? `url(#half-${fill})`
                : "currentColor"} fillOpacity={fill === "empty" ? 0.25 : 1}/>
    </svg>);
}
export default function StarRating({ value = null, max = 5, size = "md", interactive = false, onChange, className = "", showLabel = false, ariaLabel, }: StarRatingProps) {
    const [hovered, setHovered] = useState<number | null>(null);
    const activeValue = hovered ?? value ?? 0;
    const { star, gap, label } = SIZE_MAP[size];
    // Resolve o fill de cada estrela dado o valor ativo
    function starFill(index: number): "full" | "half" | "empty" {
        const pos = index + 1; // 1-indexed
        if (activeValue >= pos)
            return "full";
        if (activeValue >= pos - 0.5)
            return "half";
        return "empty";
    }
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLButtonElement>, index: number) => {
        if (!interactive)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const isHalf = x < rect.width / 2;
        setHovered(isHalf ? index + 0.5 : index + 1);
    }, [interactive]);
    const handleClick = useCallback((e: React.MouseEvent<HTMLButtonElement>, index: number) => {
        if (!interactive || !onChange)
            return;
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const isHalf = x < rect.width / 2;
        onChange(isHalf ? index + 0.5 : index + 1);
    }, [interactive, onChange]);
    const stars = Array.from({ length: max }, (_, i) => i);
    return (<div className={`flex items-center ${gap} ${className}`} aria-label={ariaLabel ?? uiMessage("ui.30ec8e73d0ba", { v1: value ?? 0, v2: max })} role={interactive ? "group" : undefined}>
      {stars.map((i) => interactive ? (<button key={i} type="button" className={`${star} relative cursor-pointer text-white/40 transition-transform duration-75 hover:scale-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 focus-visible:ring-offset-1 focus-visible:ring-offset-transparent`} onMouseMove={(e) => handleMouseMove(e, i)} onMouseLeave={() => setHovered(null)} onClick={(e) => handleClick(e, i)} aria-label={uiMessage("ui.64182bea939f", { v1: i + 1, v2: i !== 0 ? "s" : "" })}>
            <StarSvg fill={starFill(i)} className="h-full w-full"/>
          </button>) : (<span key={i} className={`${star} text-white/40`}>
            <StarSvg fill={starFill(i)} className="h-full w-full"/>
          </span>))}

      {showLabel && value !== null && value !== undefined && (<span className={`${label} ml-1 font-bold tabular-nums text-white/70`}>
          {value.toFixed(1)}
        </span>)}
    </div>);
}

