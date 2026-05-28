"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  RefreshCw,
  RotateCcw,
  TrendingUp,
  XCircle,
  Zap,
} from "lucide-react";

// ─── types ────────────────────────────────────────────────────────────────────

type ApiRow = {
  api: string;
  calls: number;
  hits: number;
  misses: number;
  errors: number;
  hitRate: string;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
};

type OriginRow = {
  origin: string;
  count: number;
};

type LogEntry = {
  id: number;
  time: string;
  api: string;
  op: string;
  origin: string;
  mediaType?: string;
  tmdbId?: number;
  endpoint?: string;
  cache: string;
  ms: number;
  ok: boolean;
  status?: number;
  error?: string;
  fallbackFrom?: string;
};

type EngineData = {
  summary: {
    uptime: string;
    totalCalls: number;
    cacheHitRate: string;
    startedAt: string;
    window?: string;
    source?: string;
  };
  perApi: ApiRow[];
  perOrigin: OriginRow[];
  recentErrors: LogEntry[];
  recentCalls: LogEntry[];
};

type ViewState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: EngineData; fullMode: boolean; fetchedAt: Date };

// ─── component ────────────────────────────────────────────────────────────────

export default function EngineMonitorClient() {
  const [secret, setSecret] = useState("");
  const [view, setView] = useState<ViewState>({ kind: "idle" });
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(
    async (full = false, currentSecret = secret) => {
      if (!currentSecret.trim()) return;
      setView((prev) =>
        prev.kind === "ok"
          ? { ...prev }
          : { kind: "loading" },
      );

      try {
        const params = new URLSearchParams({ secret: currentSecret });
        if (full) params.set("full", "1");
        const res = await fetch(`/api/debug/engine?${params}`, {
          cache: "no-store",
        });

        if (res.status === 401) {
          setView({ kind: "unauthorized" });
          return;
        }

        if (!res.ok) {
          setView({ kind: "error", message: `HTTP ${res.status}` });
          return;
        }

        const data = (await res.json()) as EngineData;
        setView({ kind: "ok", data, fullMode: full, fetchedAt: new Date() });
      } catch (err) {
        setView({
          kind: "error",
          message: err instanceof Error ? err.message : "Erro desconhecido",
        });
      }
    },
    [secret],
  );

  const handleReset = async () => {
    if (!secret.trim()) return;
    const confirmed = confirm("Zerar o buffer do engine logger?");
    if (!confirmed) return;
    await fetch("/api/debug/engine", {
      method: "DELETE",
      headers: { "x-admin-secret": secret },
    });
    void fetchData(false);
  };

  // auto-refresh every 10s
  useEffect(() => {
    if (autoRefresh && view.kind === "ok") {
      intervalRef.current = setInterval(() => void fetchData(view.fullMode), 10_000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, view, fetchData]);

  return (
    <div className="min-h-screen px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        {/* header */}
        <header className="border-b border-white/10 pb-7">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-indigo-300/80">
            POPLOG ADMIN
          </p>
          <h1 className="mt-3 text-3xl font-black text-white sm:text-5xl">
            Engine Monitor
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-zinc-400">
            Monitoramento em tempo real das chamadas às APIs externas — TMDB,
            OMDb, Watchmode e MovieOfTheNight. Cache hit rate, latências e log
            de erros.
          </p>

          {/* secret input */}
          <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <input
              type="password"
              placeholder="ADMIN_SECRET"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void fetchData()}
              className="h-10 w-full max-w-xs rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-400/40 focus:ring-1 focus:ring-indigo-400/20 sm:w-64"
            />
            <button
              type="button"
              onClick={() => void fetchData()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-500/20 px-4 text-sm font-bold text-indigo-100 transition hover:bg-indigo-500/30 border border-indigo-400/20"
            >
              <Activity size={15} />
              Carregar
            </button>
            {view.kind === "ok" && (
              <>
                <button
                  type="button"
                  onClick={() => void fetchData(!view.fullMode)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-bold text-zinc-300 transition hover:bg-white/[0.07]"
                >
                  <TrendingUp size={15} />
                  {view.fullMode ? "Modo reduzido" : "500 entradas"}
                </button>
                <button
                  type="button"
                  onClick={() => void fetchData(view.fullMode)}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-4 text-sm font-bold text-zinc-300 transition hover:bg-white/[0.07]"
                >
                  <RefreshCw size={15} />
                  Atualizar
                </button>
                <button
                  type="button"
                  onClick={() => setAutoRefresh((v) => !v)}
                  className={`inline-flex h-10 items-center gap-2 rounded-lg border px-4 text-sm font-bold transition ${
                    autoRefresh
                      ? "border-emerald-400/30 bg-emerald-500/10 text-emerald-200"
                      : "border-white/10 bg-white/[0.04] text-zinc-300 hover:bg-white/[0.07]"
                  }`}
                >
                  <Zap size={15} />
                  {autoRefresh ? "Auto ON" : "Auto OFF"}
                </button>
                <button
                  type="button"
                  onClick={() => void handleReset()}
                  className="inline-flex h-10 items-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-4 text-sm font-bold text-rose-200 transition hover:bg-rose-500/20"
                >
                  <RotateCcw size={15} />
                  Zerar
                </button>
              </>
            )}
          </div>
        </header>

        {/* body */}
        <div className="mt-8">
          {view.kind === "idle" && (
            <p className="text-sm text-zinc-500">
              Digite o ADMIN_SECRET e clique em Carregar.
            </p>
          )}
          {view.kind === "loading" && (
            <p className="text-sm text-zinc-400">Carregando dados do engine...</p>
          )}
          {view.kind === "unauthorized" && (
            <p className="text-sm text-rose-300">
              Secret incorreto ou ADMIN_SECRET não configurado no .env.local.
            </p>
          )}
          {view.kind === "error" && (
            <p className="text-sm text-rose-300">Erro: {view.message}</p>
          )}
          {view.kind === "ok" && (
            <Dashboard
              data={view.data}
              fetchedAt={view.fetchedAt}
              fullMode={view.fullMode}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── dashboard ────────────────────────────────────────────────────────────────

function Dashboard({
  data,
  fetchedAt,
  fullMode,
}: {
  data: EngineData;
  fetchedAt: Date;
  fullMode: boolean;
}) {
  return (
    <div className="space-y-8">
      {/* summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          label="Uptime"
          value={data.summary.source === "persistent" ? "24h" : data.summary.uptime}
          sub={`desde ${new Date(data.summary.startedAt).toLocaleTimeString("pt-BR")}`}
          icon={<Clock size={16} className="text-indigo-300" />}
        />
        <SummaryCard
          label="Total de chamadas"
          value={String(data.summary.totalCalls)}
          sub={data.summary.window ?? "Sessão atual"}
          icon={<Activity size={16} className="text-indigo-300" />}
        />
        <SummaryCard
          label="Cache hit rate"
          value={data.summary.cacheHitRate}
          sub="chamadas servidas do cache"
          icon={<Zap size={16} className="text-emerald-300" />}
          tone={
            parseInt(data.summary.cacheHitRate) >= 70
              ? "good"
              : parseInt(data.summary.cacheHitRate) >= 40
                ? "neutral"
                : "bad"
          }
        />
        <SummaryCard
          label="Atualizado"
          value={fetchedAt.toLocaleTimeString("pt-BR")}
          sub={fullMode ? "500 entradas" : "50 entradas"}
          icon={<RefreshCw size={16} className="text-zinc-400" />}
        />
      </div>

      {/* per-api table */}
      <Section title="APIs externas" description={data.summary.source === "persistent" ? "Métricas persistidas das últimas 24h." : "Métricas acumuladas na sessão atual."}>
        <ApiTable rows={data.perApi} />
      </Section>

      {/* per-origin */}
      <Section title="Chamadas por origem" description="De onde partem as requisições às APIs externas.">
        <OriginBars rows={data.perOrigin} total={data.summary.totalCalls} />
      </Section>

      {/* recent errors */}
      {data.recentErrors.length > 0 && (
        <Section
          title={`Erros recentes (${data.recentErrors.length})`}
          tone="bad"
          description="Últimas falhas registradas pelo engine logger."
        >
          <LogTable entries={data.recentErrors} />
        </Section>
      )}

      {/* recent calls */}
      <Section
        title={`Log de chamadas (${data.recentCalls.length})`}
        description="Chamadas mais recentes em ordem decrescente."
      >
        <LogTable entries={data.recentCalls} />
      </Section>
    </div>
  );
}

// ─── api table ────────────────────────────────────────────────────────────────

function ApiTable({ rows }: { rows: ApiRow[] }) {
  if (!rows.length) {
    return <p className="text-sm text-zinc-500">Nenhuma chamada registrada ainda.</p>;
  }

  return (
    <div className="overflow-auto rounded-lg border border-white/10">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-white/[0.04] text-zinc-500">
          <tr>
            {["API", "Calls", "Hits", "Misses", "Erros", "Hit rate", "Avg ms", "P95 ms", "Max ms"].map(
              (col) => (
                <th
                  key={col}
                  className="px-4 py-2.5 font-bold uppercase tracking-[0.14em]"
                >
                  {col}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/5 text-zinc-300">
          {rows.map((row) => (
            <tr key={row.api} className="hover:bg-white/[0.025]">
              <td className="px-4 py-2.5 font-black text-white">{row.api.toUpperCase()}</td>
              <td className="px-4 py-2.5">{row.calls}</td>
              <td className="px-4 py-2.5 text-emerald-300">{row.hits}</td>
              <td className="px-4 py-2.5">{row.misses}</td>
              <td className={`px-4 py-2.5 ${row.errors > 0 ? "text-rose-300" : "text-zinc-500"}`}>
                {row.errors}
              </td>
              <td className="px-4 py-2.5">
                <HitRateBadge rate={parseInt(row.hitRate)} />
              </td>
              <td className="px-4 py-2.5">{row.avgMs}ms</td>
              <td className="px-4 py-2.5">{row.p95Ms}ms</td>
              <td className={`px-4 py-2.5 ${row.maxMs > 5000 ? "text-amber-300" : ""}`}>
                {row.maxMs}ms
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HitRateBadge({ rate }: { rate: number }) {
  const tone =
    rate >= 70
      ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
      : rate >= 40
        ? "border-amber-300/20 bg-amber-400/10 text-amber-200"
        : "border-rose-300/20 bg-rose-400/10 text-rose-200";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold ${tone}`}>
      {rate}%
    </span>
  );
}

// ─── origin bars ──────────────────────────────────────────────────────────────

function OriginBars({ rows, total }: { rows: OriginRow[]; total: number }) {
  if (!rows.length) {
    return <p className="text-sm text-zinc-500">Nenhum dado de origem ainda.</p>;
  }
  const max = rows[0]?.count ?? 1;

  return (
    <div className="space-y-2">
      {rows.map((row) => {
        const pct = Math.round((row.count / Math.max(total, 1)) * 100);
        const barW = Math.round((row.count / max) * 100);
        return (
          <div key={row.origin} className="flex items-center gap-3">
            <span className="w-28 shrink-0 text-xs font-bold text-zinc-300">{row.origin}</span>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-white/[0.05]">
              <div
                className="h-full rounded bg-indigo-500/40 transition-all"
                style={{ width: `${barW}%` }}
              />
            </div>
            <span className="w-20 shrink-0 text-right text-xs text-zinc-400">
              {row.count} ({pct}%)
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── log table ────────────────────────────────────────────────────────────────

function LogTable({ entries }: { entries: LogEntry[] }) {
  if (!entries.length) {
    return <p className="text-sm text-zinc-500">Nenhuma entrada.</p>;
  }

  return (
    <div className="overflow-auto rounded-lg border border-white/10">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-white/[0.04] text-zinc-500">
          <tr>
            {["#", "Hora", "API", "Op", "Origem", "Cache", "ms", "Status", "Endpoint", "Erro"].map(
              (col) => (
                <th key={col} className="px-3 py-2.5 font-bold uppercase tracking-[0.12em]">
                  {col}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.04] text-zinc-300">
          {entries.map((e) => (
            <tr
              key={e.id}
              className={`hover:bg-white/[0.025] ${!e.ok ? "bg-rose-500/[0.04]" : ""}`}
            >
              <td className="px-3 py-2 text-zinc-600">{e.id}</td>
              <td className="px-3 py-2 text-zinc-500">
                {new Date(e.time).toLocaleTimeString("pt-BR")}
              </td>
              <td className="px-3 py-2 font-bold text-white">{e.api.toUpperCase()}</td>
              <td className="px-3 py-2 text-zinc-400">{e.op}</td>
              <td className="px-3 py-2">{e.origin}</td>
              <td className="px-3 py-2">
                <CacheBadge status={e.cache} />
              </td>
              <td className={`px-3 py-2 ${e.ms > 2000 ? "text-amber-300" : ""}`}>{e.ms}</td>
              <td className="px-3 py-2">
                {e.ok ? (
                  <CheckCircle2 size={13} className="text-emerald-400" />
                ) : (
                  <XCircle size={13} className="text-rose-400" />
                )}
              </td>
              <td className="max-w-[18rem] truncate px-3 py-2 text-zinc-500">{e.endpoint ?? "—"}</td>
              <td className="max-w-[20rem] px-3 py-2 text-rose-300">
                {e.error ? (
                  <span title={e.error}>{e.error.slice(0, 80)}{e.error.length > 80 ? "…" : ""}</span>
                ) : (
                  <span className="text-zinc-700">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CacheBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    hit: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200",
    miss: "border-amber-300/20 bg-amber-400/10 text-amber-200",
    stale: "border-zinc-300/20 bg-zinc-400/10 text-zinc-300",
    failed: "border-rose-300/20 bg-rose-400/10 text-rose-200",
    skipped: "border-zinc-300/20 bg-zinc-400/10 text-zinc-500",
    none: "border-zinc-700 bg-transparent text-zinc-600",
  };
  const cls = styles[status] ?? "border-white/10 bg-white/[0.04] text-zinc-400";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-bold ${cls}`}>
      {status}
    </span>
  );
}

// ─── primitives ───────────────────────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  sub,
  icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
  tone?: "neutral" | "good" | "bad";
}) {
  const valueClass =
    tone === "good"
      ? "text-emerald-300"
      : tone === "bad"
        ? "text-rose-300"
        : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">{label}</p>
        {icon}
      </div>
      <p className={`mt-2 text-2xl font-black ${valueClass}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-600">{sub}</p>
    </div>
  );
}

function Section({
  title,
  description,
  children,
  tone = "neutral",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  tone?: "neutral" | "bad";
}) {
  const borderClass =
    tone === "bad" ? "border-rose-300/20" : "border-white/10";
  const titleClass =
    tone === "bad" ? "text-rose-200" : "text-white";

  return (
    <section className={`rounded-lg border ${borderClass} bg-white/[0.025] p-5`}>
      <div className="mb-4 flex items-center gap-2">
        {tone === "bad" && <AlertTriangle size={16} className="text-rose-300 shrink-0" />}
        <div>
          <h2 className={`text-lg font-black ${titleClass}`}>{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
          )}
        </div>
      </div>
      {children}
    </section>
  );
}
