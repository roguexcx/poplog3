"use client";

import {
  getCanonicalProviderDisplayName,
  resolveProviderLogoForRender,
} from "@/lib/streaming/provider-display";

/**
 * Badge COMPACTO de disponibilidade para o canto inferior dos cards (Trending,
 * Para você, Acompanhando…). Espelha exatamente o badge já usado no card da
 * Watchlist (WatchlistPickCard), garantindo o MESMO contrato visual em todas as
 * superfícies. Contrato:
 *   - name: nome canônico do provider (ex.: "HBO MAX")
 *   - logoPath: path/URL do logo (opcional — sem logo, mostra só o nome)
 *   - type: vocabulário do card (subscription | free | ads | rent | buy)
 *
 * Renderiza sempre que houver `name`; logo é opcional (igual à detail page).
 */
export default function CardProviderBadge({
  name,
  logoPath,
  type,
}: {
  name: string | null;
  logoPath?: string | null;
  type?: string | null;
}) {
  if (!name) return null;

  const displayName = getCanonicalProviderDisplayName({ name }) ?? name;
  const isSubscription = type === "subscription" || type === "free" || type === "ads";
  const logoSrc = resolveProviderLogoForRender({ name, logoUrl: logoPath });

  return (
    <div className="inline-flex items-center gap-1 rounded-md bg-black/60 px-1.5 py-0.5 backdrop-blur-sm">
      {logoSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoSrc} alt={displayName} className="h-3 w-3 rounded-sm object-contain" />
      ) : null}
      <span
        className={[
          "text-[9px] font-bold leading-none",
          isSubscription ? "text-teal-300/90" : "text-white/60",
        ].join(" ")}
      >
        {displayName}
      </span>
    </div>
  );
}
