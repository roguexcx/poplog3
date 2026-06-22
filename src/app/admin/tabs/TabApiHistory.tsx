"use client";

import { useCallback, useState } from "react";
import { Archive, RefreshCw, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { AdminCard, AdminFeedback } from "../_components";

// ─── Types ────────────────────────────────────────────────────────────────────

type ApiTotals = {
  totalCalls: number;
  cacheHits: number;
  errors: number;
  avgMs: number;
  hitRate: number;
};

type DayApis = Record<string, {
  calls: number;
  hits: number;
  errors: number;
  avgMs: number;
  hitRate: number;
}>;

type DayEntry = { day: string; apis: DayApis };

type HistoryData = {
  ok: boolean;
  window_days: number;
  generated_at: string;
  totals: Record<string, ApiTotals> | null;
  series: DayEntry[] | null;
};

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: HistoryData; days: number; fetchedAt: Date };

// ─── Constants ────────────────────────────────────────────────────────────────

const ALL_APIS = ["trakt", "tvdb", "balloonerismm", "tmdb", "omdb", "watchmode", "motn"] as const;
type ApiName = typeof ALL_APIS[number];

const API_COLORS: Record<ApiName, string> = {
  trakt:         "text-orange-300  bg-orange-500/10  border-orange-400/20",
  tvdb:          "text-sky-300     bg-sky-500/10     border-sky-400/20",
  balloonerismm: "text-violet-300  bg-violet-500/10  border-violet-400/20",
  tmdb:          "text-teal-300    bg-teal-500/10    border-teal-400/20",
  omdb:          "text-yellow-300  bg-yellow-500/10  border-yellow-400/20",
  watchmode:     "text-pink-300    bg-pink-500/10    border-pink-400/20",
  motn:          "text-emerald-300 bg-emerald-500/10 border-emerald-400/20",
};

const WINDOWS = [7, 14, 30, 60, 90] as const;

// ─── Sparkline (mini bar chart) ───────────────────────────────────────────────

function Sparkline({ values, color = "#818cf8" }: { values: number[]; color?: string }) {
  if (values.length === 0) return null;
  const max = Math.max(...values, 1);
  const w = 4;
  const gap = 2;
  const h = 28;
  const total = values.length * w + (values.length - 1) * gap;

  return (
    <svg width={total} height={h} className="shrink-0 opacity-80">
      {values.map((v, i) => {
        const barH = Math.max(2, Math.round((v / max) * h));
        return (
          <rect
            key={i}
            x={i * (w + gap)}
            y={h - barH}
            width={w}
            height={barH}
            rx={1}
            fill={color}
            opacity={v === 0 ? 0.2 : 0.9}
          />
        );
      })}
    </svg>
  );
}

// ─── Per-API summary card ─────────────────────────────────────────────────────

function ApiCard({
  name,
  totals,
  sparkValues,
}: {
  name: ApiName;
  totals: ApiTotals;
  sparkValues: number[];
}) {
  const colors = API_COLORS[name] ?? "text-zinc-300 bg-zinc-500/10 border-zinc-400/20";
  const hitRateGood = totals.hitRate >= 50;

  return (
    <div className={`rounded-xl border px-4 py-3 ${colors} flex flex-col gap-2`}>
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold uppercase tracking-widest">{name}</span>
        <span className="text-[10px] font-semibold opacity-60">{totals.totalCalls.toLocaleString()} chamadas</span>
      </div>

      <div className="flex items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5 text-[11px]">
            {hitRateGood
              ? <TrendingUp size={11} className="text-emerald-400" />
              : <TrendingDown size={11} className="text-red-400" />}
            <span className="font-semibold">{totals.hitRate}% cache hit</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] opacity-70">
            <Zap size={10} />
            <span>{totals.avgMs}ms avg</span>
          </div>
          {totals.errors > 0 && (
            <div className="text-[11px] text-red-400 font-semibold">
              {totals.errors} erros
            </div>
          )}
        </div>
        <Sparkline values={sparkValues} />
      </div>
    </div>
  );
}

// ─── Daily table ──────────────────────────────────────────────────────────────

function DailyTable({ series, activeApis }: { series: DayEntry[]; activeApis: ApiName[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead>
          <tr className="border-b border-white/10">
            <th className="pb-2 pr-4 text-left font-semibold text-zinc-400">Dia</th>
            {activeApis.map((api) => (
              <th key={api} className="pb-2 px-2 text-right font-semibold text-zinc-400 min-w-[70px]">
                {api}
              </th>
            ))}
            <th className="pb-2 pl-4 text-right font-semibold text-zinc-400">Total</th>
          </tr>
        </thead>
        <tbody>
          {series.map((row) => {
            const dayTotal = activeApis.reduce((sum, api) => sum + (row.apis[api]?.calls ?? 0), 0);
            if (dayTotal === 0) return null;
            return (
              <tr key={row.day} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                <td className="py-1.5 pr-4 text-zinc-400 font-mono">
                  {new Date(row.day + "T00:00:00Z").toLocaleDateString("pt-BR", {
                    day: "2-digit",
                    month: "short",
                    timeZone: "UTC",
                  })}
                </td>
                {activeApis.map((api) => {
                  const a = row.apis[api];
                  const calls = a?.calls ?? 0;
                  return (
                    <td key={api} className="py-1.5 px-2 text-right tabular-nums">
                      {calls > 0 ? (
                        <span className={calls > 50 ? "text-white font-semibold" : "text-zinc-300"}>
                          {calls}
                          {a && a.errors > 0 && (
                            <span className="ml-0.5 text-red-400 text-[10px]">⚠{a.errors}</span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-600">—</span>
                      )}
                    </td>
                  );
                })}
                <td className="py-1.5 pl-4 text-right font-semibold tabular-nums text-zinc-200">
                  {dayTotal.toLocaleString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function TabApiHistory({ secret }: { secret: string }) {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [days, setDays] = useState<number>(30);

  const load = useCallback(async (d: number) => {
    if (!secret.trim()) return;
    setView({ kind: "loading" });
    try {
      const res = await fetch(`/api/admin/api-history?days=${d}`, {
        cache: "no-store",
        headers: { "x-admin-secret": secret },
      });
      if (res.status === 401) { setView({ kind: "unauthorized" }); return; }
      if (!res.ok) { setView({ kind: "error", message: `HTTP ${res.status}` }); return; }
      const data = (await res.json()) as HistoryData;
      setView({ kind: "ok", data, days: d, fetchedAt: new Date() });
    } catch (err) {
      setView({ kind: "error", message: err instanceof Error ? err.message : "Erro" });
    }
  }, [secret]);

  const compact = async () => {
    if (!confirm("Compactar logs raw antigos (>90 dias) em agregados diarios?")) return;
    const res = await fetch("/api/admin/api-history", {
      method: "POST",
      headers: { "x-admin-secret": secret },
    });
    const json = await res.json();
    alert(json.ok ? `OK: ${JSON.stringify(json.detail)}` : `Erro: ${json.detail}`);
  };

  const isReady = secret.trim().length > 0;
  const data = view.kind === "ok" ? view.data : null;

  // APIs que tiveram pelo menos 1 chamada
  const activeApis = ALL_APIS.filter(
    (api) => (data?.totals?.[api]?.totalCalls ?? 0) > 0
  );

  // Sparkline: chamadas por dia para cada API (ordem cronologica)
  const sparkMap: Record<string, number[]> = {};
  if (data?.series) {
    const chronological = [...data.series].reverse();
    for (const api of ALL_APIS) {
      sparkMap[api] = chronological.map((d) => d.apis[api]?.calls ?? 0);
    }
  }

  return (
    <div className="space-y-6">

      {/* Controls */}
      <AdminCard title="Historico de APIs">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1">
            {WINDOWS.map((w) => (
              <button
                key={w}
                type="button"
                disabled={!isReady}
                onClick={() => { setDays(w); void load(w); }}
                className={[
                  "rounded-lg px-3 py-1.5 text-xs font-semibold transition border",
                  days === w && view.kind === "ok"
                    ? "border-indigo-400/30 bg-indigo-500/20 text-indigo-200"
                    : "border-white/10 bg-white/[0.04] text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.08]",
                  !isReady ? "opacity-40 cursor-not-allowed" : "",
                ].join(" ")}
              >
                {w}d
              </button>
            ))}
          </div>

          <button
            type="button"
            disabled={!isReady}
            onClick={() => void load(days)}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-indigo-400/20 bg-indigo-500/20 px-3 text-xs font-semibold text-indigo-100 transition hover:bg-indigo-500/30 disabled:opacity-40"
          >
            <RefreshCw size={12} />
            Carregar
          </button>

          <button
            type="button"
            disabled={!isReady}
            onClick={compact}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-zinc-600/40 bg-zinc-700/20 px-3 text-xs font-semibold text-zinc-300 transition hover:bg-zinc-700/30 disabled:opacity-40"
          >
            <Archive size={12} />
            Compactar logs antigos
          </button>

          {view.kind === "ok" && (
            <span className="text-[10px] text-zinc-500 ml-auto">
              {view.fetchedAt.toLocaleTimeString("pt-BR")}
            </span>
          )}
        </div>
      </AdminCard>

      {/* Feedback */}
      {view.kind === "loading" && (
        <AdminFeedback kind="loading" message="Carregando historico..." />
      )}
      {view.kind === "unauthorized" && (
        <AdminFeedback kind="error" message="Secret incorreto." />
      )}
      {view.kind === "error" && (
        <AdminFeedback kind="error" message={view.message} />
      )}
      {view.kind === "idle" && (
        <AdminFeedback kind="success" message="Selecione uma janela e clique em Carregar." />
      )}

      {/* API Summary Cards */}
      {view.kind === "ok" && activeApis.length > 0 && (
        <AdminCard title={`Totais — ultimos ${view.days} dias`}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7">
            {activeApis.map((api) => (
              <ApiCard
                key={api}
                name={api}
                totals={data!.totals![api]!}
                sparkValues={sparkMap[api] ?? []}
              />
            ))}
          </div>
        </AdminCard>
      )}

      {/* No data */}
      {view.kind === "ok" && activeApis.length === 0 && (
        <AdminFeedback kind="success" message={`Nenhuma chamada registrada nos ultimos ${view.days} dias.`} />
      )}

      {/* Daily breakdown table */}
      {view.kind === "ok" && data?.series && data.series.length > 0 && activeApis.length > 0 && (
        <AdminCard title="Detalhamento diario">
          <DailyTable
            series={data.series}
            activeApis={activeApis}
          />
        </AdminCard>
      )}

    </div>
  );
}
