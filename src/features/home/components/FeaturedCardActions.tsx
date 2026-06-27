"use client";
import { useState } from "react";
import { CardActionButton } from "@/components/ui/CardActionButton";
import { useLocale } from "@/context/LocaleContext";
import { IconBookmark, IconCheck } from "@/components/ui/icons";
import { useUserAction } from "@/hooks/useUserAction";
import { useOptionalUserData } from "@/context/UserDataContext";
import { usePoplogUserState } from "@/stores/user-states-store";
type Props = {
    tmdbId: number;
    poplogId?: string | number | null;
    imdbId?: string | null;
    slug?: string | null;
    mediaType: "movie" | "tv";
    title: string;
    releaseYear: number | null;
};
export default function FeaturedCardActions({ tmdbId, poplogId = null, imdbId = null, slug = null, mediaType, title, releaseYear, }: Props) {
    const { locale, ui } = useLocale();
    const userData = useOptionalUserData();
    const isLoggedIn = Boolean(userData && !userData.loading);
    const poplogIdStr = typeof poplogId === "string" ? poplogId :
        typeof poplogId === "number" ? String(poplogId) : undefined;
    const { executeAction, effectiveKey } = useUserAction({
        tmdbId,
        poplogId: poplogIdStr,
        imdbId: imdbId ?? undefined,
        slug: slug ?? undefined,
        mediaType,
        title,
        releaseYear: releaseYear ?? undefined,
    });
    const zustandState = usePoplogUserState(effectiveKey);
    const inWatchlist = zustandState?.isInWatchlist ?? false;
    const isWatched = zustandState?.isWatched ?? false;
    const [saving, setSaving] = useState(false);
    async function handleAction(action: "addToWatchlist" | "removeFromWatchlist" | "markAsWatched" | "markAsUnwatched") {
        setSaving(true);
        await executeAction(action);
        setSaving(false);
    }
    return (<div className="flex items-center gap-2">
      <CardActionButton onClick={() => handleAction(inWatchlist ? "removeFromWatchlist" : "addToWatchlist")} disabled={!isLoggedIn || saving} title={inWatchlist ? (locale.interfaceLanguage === "en-US" ? "Remove from watchlist" : "Remover da watchlist") : (locale.interfaceLanguage === "en-US" ? "Add to watchlist" : "Adicionar à watchlist")} active={inWatchlist} saving={saving} activeClass="border-sky-400/55 bg-sky-400/[0.18] text-sky-300 shadow-[0_0_10px_rgba(56,189,248,0.25)]">
        <IconBookmark filled={inWatchlist}/>
      </CardActionButton>

      <CardActionButton onClick={() => handleAction(isWatched ? "markAsUnwatched" : "markAsWatched")} disabled={!isLoggedIn || saving} title={isWatched ? (locale.interfaceLanguage === "en-US" ? "Unmark as watched" : "Desmarcar como assistido") : ui("ui.56c6eef6ab5b")} active={isWatched} saving={saving} activeClass="border-emerald-400/55 bg-emerald-400/[0.18] text-emerald-300 shadow-[0_0_10px_rgba(52,211,153,0.25)]">
        <IconCheck />
      </CardActionButton>
    </div>);
}
