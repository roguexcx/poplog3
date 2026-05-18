import type { ElementType } from "react";

type TitleVariant = "hero" | "large" | "medium" | "compact" | "poster";

type Props = {
  title: string;
  originalTitle?: string | null;
  variant?: TitleVariant;
  as?: ElementType;
  className?: string;
};

function normalizeTitle(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim();
}

export function getDisplayOriginalTitle(
  title: string,
  originalTitle?: string | null,
): string | null {
  const original = originalTitle?.trim();
  if (!original) return null;
  return normalizeTitle(original) !== normalizeTitle(title) ? original : null;
}

export default function LocalizedTitle({
  title,
  originalTitle,
  variant = "medium",
  as: Tag = "div",
  className = "",
}: Props) {
  const original = getDisplayOriginalTitle(title, originalTitle);
  const fullTitle = original ? `${title} (${original})` : title;

  if (variant === "poster") {
    return (
      <Tag title={fullTitle} className={className}>
        {title}
      </Tag>
    );
  }

  const mainClass = {
    hero: "block text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl md:text-[2.8rem]",
    large: "block line-clamp-2 text-[1.45rem] font-black leading-tight text-white",
    medium: "block line-clamp-2 text-[13px] font-[500] leading-[1.35] tracking-[-0.01em] text-[#e8e8f0]",
    compact: "block line-clamp-1 text-[12px] font-semibold leading-tight text-white/85",
  }[variant];

  const originalClass = {
    hero: "mt-1.5 block line-clamp-1 text-sm font-light text-zinc-500 sm:text-base",
    large: "mt-1 block line-clamp-1 text-xs font-light text-zinc-400/75",
    medium: "mt-0.5 block line-clamp-1 text-[10px] font-light text-zinc-500/80",
    compact: "mt-[2px] block line-clamp-1 text-[10px] font-light text-white/35",
  }[variant];

  return (
    <Tag title={fullTitle} className={className}>
      <span className={mainClass}>{title}</span>
      {original && <span className={originalClass}>{original}</span>}
    </Tag>
  );
}
