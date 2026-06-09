"use client";

import { useLibraryStatus } from "@/hooks/useLibraryStatus";
import type { TitleIdentityInput } from "@/lib/user-title-identity";

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  watched:   { label: "Assistido",  cls: "border-emerald-500/40 bg-emerald-900/75 text-emerald-300" },
  watchlist: { label: "Watchlist",  cls: "border-sky-500/40 bg-sky-900/75 text-sky-300" },
  watching:  { label: "Assistindo", cls: "border-violet-500/40 bg-violet-900/75 text-violet-300" },
  abandoned: { label: "Abandonado", cls: "border-rose-500/40 bg-rose-900/75 text-rose-300" },
  fridge:    { label: "Geladeira",  cls: "border-amber-500/40 bg-amber-900/75 text-amber-300" },
};

type Props = TitleIdentityInput & {
  /** Posição absoluta (default: top-left). Passe className para sobrescrever. */
  className?: string;
};

/**
 * Badge que exibe o estado da biblioteca do usuário para um título.
 * Usa `useLibraryStatus` internamente — completamente reativo via UserDataContext.
 * Renderiza `null` se o usuário não estiver logado ou o título não estiver na biblioteca.
 */
export default function LibraryStateBadge({ className, ...identity }: Props) {
  const { status, isFavorite, inLibrary } = useLibraryStatus(identity);

  if (!inLibrary || !status) return null;

  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.watched;
  const label =
    isFavorite && status === "watched" ? `★ ${cfg.label}` : cfg.label;

  return (
    <span
      className={[
        "pointer-events-none absolute z-20 rounded-md border px-2 py-0.5",
        "text-[8.5px] font-black uppercase tracking-wide backdrop-blur-sm",
        cfg.cls,
        className ?? "top-2 left-2",
      ].join(" ")}
    >
      {label}
    </span>
  );
}
