"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type { TitleCacheInfo } from "./types";

type TitleSyncBarProps = {
  lastSyncedAt?: string | null;
  cacheInfo?: TitleCacheInfo | null;
};

function formatAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s atras`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}min atras`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}h atras`;
  const d = Math.round(h / 24);
  return `${d}d atras`;
}

function statusTone(status: string | undefined): string {
  switch (status) {
    case "fresh":
      return "text-emerald-300";
    case "stale_refreshed":
    case "force_refreshed":
    case "created":
      return "text-cyan-300";
    case "no_imdb_id":
    case "omdb_failed":
      return "text-amber-300";
    default:
      return "text-white/55";
  }
}

export default function TitleSyncBar({
  lastSyncedAt,
  cacheInfo,
}: TitleSyncBarProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [ago, setAgo] = useState<string>(() => formatAgo(lastSyncedAt));

  useEffect(() => {
    setAgo(formatAgo(lastSyncedAt));
    const t = setInterval(() => setAgo(formatAgo(lastSyncedAt)), 30_000);
    return () => clearInterval(t);
  }, [lastSyncedAt]);

  function triggerRefresh() {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    url.searchParams.set("refresh", "1");
    // Cache-busting param para forçar Next.js a re-renderizar.
    url.searchParams.set("_t", String(Date.now()));
    startTransition(() => {
      router.push(`${url.pathname}${url.search}`);
      router.refresh();
    });
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 sm:bottom-6 sm:right-6">
      {open ? (
        <div className="flex w-[260px] flex-col gap-2.5 rounded-2xl border border-white/[0.10] bg-black/82 p-3 shadow-[0_18px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl sm:w-[300px] sm:p-4">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-200/80">
              Cache da Title Page
            </p>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="grid h-6 w-6 place-items-center rounded-full border border-white/[0.10] bg-white/[0.04] text-xs text-white/65 transition hover:border-white/[0.20] hover:text-white"
              aria-label="Fechar"
            >
              ×
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[11px] leading-tight">
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40">
                Título
              </p>
              <p className="mt-1 truncate font-semibold text-white/82">
                {cacheInfo?.title?.source ?? "—"}
              </p>
              <p
                className={`mt-0.5 text-[10px] font-semibold ${statusTone(
                  cacheInfo?.title?.status
                )}`}
              >
                {cacheInfo?.title?.status ?? "—"}
              </p>
            </div>
            <div className="rounded-lg border border-white/[0.08] bg-white/[0.025] p-2">
              <p className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/40">
                Ratings
              </p>
              <p className="mt-1 truncate font-semibold text-white/82">
                {cacheInfo?.ratings?.source ?? "—"}
              </p>
              <p
                className={`mt-0.5 text-[10px] font-semibold ${statusTone(
                  cacheInfo?.ratings?.status
                )}`}
              >
                {cacheInfo?.ratings?.status ?? "—"}
              </p>
            </div>
          </div>

          <p className="text-[11px] text-white/45">
            Última sincronização: <span className="font-semibold text-white/82">{ago}</span>
          </p>

          <button
            type="button"
            onClick={triggerRefresh}
            disabled={isPending}
            aria-busy={isPending}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-full bg-white px-4 py-2 text-[12px] font-bold text-zinc-950 transition hover:bg-white/92 disabled:cursor-wait disabled:opacity-70"
          >
            {isPending ? (
              <>
                <span
                  className="h-3 w-3 animate-spin rounded-full border border-current border-t-transparent"
                  aria-hidden
                />
                Re-sincronizando…
              </>
            ) : (
              <>
                <span aria-hidden>↻</span>
                Forçar re-sync agora
              </>
            )}
          </button>

          <p className="text-[10px] leading-snug text-white/35">
            Ignora os TTLs (7d título, 30d ratings) e re-puxa TMDB + OMDb.
          </p>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="grid h-11 w-11 place-items-center rounded-full border border-white/[0.10] bg-black/72 text-white/72 shadow-[0_12px_40px_rgba(0,0,0,0.4)] backdrop-blur-xl transition hover:border-white/[0.22] hover:text-white"
          aria-label="Cache & re-sync"
          title="Cache & re-sync"
        >
          <span className="text-lg" aria-hidden>
            ↻
          </span>
        </button>
      )}
    </div>
  );
}
