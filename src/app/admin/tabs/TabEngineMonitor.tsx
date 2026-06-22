"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, CheckCircle2, Clock,
  RefreshCw, RotateCcw, TrendingUp, XCircle, Zap,
} from "lucide-react";
import { AdminCard, AdminFeedback, StatCard } from "../_components";

// ─── types ────────────────────────────────────────────────────────────────────

type ApiRow    = { api: string; calls: number; hits: number; misses: number; errors: number; hitRate: string; avgMs: number; p95Ms: number; maxMs: number };
type OriginRow = { origin: string; count: number };
type LogEntry  = { id: number; time: string; api: string; op: string; origin: string; mediaType?: string; tmdbId?: number; endpoint?: string; cache: string; ms: number; ok: boolean; status?: number; error?: string; fallbackFrom?: string };
type EngineData = { summary: { uptime: string; totalCalls: number; cacheHitRate: string; startedAt: string; window?: string; source?: string }; perApi: ApiRow[]; perOrigin: OriginRow[]; recentErrors: LogEntry[]; recentCalls: LogEntry[] };

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: EngineData; fullMode: boolean; fetchedAt: Date };

// ─── component ────────────────────────────────────────────────────────────────

export function TabEngineMonitor({ secret }: { secret: string }) {
  const [view, setView]         = useState<View>({ kind: "idle" });
  const [autoRefresh, setAuto]  = useState(false);
  const timerRef                = useRef<ReturnType<typeof setInterval> | null>(null);
  const isReady                 = secret.trim().length > 0;

  const load = useCallback(async (full = false) => {
    if (!secret.trim()) return;
    setView((prev) => prev.kind === "ok" ? { ...prev } : { kind: "loading" });
    try {
      const params = new URLSearchParams();
      if (full) params.set("full", "1");
      const res = await fetch(`/api/debug/engine?${params}`, {
        cache: "no-store",
        headers: { "x-admin-secret": secret },
      });
      if (res.status === 401) { setView({ kind: "unauthorized" }); return; }
      if (!res.ok)             { setView({ kind: "error", message: `HTTP ${res.status}` }); return; }
      const data = (await res.json()) as EngineData;
      setView({ kind: "ok", data, fullMode: full, fetchedAt: new Date() });
    } catch (err) {
      setView({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }, [secret]);

  const reset = async () => {
    if (!confirm("Zerar o buffer do engine logger?")) return;
    await fetch("/api/debug/engine", { method: "DELETE", headers: { "x-admin-secret": secret } });
    void load(view.kind === "ok" ? view.fullMode : false);
  };

  useEffect(() => {
    if (autoRefresh && view.kind === "ok") {
      timerRef.current = setInterval(() => void load(view.fullMode), 10_000);
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [autoRefresh, view, load]);

  const fullMode = view.kind === "ok" ? view.fullMode : false;

  return (
    <div className="space-y-6">

      {/* controls */}
      <AdminCard title="Controles">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!isReady}
            onClick={() => void load(fullMode)}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-500/20 px-4 text-sm font-semibold text-indigo-100 border border-indigo-400/20 transition hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Activity size={13} />
            {view.kind === "loading" ? "Carregando…" : "Carregar"}
          </button>

          {view.kind === "ok" && (
            <>
              <CtrlBtn onClick={() => void load(!fullMode)} icon={<TrendingUp size={13} />}>
                {fullMode ? "Modo reduzido" : "500 entradas"}
              </CtrlBtn>
              <CtrlBtn onClick={() => void load(fullMode)} icon={<RefreshCw size={13} />}>
                Atualizar
              </CtrlBtn>
              <CtrlBtn
                onClick={() => setAuto((v) => !v)}
                icon={<Zap size={13} />}
                active={autoRefresh}
              >
                {autoRefresh ? "Auto ON" : "Auto OFF"}
              </CtrlBtn>
              <CtrlBtn onClick={() => void reset()} icon={<RotateCcw size={13} />} tone="danger">
                Zerar buffer
              </CtrlBtn>
            </>
          )}
        </div>
      </AdminCard>

      {/* feedback */}
      {view.kind === "loading"      && <AdminFeedback kind="loading" message="Carregando engine…" />}
      {view.kind === "unauthorized" && <AdminFeedback kind="error"   message="Secret incorreto ou ADMIN_SECRET não configurado." />}
      {view.kind === "error"        && <AdminFeedback kind="error"   message={view.message} />}
      {view.kind === "idle"         && <p className="text-sm text-zinc-600">Digite o secret e clique em Carregar.</p>}

      {/* data */}
      {view.kind === "ok" && <EngineBody data={view.data} fetchedAt={view.fetchedAt} fullMode={view.fullMode} />}
    </div>
  );
}

// ─── dashboard ────────────────────────────────────────────────────────────────

function EngineBody({ data, fetchedAt, fullMode }: { data: EngineData; fetchedAt: Date; fullMode: boolean }) {
  const hitRate = parseInt(data.summary.cacheHitRate);
  return (
    <div className="space-y-6">
      {/* summary */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={data.summary.source === "persistent" ? "Janela" : "Uptime"} value={data.summary.source === "persistent" ? "24h" : data.summary.uptime} sub={`desde ${new Date(data.summary.startedAt).toLocaleTimeString("pt-BR")}`} icon={<Clock size={15} className="text-indigo-300" />} />
        <StatCard label="Chamadas"      value={String(data.summary.totalCalls)} sub={data.summary.window ?? "Sessão atual"} icon={<Activity size={15} className="text-indigo-300" />} />
        <StatCard label="Cache hit rate" value={data.summary.cacheHitRate}      sub="chamadas do cache"                 icon={<Zap size={15} className="text-emerald-300" />} tone={hitRate >= 70 ? "good" : hitRate >= 40 ? "neutral" : "bad"} />
        <StatCard label="Atualizado"    value={fetchedAt.toLocaleTimeString("pt-BR")} sub={fullMode ? "500 entradas" : "50 entradas"} icon={<RefreshCw size={15} className="text-zinc-400" />} />
      </div>

      {/* per-api */}
      <AdminCard title="APIs externas" desc={data.summary.source === "persistent" ? "Métricas persistidas das últimas 24h." : "Métricas acumuladas na sessão atual."}>
        <ApiTable rows={data.perApi} />
      </AdminCard>

      {/* per-origin */}
      <AdminCard title="Chamadas por origem">
        <OriginBars rows={data.perOrigin} total={data.summary.totalCalls} />
      </AdminCard>

      {/* errors */}
      {data.recentErrors.length > 0 && (
        <AdminCard title={`Erros recentes (${data.recentErrors.length})`} tone="danger" desc="Últimas falhas registradas.">
          <LogTable entries={data.recentErrors} />
        </AdminCard>
      )}

      {/* log */}
      <AdminCard title={`Log de chamadas (${data.recentCalls.length})`} desc="Mais recentes em ordem decrescente.">
        <LogTable entries={data.recentCalls} />
      </AdminCard>
    </div>
  );
}

// ─── api table ────────────────────────────────────────────────────────────────

function ApiTable({ rows }: { rows: ApiRow[] }) {
  if (!rows.length) return <p className="text-sm text-zinc-600">Nenhuma chamada ainda.</p>;
  return (
    <div className="overflow-auto rounded-lg border border-white/10">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-white/[0.04] text-zinc-500">
          <tr>{["API","Calls","Hits","Misses","Erros","Hit rate","Avg ms","P95 ms","Max ms"].map((c) => (
            <th key={c} className="px-4 py-2.5 font-bold uppercase tracking-[0.12em]">{c}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05] text-zinc-300">
          {rows.map((row) => (
            <tr key={row.api} className="hover:bg-white/[0.025]">
              <td className="px-4 py-2.5 font-black text-white">{row.api.toUpperCase()}</td>
              <td className="px-4 py-2.5">{row.calls}</td>
              <td className="px-4 py-2.5 text-emerald-300">{row.hits}</td>
              <td className="px-4 py-2.5">{row.misses}</td>
              <td className={`px-4 py-2.5 ${row.errors > 0 ? "text-rose-300" : "text-zinc-600"}`}>{row.errors}</td>
              <td className="px-4 py-2.5"><HitBadge rate={parseInt(row.hitRate)} /></td>
              <td className="px-4 py-2.5">{row.avgMs}ms</td>
              <td className="px-4 py-2.5">{row.p95Ms}ms</td>
              <td className={`px-4 py-2.5 ${row.maxMs > 5000 ? "text-amber-300" : ""}`}>{row.maxMs}ms</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HitBadge({ rate }: { rate: number }) {
  const cls = rate >= 70 ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
    : rate >= 40 ? "border-amber-300/20 bg-amber-400/10 text-amber-200"
    : "border-rose-300/20 bg-rose-400/10 text-rose-200";
  return <span className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-bold ${cls}`}>{rate}%</span>;
}

// ─── origin bars ──────────────────────────────────────────────────────────────

function OriginBars({ rows, total }: { rows: OriginRow[]; total: number }) {
  if (!rows.length) return <p className="text-sm text-zinc-600">Nenhum dado ainda.</p>;
  const max = rows[0]?.count ?? 1;
  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const pct = Math.round((row.count / Math.max(total, 1)) * 100);
        const bar = Math.round((row.count / max) * 100);
        return (
          <div key={row.origin} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs font-bold text-zinc-300">{row.origin}</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-white/[0.05]">
              <div className="h-full rounded bg-indigo-500/40 transition-all" style={{ width: `${bar}%` }} />
            </div>
            <span className="w-20 shrink-0 text-right text-xs text-zinc-400">{row.count} ({pct}%)</span>
          </div>
        );
      })}
    </div>
  );
}

// ─── log table ────────────────────────────────────────────────────────────────

function LogTable({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) return <p className="text-sm text-zinc-600">Nenhuma entrada.</p>;
  return (
    <div className="overflow-auto rounded-lg border border-white/10">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-white/[0.04] text-zinc-500">
          <tr>{["#","Hora","API","Op","Origem","Cache","ms","OK","Endpoint","Erro"].map((c) => (
            <th key={c} className="px-3 py-2.5 font-bold uppercase tracking-[0.12em]">{c}</th>
          ))}</tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04] text-zinc-300">
          {entries.map((e) => (
            <tr key={e.id} className={`hover:bg-white/[0.025] ${!e.ok ? "bg-rose-500/[0.04]" : ""}`}>
              <td className="px-3 py-2 text-zinc-600">{e.id}</td>
              <td className="px-3 py-2 text-zinc-500">{new Date(e.time).toLocaleTimeString("pt-BR")}</td>
              <td className="px-3 py-2 font-black text-white">{e.api.toUpperCase()}</td>
              <td className="px-3 py-2 text-zinc-400">{e.op}</td>
              <td className="px-3 py-2">{e.origin}</td>
              <td className="px-3 py-2"><CacheBadge status={e.cache} /></td>
              <td className={`px-3 py-2 ${e.ms > 2000 ? "text-amber-300" : ""}`}>{e.ms}</td>
              <td className="px-3 py-2">
                {e.ok ? <CheckCircle2 size={13} className="text-emerald-400" /> : <XCircle size={13} className="text-rose-400" />}
              </td>
              <td className="max-w-[18rem] truncate px-3 py-2 text-zinc-500">{e.endpoint ?? "—"}</td>
              <td className="max-w-[20rem] px-3 py-2 text-rose-300">
                {e.error ? <span title={e.error}>{e.error.slice(0, 80)}{e.error.length > 80 ? "…" : ""}</span> : <span className="text-zinc-700">—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CacheBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    hit:     "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
    miss:    "border-amber-300/20  bg-amber-400/10  text-amber-200",
    stale:   "border-zinc-300/20   bg-zinc-400/10   text-zinc-300",
    failed:  "border-rose-300/20   bg-rose-400/10   text-rose-200",
    skipped: "border-zinc-300/20   bg-zinc-400/10   text-zinc-500",
  };
  return (
    <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold ${map[status] ?? "border-white/10 text-zinc-500"}`}>
      {status}
    </span>
  );
}

// ─── ctrl button ──────────────────────────────────────────────────────────────

function CtrlBtn({ children, onClick, icon, active, tone }: {
  children: React.ReactNode;
  onClick: () => void;
  icon?: React.ReactNode;
  active?: boolean;
  tone?: "danger";
}) {
  const cls = tone === "danger"
    ? "border-rose-400/20 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
    : active
      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
      : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.07]";
  return (
    <button type="button" onClick={onClick} className={`inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition ${cls}`}>
      {icon}{children}
    </button>
  );
}
