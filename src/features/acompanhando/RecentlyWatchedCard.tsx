"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import type { RecentlyWatchedItem } from "@/app/api/continuity/recently-watched/route";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import CardProviderBadge from "@/components/ui/CardProviderBadge";
export type { RecentlyWatchedItem };
type Props = {
    item: RecentlyWatchedItem;
    onClick: () => void;
};
function formatRelativeDate(iso: string): string {
    const now = Date.now();
    const diff = now - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60)
        return "agora";
    const hrs = Math.floor(mins / 60);
    if (hrs < 24)
        return uiMessage("ui.04618adf1c1f", { v1: hrs });
    const days = Math.floor(hrs / 24);
    if (days === 1)
        return "ontem";
    if (days < 7)
        return uiMessage("ui.782ccbaa74fc", { v1: days });
    if (days < 30)
        return uiMessage("ui.2a527b3a7ec7", { v1: Math.floor(days / 7) });
    return uiMessage("ui.3da8343bc5a0", { v1: Math.floor(days / 30) });
}
export default function RecentlyWatchedCard({ item, onClick }: Props) {
    const { mainTitle } = useRandomizedTitleDisplay(item.title, item.original_title);
    // Prioridade: still do episódio → backdrop da série → vazio
    const stillUrl = resolveCatalogImage(item.last_episode_still_path, "w300") ??
        resolveCatalogImage(item.backdrop_path, "w300") ??
        resolveCatalogImage(item.poster_path, "w185");
    const relDate = formatRelativeDate(item.watched_at);
    const episodeLabel = item.last_season != null && item.last_episode != null
        ? `T${item.last_season}E${item.last_episode}`
        : null;
    const detailLabel = episodeLabel
        ? uiMessage("ui.b5140bd53a54", { v1: episodeLabel, v2: item.last_episode_name ? ` · ${item.last_episode_name}` : "" }) : item.media_type === "movie"
        ? "Filme assistido"
        : uiMessage("ui.a5c92bb757e2");
    return (<button type="button" onClick={onClick} className="group relative flex h-[72px] w-full items-stretch overflow-hidden rounded-xl border border-white/[0.07] bg-zinc-900/70 text-left transition-all hover:border-white/[0.15] hover:bg-zinc-900/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/30 sm:h-[68px]">
      {/* Still — proporção 16:9, largura fixa */}
      <div className="relative h-full w-[104px] shrink-0 overflow-hidden bg-white/[0.04] sm:w-[112px]">
        {stillUrl ? (<img src={stillUrl} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]"/>) : (<div className="flex h-full w-full items-center justify-center">
            <span className="text-[9px] font-bold text-white/15">{uiMessage("ui.afb5a240ac91")}</span>
          </div>)}
        {/* Gradiente direito para fundir com o conteúdo */}
        <div className="absolute inset-y-0 right-0 w-4 bg-gradient-to-r from-transparent to-zinc-900/80 transition-colors group-hover:to-zinc-900"/>
        {item.best_provider_name && (<div className="absolute bottom-1 left-1">
            <CardProviderBadge name={item.best_provider_name} logoPath={item.best_provider_logo} type={item.best_provider_type}/>
          </div>)}
      </div>

      {/* Info */}
      <div className="flex min-w-0 flex-1 flex-col justify-center px-3 py-2">
        <p className="line-clamp-1 text-[12px] font-black leading-tight tracking-[-0.01em] text-white">
          {mainTitle}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[10px] font-semibold text-white/38">
          {detailLabel}
        </p>
        <p className="mt-1 text-[9px] font-semibold tabular-nums text-white/24">{relDate}</p>
      </div>
    </button>);
}

