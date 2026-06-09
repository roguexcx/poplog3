"use client";

import { Clapperboard } from "lucide-react";
import { resolveForRender } from "@/lib/images/proxy";
import { useEffect, useMemo, useState } from "react";
import type { TitleTrailer as TitleTrailerData } from "./types";

type TitleTrailerProps = {
  trailer: TitleTrailerData | null | undefined;
  title?: string;
  variant?: "card" | "inline";
};

function getYoutubeId(url: string | null | undefined): string | null {
  if (!url) return null;
  return (
    url.match(/youtube\.com\/embed\/([^?&]+)/)?.[1] ??
    url.match(/youtube\.com\/watch\?v=([^&]+)/)?.[1] ??
    url.match(/youtu\.be\/([^?&]+)/)?.[1] ??
    null
  );
}

function isEmbeddable(embedUrl: string | null | undefined): boolean {
  return !!embedUrl?.includes("youtube.com/embed/");
}

const PREVIEW_CLASSES =
  "group relative w-full overflow-hidden rounded-[1.25rem] border border-white/[0.1] bg-black shadow-[0_18px_60px_rgba(0,0,0,0.26)] transition hover:border-white/[0.22]";

function PreviewMedia({ thumbnailUrl }: { thumbnailUrl: string | null | undefined }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden">
      {thumbnailUrl ? (
        <img
          src={resolveForRender(thumbnailUrl) ?? thumbnailUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-90 transition duration-300 group-hover:opacity-100"
        />
      ) : (
        <div className="absolute inset-0 bg-black" />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/35 via-black/5 to-transparent" />
      <div className="absolute left-1/2 top-1/2 grid h-12 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/70 bg-white/25 text-white shadow-xl transition group-hover:scale-105 group-hover:bg-white group-hover:text-black sm:h-14 sm:w-14">
        <span className="ml-0.5 text-lg sm:text-xl">▶</span>
      </div>
    </div>
  );
}

export default function TitleTrailer({
  trailer,
  title,
  variant = "card",
}: TitleTrailerProps) {
  const [open, setOpen] = useState(false);

  const youtubeId = useMemo(
    () => getYoutubeId(trailer?.embedUrl ?? trailer?.url),
    [trailer?.embedUrl, trailer?.url],
  );

  const embeddable = useMemo(() => isEmbeddable(trailer?.embedUrl), [trailer?.embedUrl]);

  const thumbnailUrl = youtubeId
    ? `https://img.youtube.com/vi/${youtubeId}/hqdefault.jpg`
    : (trailer?.thumbnailUrl ?? null);

  const displayTitle = trailer?.name?.trim() || title || "Trailer";

  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!trailer || (!trailer.embedUrl && !trailer.url)) return null;

  // Embed (YouTube): abre modal inline
  // Link externo (IMDb, outros): abre em nova aba
  const preview = embeddable ? (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={`Assistir trailer: ${displayTitle}`}
      className={`${PREVIEW_CLASSES} text-left`}
    >
      <PreviewMedia thumbnailUrl={thumbnailUrl} />
    </button>
  ) : (
    <a
      href={trailer.url ?? "#"}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Assistir trailer: ${displayTitle}`}
      className={`${PREVIEW_CLASSES} block`}
    >
      <PreviewMedia thumbnailUrl={thumbnailUrl} />
    </a>
  );

  return (
    <>
      {variant === "card" ? (
        <section className="relative rounded-[1.6rem] border border-white/[0.1] bg-white/[0.035] p-5 shadow-[0_20px_60px_rgba(0,0,0,0.22)] sm:p-6">
          <div className="mb-4">
            <div className="mb-5 flex items-center gap-2.5 text-rose-400">
              <Clapperboard className="h-4 w-4" />
              <span className="text-xs font-black uppercase tracking-[0.22em]">
                Trailer
              </span>
            </div>

            <h2 className="text-xl font-black tracking-[-0.035em] text-white sm:text-2xl">
              {displayTitle}
            </h2>
          </div>

          {preview}
        </section>
      ) : (
        <div className="w-full max-w-sm">{preview}</div>
      )}

      {open && embeddable && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Trailer: ${displayTitle}`}
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/92 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="relative w-full max-w-5xl overflow-hidden rounded-[1.25rem] border border-white/[0.12] bg-black"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Fechar"
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-full border border-white/[0.16] bg-black/70 text-white/85 transition hover:border-white/[0.32] hover:bg-black"
            >
              ×
            </button>

            <div className="relative aspect-video w-full bg-black">
              <iframe
                src={`${trailer.embedUrl ?? ""}?autoplay=1&rel=0`}
                title={displayTitle}
                className="absolute inset-0 h-full w-full"
                allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
