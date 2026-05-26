"use client";

import { useEffect, useMemo, useState, type ElementType } from "react";

type TitleVariant = "hero" | "large" | "medium" | "compact" | "poster";

type Props = {
  title: string;
  originalTitle?: string | null;
  variant?: TitleVariant;
  as?: ElementType;
  className?: string;
};

declare global {
  interface Window {
    __poplogTitleShuffleSeed?: number;
  }
}

function normalizeTitle(value?: string | null): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim();
}

/**
 * Retorna o título a ser exibido como principal (original/inglês prioritário)
 * e o título secundário (localizado, quando diferente do original).
 *
 * Lógica:
 * - Se originalTitle existe e é diferente do title localizado → exibe originalTitle
 *   como principal e title (localizado) como subtítulo discreto.
 * - Se são iguais ou não há originalTitle → exibe apenas title.
 */
export function getDisplayOriginalTitle(
  title: string,
  originalTitle?: string | null,
): string | null {
  const original = originalTitle?.trim();
  if (!original) return null;
  return normalizeTitle(original) !== normalizeTitle(title) ? original : null;
}

function hashTitle(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function titleShuffleSeed() {
  if (typeof window === "undefined") return 0;
  window.__poplogTitleShuffleSeed ??= Math.random();
  return window.__poplogTitleShuffleSeed;
}

export function resolveRandomizedTitleDisplay(
  title: string,
  originalTitle?: string | null,
  seed = 0,
) {
  const diffOriginal = getDisplayOriginalTitle(title, originalTitle);
  if (!diffOriginal) {
    return {
      mainTitle: title,
      subTitle: null as string | null,
      fullTitle: title,
    };
  }

  const normalizedPair = `${normalizeTitle(title)}|${normalizeTitle(diffOriginal)}`;
  const localizedFirst =
    ((hashTitle(normalizedPair) + Math.floor(seed * 10_000)) % 2) === 0;
  const mainTitle = localizedFirst ? title : diffOriginal;
  const subTitle = localizedFirst ? diffOriginal : title;

  return {
    mainTitle,
    subTitle,
    fullTitle: `${mainTitle} (${subTitle})`,
  };
}

export function useRandomizedTitleDisplay(
  title: string,
  originalTitle?: string | null,
) {
  const [seed, setSeed] = useState(0);

  useEffect(() => {
    setSeed(titleShuffleSeed());
  }, []);

  return useMemo(
    () => resolveRandomizedTitleDisplay(title, originalTitle, seed),
    [title, originalTitle, seed],
  );
}

export default function LocalizedTitle({
  title,
  originalTitle,
  variant = "medium",
  as: Tag = "div",
  className = "",
}: Props) {
  const { mainTitle, subTitle, fullTitle } = useRandomizedTitleDisplay(
    title,
    originalTitle,
  );

  if (variant === "poster") {
    return (
      <Tag title={fullTitle} className={className}>
        {mainTitle}
      </Tag>
    );
  }

  const mainClass = {
    hero: "block text-3xl font-black leading-tight tracking-tight text-white sm:text-4xl md:text-[2.8rem]",
    large: "block line-clamp-2 text-[1.45rem] font-black leading-tight text-white",
    medium: "block line-clamp-2 text-[13px] font-[500] leading-[1.35] tracking-[-0.01em] text-[#e8e8f0]",
    compact: "block line-clamp-1 text-[12px] font-semibold leading-tight text-white/85",
  }[variant];

  const subClass = {
    hero: "mt-1.5 block line-clamp-1 text-sm font-light text-zinc-500 sm:text-base",
    large: "mt-1 block line-clamp-1 text-xs font-light text-zinc-400/75",
    medium: "mt-0.5 block line-clamp-1 text-[10px] font-light text-zinc-500/80",
    compact: "mt-[2px] block line-clamp-1 text-[10px] font-light text-white/35",
  }[variant];

  return (
    <Tag title={fullTitle} className={className}>
      <span className={mainClass}>{mainTitle}</span>
      {subTitle && <span className={subClass}>{subTitle}</span>}
    </Tag>
  );
}
