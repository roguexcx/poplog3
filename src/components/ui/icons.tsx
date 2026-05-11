// src/components/ui/icons.tsx
// Ícones SVG pequenos reutilizados nos cards de poster e seções de home.

export function IconBookmark({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={2.2}
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconCheck() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function IconStar() {
  return (
    <svg viewBox="0 0 24 24" className="h-[9px] w-[9px]" fill="#fbbf24">
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  );
}

export function IconX() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[13px] w-[13px]"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeWidth={2.4}
    >
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}
