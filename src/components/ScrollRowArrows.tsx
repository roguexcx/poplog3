type Props = {
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onLeft: () => void;
  onRight: () => void;
};

function ArrowButton({
  onClick,
  disabled,
  direction,
}: {
  onClick: () => void;
  disabled: boolean;
  direction: "left" | "right";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={direction === "left" ? "Rolar para a esquerda" : "Rolar para a direita"}
      className={[
        "grid h-9 w-9 place-items-center rounded-full border backdrop-blur-[10px]",
        "transition-[transform,opacity,background,border-color,box-shadow] duration-200",
        "active:scale-95",
        disabled
          ? "pointer-events-none cursor-default opacity-30 border-white/[0.10] bg-black/[0.40] text-white/30"
          : [
              "opacity-100 cursor-pointer hover:scale-110",
              "border-white/[0.18] bg-black/[0.72] text-white/85",
              "hover:border-violet-500/60 hover:shadow-[0_0_12px_rgba(139,92,246,0.3)]",
            ].join(" "),
      ].join(" ")}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {direction === "left" ? (
          <path d="M15 18l-6-6 6-6" />
        ) : (
          <path d="M9 18l6-6-6-6" />
        )}
      </svg>
    </button>
  );
}

export function ScrollRowArrows({ canScrollLeft, canScrollRight, onLeft, onRight }: Props) {
  return (
    <div className="flex items-center gap-1.5">
      <ArrowButton onClick={onLeft}  disabled={!canScrollLeft}  direction="left"  />
      <ArrowButton onClick={onRight} disabled={!canScrollRight} direction="right" />
    </div>
  );
}
