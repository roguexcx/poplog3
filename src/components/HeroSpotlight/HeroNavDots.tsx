"use client";

interface HeroNavDotsProps {
  count: number;
  current: number;
  onChange: (index: number) => void;
}

export default function HeroNavDots({
  count,
  current,
  onChange,
}: HeroNavDotsProps) {
  return (
    <div className="flex items-center gap-2" role="tablist" aria-label="Slides do Hero">
      {Array.from({ length: count }).map((_, i) => (
        <button
          key={i}
          role="tab"
          aria-selected={i === current}
          aria-label={`Slide ${i + 1}`}
          onClick={() => onChange(i)}
          className="relative h-1.5 rounded-full transition-all duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white/60"
          style={{
            width: i === current ? 28 : 8,
            background:
              i === current
                ? "rgba(255,255,255,0.9)"
                : "rgba(255,255,255,0.28)",
          }}
        />
      ))}
    </div>
  );
}
