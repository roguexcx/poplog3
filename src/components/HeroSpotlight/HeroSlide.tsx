"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useState, useEffect } from "react";
import Image from "next/image";
import type { ScoredItem } from "./types";
import HeroCTA from "./HeroCTA";
import { useRandomizedTitleDisplay } from "@/components/titles/LocalizedTitle";
import { resolveForRender as resolveCatalogImage } from "@/lib/images/proxy";
import { getCanonicalProviderDisplayName, resolveProviderLogoForRender, } from "@/lib/streaming/provider-display";
interface HeroSlideProps {
    item: ScoredItem;
    onNotNow: () => void;
    onCTAClick: () => void;
    onNavigate: () => void;
}
function ProgressBar({ value, max, color = "#a07ee0", }: {
    value: number;
    max: number;
    color?: string;
}) {
    const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
    return (<div className="h-1 w-full overflow-hidden rounded-full bg-white/12">
      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: color }}/>
    </div>);
}
function ProgressContext({ item }: {
    item: ScoredItem;
}) {
    if (item.content_type === "filme") {
        const runtime = item.runtime ?? 0;
        const progress = item.watch_progress_minutes ?? 0;
        if (!runtime || progress <= 0) {
            return (<div className="flex items-center gap-2 text-sm text-white/50">
          <div className="h-1 w-16 rounded-full bg-white/12"/>
          <span>{uiMessage("ui.742a21da47b6")}</span>
        </div>);
        }
        const remaining = Math.max(runtime - progress, 0);
        const pct = Math.round((progress / runtime) * 100);
        const remainingLabel = item.remaining_runtime_label;
        return (<div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs text-white/55">
          <span>{pct}{uiMessage("ui.559fb30750fc")}</span>
          {remaining > 0 && remainingLabel ? <span>{remainingLabel}</span> : null}
        </div>
        <ProgressBar value={progress} max={runtime} color={(item as any).serverEyebrow?.color ?? "#a07ee0"}/>
      </div>);
    }
    const total = item.total_episodes_season ?? 0;
    const watched = item.episodes_watched ?? 0;
    if (!total || watched <= 0) {
        return (<div className="flex items-center gap-2 text-sm text-white/50">
        <div className="h-1 w-16 rounded-full bg-white/12"/>
        <span>{uiMessage("ui.f6b8d09a41c1")}</span>
      </div>);
    }
    const remaining = Math.max(total - watched, 0);
    return (<div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-white/55">
        <span>
          {remaining} {remaining === 1 ? uiMessage("ui.056e1978a57e") : uiMessage("ui.e9b8aa9b871e")}
        </span>
        <span>
          {watched}/{total}
        </span>
      </div>
      <ProgressBar value={watched} max={total} color={(item as any).serverEyebrow?.color ?? "#a07ee0"}/>
    </div>);
}
function NextEpisodeBox({ item }: {
    item: ScoredItem;
}) {
    if (item.content_type !== "serie" || !item.current_season)
        return null;
    const episode = (item.current_episode ?? 0) + 1;
    const season = item.current_season ?? 1;
    const episodeName = item.next_episode_name ?? uiMessage("ui.7a13022bd85a", { v1: episode });
    const runtimeLabel = item.next_episode_duration_label;
    return (<div className="flex items-start gap-3 rounded-xl border border-white/10 bg-black/30 p-3 backdrop-blur-sm">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/8">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="white" opacity={0.7}>
          <path d="M3 2.5l10 5.5-10 5.5V2.5z"/>
        </svg>
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-white/40">
          T{season}E{episode}{uiMessage("ui.e0a8ab275d9f")}{runtimeLabel ? ` · ${runtimeLabel}` : ""}
        </p>
        <p className="mt-0.5 truncate text-sm font-semibold text-white/90">
          {episodeName}
        </p>
      </div>
    </div>);
}
export default function HeroSlide({ item, onNotNow, onCTAClick, onNavigate, }: HeroSlideProps) {
    const eyebrow = (item as any).serverEyebrow ?? { text: "CURADORIA", color: "#a07ee0" };
    const cta = (item as any).serverCta ?? { primary: uiMessage("ui.bb641b6104ae"), icon: "play" };
    const { mainTitle } = useRandomizedTitleDisplay(item.title, item.original_title);
    const backdropUrl = resolveCatalogImage(item.backdrop_path, "original");
    const episodeStillUrl = resolveCatalogImage(item.next_episode_still_path, "original");
    const alternateBackdropUrl = resolveCatalogImage(item.alternate_backdrop_path, "original");
    const secondaryUrl = episodeStillUrl ?? (alternateBackdropUrl !== backdropUrl ? alternateBackdropUrl : null);
    const dominantColor = item.dominant_color ?? "#1a1a2e";
    const glowRgb = hexToRgb(dominantColor);
    const genres = Array.isArray(item.genres) ? item.genres.join(" · ") : "";
    const platform = getCanonicalProviderDisplayName({ name: item.streaming_platform ?? item.best_provider_name }) ??
        item.streaming_platform ??
        "";
    const platformLogo = resolveProviderLogoForRender({
        name: item.best_provider_name,
        logoUrl: item.best_provider_logo,
    });
    const yearStr = item.year?.toString() ?? "";
    const runtimeLabel = item.runtime_label;
    // Alterna entre o backdrop principal e uma segunda imagem editorial quando disponível.
    const [showSecondary, setShowSecondary] = useState(false);
    useEffect(() => {
        setShowSecondary(false);
        if (!backdropUrl || !secondaryUrl)
            return;
        const id = setInterval(() => setShowSecondary((s) => !s), 6000);
        return () => clearInterval(id);
    }, [item.content_id, backdropUrl, secondaryUrl]);
    return (<div className="relative h-full w-full cursor-pointer overflow-hidden" onClick={onNavigate}>
      {/* Camada backdrop */}
      {backdropUrl ? (<div className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out" style={{ opacity: showSecondary ? 0 : 1 }}>
          <Image src={backdropUrl} alt="" fill className="object-cover object-center" priority sizes="100vw" quality={100}/>
        </div>) : null}

      {/* Camada de segunda imagem: still de episódio ou backdrop alternativo */}
      {secondaryUrl ? (<div className="absolute inset-0 transition-opacity duration-[1200ms] ease-in-out" style={{ opacity: !backdropUrl || showSecondary ? 1 : 0 }}>
          <Image src={secondaryUrl} alt="" fill className="object-cover object-center" sizes="100vw" quality={100}/>
        </div>) : null}

      {/* Fallback gradiente quando não há imagem */}
      {!backdropUrl && !secondaryUrl ? (<div className="absolute inset-0" style={{
                background: `linear-gradient(135deg, ${dominantColor} 0%, #0a0b0f 100%)`,
            }}/>) : null}

      {glowRgb ? (<div className="pointer-events-none absolute inset-0" style={{
                background: `radial-gradient(ellipse 70% 60% at 65% 50%, rgba(${glowRgb},0.15) 0%, transparent 70%)`,
            }}/>) : null}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/84 via-black/34 to-black/5 sm:from-black/78 sm:via-black/22 sm:to-transparent"/>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#0a0b0f] via-transparent to-transparent"/>
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/20 to-transparent"/>

      <div className="relative flex h-full flex-col justify-end">
        <div className="flex max-w-[720px] flex-col justify-end gap-3 p-4 pb-12 sm:gap-4 sm:p-5 sm:pb-7 md:p-8 md:pb-10 lg:p-12 lg:pb-12 xl:max-w-[58%]">
          <div className="flex items-center gap-2">
            <span className="h-1 w-5 rounded-full" style={{ background: eyebrow.color }}/>
            <span className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: eyebrow.color }}>
              {eyebrow.text}
            </span>
          </div>

          <h2 className="max-w-[15ch] text-[1.65rem] font-black leading-[0.95] tracking-[-0.04em] text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)] max-[360px]:text-[1.45rem] sm:max-w-none sm:text-3xl md:text-4xl lg:text-[2.75rem]">
            {mainTitle}
          </h2>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/55 sm:text-xs">
            {yearStr ? <span>{yearStr}</span> : null}

            {genres ? (<>
                {yearStr ? <span className="text-white/25">·</span> : null}
                <span>{genres}</span>
              </>) : null}

            {platform ? (<>
                {yearStr || genres ? (<span className="text-white/25">·</span>) : null}
                <span className="inline-flex items-center gap-1 rounded-md bg-white/10 px-2 py-0.5 font-medium text-white/70">
                  {platformLogo ? (<Image src={platformLogo} alt={platform} width={14} height={14} unoptimized className="h-3.5 w-3.5 rounded-sm object-contain"/>) : null}
                  {platform}
                </span>
              </>) : null}

            {runtimeLabel ? (<>
                {yearStr || genres || platform ? (<span className="text-white/25">·</span>) : null}
                <span>{runtimeLabel}</span>
              </>) : null}
          </div>

          <ProgressContext item={item}/>
          <NextEpisodeBox item={item}/>
          <HeroCTA cta={cta} onPrimary={onCTAClick} onNotNow={onNotNow}/>
        </div>
      </div>
    </div>);
}
function hexToRgb(hex: string): string | null {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result)
        return null;
    return `${parseInt(result[1], 16)},${parseInt(result[2], 16)},${parseInt(result[3], 16)}`;
}

