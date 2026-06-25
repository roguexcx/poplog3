"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useCallback, useState } from "react";
import { AlertTriangle, CheckCircle2, Clock, RefreshCw, Trash2, Zap } from "lucide-react";
// ─── types ────────────────────────────────────────────────────────────────────
type CacheStatus = {
    ok: boolean;
    status: "empty" | "present";
    cachedAt: string | null;
    ageHours: number | null;
    cacheVersion: number | null;
};
type FlushResult = {
    ok: boolean;
    flushed: boolean;
    rebuildTriggered: boolean;
    message: string;
    error?: string;
};
type ViewState = {
    kind: "idle";
} | {
    kind: "loading";
} | {
    kind: "unauthorized";
} | {
    kind: "error";
    message: string;
} | {
    kind: "status";
    data: CacheStatus;
    fetchedAt: Date;
} | {
    kind: "flushed";
    result: FlushResult;
    fetchedAt: Date;
};
// ─── helpers ──────────────────────────────────────────────────────────────────
function ageLabel(hours: number | null): string {
    if (hours === null)
        return "—";
    if (hours < 1)
        return uiMessage("ui.b44dacb6467a", { v1: Math.round(hours * 60) });
    if (hours < 24)
        return uiMessage("ui.04618adf1c1f", { v1: hours.toFixed(1) });
    return uiMessage("ui.a3dd68e1f3ff", { v1: (hours / 24).toFixed(1) });
}
function ageBadge(hours: number | null): "fresh" | "aging" | "stale" {
    if (hours === null)
        return "stale";
    if (hours < 6)
        return "fresh";
    if (hours < 24)
        return "aging";
    return "stale";
}
const BADGE_COLORS = {
    fresh: "bg-emerald-500/15 text-emerald-300 border-emerald-400/20",
    aging: "bg-amber-500/15 text-amber-300 border-amber-400/20",
    stale: "bg-red-500/15 text-red-300 border-red-400/20",
} as const;
const BADGE_LABELS = {
    fresh: "Fresco",
    aging: "Envelhecendo",
    stale: "Expirado",
} as const;
// ─── component ────────────────────────────────────────────────────────────────
export default function RadarCacheClient() {
    const [secret, setSecret] = useState("");
    const [view, setView] = useState<ViewState>({ kind: "idle" });
    const headers = useCallback(() => ({ "x-admin-secret": secret }), [secret]);
    const checkStatus = useCallback(async () => {
        if (!secret.trim())
            return;
        setView({ kind: "loading" });
        try {
            const res = await fetch("/api/admin/radar-cache-flush", {
                headers: headers(),
                cache: "no-store",
            });
            if (res.status === 401) {
                setView({ kind: "unauthorized" });
                return;
            }
            if (!res.ok) {
                setView({ kind: "error", message: uiMessage("ui.e69ff1624558", { v1: res.status }) });
                return;
            }
            const data = (await res.json()) as CacheStatus;
            setView({ kind: "status", data, fetchedAt: new Date() });
        }
        catch (err) {
            setView({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
        }
    }, [secret, headers]);
    const flush = useCallback(async (rebuild: boolean) => {
        if (!secret.trim())
            return;
        const action = rebuild ? "Invalidar cache e disparar rebuild em background?" : uiMessage("ui.5db14b73479d");
        if (!confirm(action))
            return;
        setView({ kind: "loading" });
        try {
            const params = rebuild ? "?rebuild=true" : "?rebuild=false";
            const res = await fetch(`/api/admin/radar-cache-flush${params}`, {
                method: "POST",
                headers: headers(),
            });
            if (res.status === 401) {
                setView({ kind: "unauthorized" });
                return;
            }
            if (!res.ok) {
                setView({ kind: "error", message: uiMessage("ui.e69ff1624558", { v1: res.status }) });
                return;
            }
            const result = (await res.json()) as FlushResult;
            setView({ kind: "flushed", result, fetchedAt: new Date() });
        }
        catch (err) {
            setView({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
        }
    }, [secret, headers]);
    const isReady = secret.trim().length > 0;
    return (<div className="min-h-screen px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-2xl">

        {/* header */}
        <header className="border-b border-white/10 pb-7">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-indigo-300/80">{uiMessage("ui.1b3b488148c5")}</p>
          <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">{uiMessage("ui.1fee98d4e7eb")}</h1>
          <p className="mt-3 text-sm leading-6 text-zinc-400">{uiMessage("ui.39e59932407d")}</p>
        </header>

        {/* auth input */}
        <section className="mt-8">
          <label className="block text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-2">{uiMessage("ui.3cefe204cebd")}</label>
          <div className="flex gap-3 flex-wrap">
            <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void checkStatus()} className="h-10 w-full max-w-xs rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-400/40 focus:ring-1 focus:ring-indigo-400/20"/>
            <button type="button" disabled={!isReady || view.kind === "loading"} onClick={() => void checkStatus()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-500/20 px-4 text-sm font-bold text-indigo-100 border border-indigo-400/20 transition hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed">
              <Clock size={14}/>{uiMessage("ui.087c3ef11c45")}</button>
          </div>
        </section>

        {/* status feedback */}
        <section className="mt-8 space-y-4">

          {view.kind === "loading" && (<div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-4 text-sm text-zinc-400">
              <RefreshCw size={15} className="animate-spin"/>{uiMessage("ui.6c7f6bb7b10f")}</div>)}

          {view.kind === "unauthorized" && (<div className="flex items-center gap-3 rounded-xl border border-red-400/20 bg-red-500/10 px-5 py-4 text-sm text-red-300">
              <AlertTriangle size={15}/>{uiMessage("ui.2730414d794d")}</div>)}

          {view.kind === "error" && (<div className="flex items-center gap-3 rounded-xl border border-red-400/20 bg-red-500/10 px-5 py-4 text-sm text-red-300">
              <AlertTriangle size={15}/>
              {view.message}
            </div>)}

          {view.kind === "status" && (<div className="rounded-xl border border-white/10 bg-white/[0.04] divide-y divide-white/[0.06]">
              {/* cache info rows */}
              {view.data.status === "empty" ? (<div className="px-5 py-4 text-sm text-zinc-400 flex items-center gap-2">
                  <AlertTriangle size={14} className="text-amber-400"/>{uiMessage("ui.98a879200d6a")}</div>) : (<>
                  <Row label="Status">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${BADGE_COLORS[ageBadge(view.data.ageHours)]}`}>
                      {BADGE_LABELS[ageBadge(view.data.ageHours)]}
                    </span>
                  </Row>
                  <Row label="Idade">{ageLabel(view.data.ageHours)}</Row>
                  <Row label={uiMessage("ui.686fabb09449")}>
                    {view.data.cachedAt
                    ? new Date(view.data.cachedAt).toLocaleString("pt-BR")
                    : "—"}
                  </Row>
                  <Row label={uiMessage("ui.c4ff704a8c10")}>
                    v{view.data.cacheVersion ?? "?"}
                  </Row>
                </>)}
              <div className="px-5 py-2.5 text-[11px] text-zinc-600">{uiMessage("ui.1909f7b2e8d9")}{view.fetchedAt.toLocaleTimeString("pt-BR")}
              </div>
            </div>)}

          {view.kind === "flushed" && (<div className={`rounded-xl border px-5 py-4 text-sm flex items-start gap-3 ${view.result.ok ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-300" : "border-red-400/20 bg-red-500/10 text-red-300"}`}>
              {view.result.ok
                ? <CheckCircle2 size={16} className="mt-0.5 shrink-0"/>
                : <AlertTriangle size={16} className="mt-0.5 shrink-0"/>}
              <div>
                <p className="font-semibold">{view.result.ok ? "Cache invalidado" : "Erro"}</p>
                <p className="mt-0.5 text-xs opacity-80">{view.result.message ?? view.result.error}</p>
                {view.result.rebuildTriggered && (<p className="mt-1 text-xs opacity-60">{uiMessage("ui.688f512a1784")}</p>)}
              </div>
            </div>)}

        </section>

        {/* action buttons */}
        {isReady && (<section className="mt-8 space-y-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-4">{uiMessage("ui.66c341b3e963")}</p>
            <button type="button" disabled={view.kind === "loading"} onClick={() => void flush(true)} className="w-full inline-flex items-center gap-3 rounded-xl border border-indigo-400/20 bg-indigo-500/15 px-5 py-4 text-left text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/25 disabled:opacity-40 disabled:cursor-not-allowed">
              <Zap size={16} className="shrink-0 text-indigo-300"/>
              <span>{uiMessage("ui.d5745b35e1bf")}<span className="block text-xs font-normal text-indigo-300/70 mt-0.5">{uiMessage("ui.21b2319d3099")}</span>
              </span>
            </button>
            <button type="button" disabled={view.kind === "loading"} onClick={() => void flush(false)} className="w-full inline-flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-5 py-4 text-left text-sm font-semibold text-zinc-300 transition hover:bg-white/[0.07] disabled:opacity-40 disabled:cursor-not-allowed">
              <Trash2 size={16} className="shrink-0 text-zinc-400"/>
              <span>{uiMessage("ui.d337cd963547")}<span className="block text-xs font-normal text-zinc-500 mt-0.5">{uiMessage("ui.4242453a7bb0")}</span>
              </span>
            </button>
          </section>)}

      </div>
    </div>);
}
// ─── Row helper ───────────────────────────────────────────────────────────────
function Row({ label, children }: {
    label: string;
    children: React.ReactNode;
}) {
    return (<div className="flex items-center justify-between px-5 py-3 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="text-zinc-200 font-medium">{children}</span>
    </div>);
}

