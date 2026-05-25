"use client";

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";
import { AdminCard, StatCard } from "../_components";

// ─── types ────────────────────────────────────────────────────────────────────

type DebugCard    = { title: string; subtitle?: string; meta?: string[]; badges?: string[]; image?: string | null };
type DebugTable   = { title: string; columns: string[]; rows: string[][] };
type DebugSection = { title: string; description?: string; cards?: DebugCard[]; tables?: DebugTable[]; bullets?: string[] };
type DebugEndpointResult = { label: string; url: string; ok: boolean; status: number; elapsedMs: number; data: unknown; error?: string };

type ApiDebugResponse = {
  api: string; configured: boolean; ok: boolean; elapsedMs: number; callCount: number;
  summary: { description: string; bestFor: string[]; dataTypes: string[]; impression: string };
  capabilities: string[]; sections: DebugSection[]; observations: string[];
  endpoints: DebugEndpointResult[];
};

type ApiState = { id: string; label: string; path: string; data?: ApiDebugResponse; loading: boolean; error?: string };

const APIS: Omit<ApiState, "loading">[] = [
  { id: "tmdb",           label: "TMDB",           path: "/api/debug/tmdb"           },
  { id: "watchmode",      label: "Watchmode",       path: "/api/debug/watchmode"      },
  { id: "movieofthenight",label: "MovieOfTheNight", path: "/api/debug/movieofthenight"},
  { id: "omdb",           label: "OMDb",            path: "/api/debug/omdb"           },
];

// ─── component ────────────────────────────────────────────────────────────────

export function TabApisLab() {
  const [apis, setApis]     = useState<ApiState[]>(APIS.map((a) => ({ ...a, loading: true })));
  const [lastRun, setLastRun] = useState<Date | null>(null);

  async function loadAll(reset = true) {
    if (reset) setApis(APIS.map((a) => ({ ...a, loading: true })));
    const results = await Promise.all(APIS.map(async (api) => {
      try {
        const res  = await fetch(api.path, { cache: "no-store" });
        const data = (await res.json()) as ApiDebugResponse;
        return { ...api, data, loading: false };
      } catch (err) {
        return { ...api, loading: false, error: err instanceof Error ? err.message : "Erro" };
      }
    }));
    setApis(results);
    setLastRun(new Date());
  }

  useEffect(() => { void loadAll(false); }, []);

  const m = useMemo(() => {
    const done    = apis.filter((a) => !a.loading);
    const working = done.filter((a) => a.data?.ok).length;
    const errors  = done.filter((a) => a.error || a.data?.ok === false).length;
    const calls   = apis.reduce((s, a) => s + (a.data?.callCount ?? 0), 0);
    const elapsed = Math.max(...apis.map((a) => a.data?.elapsedMs ?? 0), 0);
    return { working, errors, calls, elapsed };
  }, [apis]);

  return (
    <div className="space-y-6">
      {/* summary + reload */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 flex-1">
          <StatCard label="Configuradas"  value={`${APIS.length}`}    sub="nesta etapa"              />
          <StatCard label="Funcionando"   value={`${m.working}`}      sub="com resposta OK"          tone="good" />
          <StatCard label="Com erro"      value={`${m.errors}`}       sub="falha ou chave ausente"   tone={m.errors ? "bad" : "good"} />
          <StatCard label="Tempo"         value={`${m.elapsed}ms`}    sub={lastRun?.toLocaleTimeString("pt-BR") ?? "rodando"} />
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-indigo-400/20 bg-indigo-500/15 px-4 text-sm font-semibold text-indigo-100 transition hover:bg-indigo-500/25 shrink-0"
        >
          <RefreshCw size={13} />
          Recarregar
        </button>
      </div>

      {/* status cards row */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {apis.map((api) => <ApiStatusCard key={api.id} api={api} />)}
      </div>

      {/* detail blocks */}
      <div className="space-y-5">
        {apis.map((api) => <ApiBlock key={api.id} api={api} />)}
      </div>
    </div>
  );
}

// ─── cards / blocks ───────────────────────────────────────────────────────────

function ApiStatusCard({ api }: { api: ApiState }) {
  const ok   = api.data?.ok;
  const Icon = api.loading ? Clock : ok ? CheckCircle2 : XCircle;
  const tone = api.loading ? "border-amber-300/20" : ok ? "border-emerald-300/20" : "border-rose-300/20";
  return (
    <div className={`rounded-lg border bg-white/[0.03] p-4 ${tone}`}>
      <div className="flex items-center justify-between">
        <h3 className="font-black text-white">{api.label}</h3>
        <Icon size={16} className={api.loading ? "text-amber-300" : ok ? "text-emerald-300" : "text-rose-300"} />
      </div>
      <p className="mt-2 text-xs leading-5 text-zinc-400 line-clamp-3">
        {api.loading ? "Explorando…" : api.data?.summary.impression ?? api.error ?? "Sem resposta."}
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] font-semibold">
        <Pill>{api.data?.callCount ?? 0} calls</Pill>
        <Pill>{api.data?.elapsedMs ?? 0}ms</Pill>
        <Pill>{api.data?.configured === false ? "sem chave" : "configurada"}</Pill>
      </div>
    </div>
  );
}

function ApiBlock({ api }: { api: ApiState }) {
  if (api.loading) {
    return (
      <AdminCard title={api.label}>
        <p className="text-sm text-zinc-500">Carregando amostra técnica…</p>
      </AdminCard>
    );
  }
  if (!api.data) {
    return (
      <AdminCard title={api.label} tone="danger">
        <p className="text-sm text-rose-300">{api.error ?? "Falha ao carregar."}</p>
      </AdminCard>
    );
  }
  const d = api.data;
  return (
    <AdminCard
      title={d.api}
      desc={d.summary.description}
      extra={
        <div className="flex flex-wrap gap-2 mt-2">
          <Pill tone={d.ok ? "good" : "bad"}>{d.ok ? "respondendo" : "erro"}</Pill>
          <Pill>{d.callCount} chamadas</Pill>
          <Pill>{d.elapsedMs}ms</Pill>
        </div>
      }
    >
      <p className="mb-4 text-sm text-zinc-300">{d.summary.impression}</p>
      <div className="mb-5 grid gap-3 lg:grid-cols-3">
        <InfoPanel title="Faz melhor"           items={d.summary.bestFor}   />
        <InfoPanel title="Dados disponíveis"    items={d.summary.dataTypes} />
        <InfoPanel title="Capacidades"          items={d.capabilities}      />
      </div>
      <div className="space-y-4">
        {d.sections.map((s) => <SectionView key={s.title} section={s} />)}
      </div>
      <details className="mt-5 rounded-lg border border-white/10 bg-black/20 p-3">
        <summary className="cursor-pointer text-sm font-bold text-zinc-300">Raw JSON · endpoints</summary>
        <div className="mt-3 space-y-3">
          {d.endpoints.map((ep) => (
            <details key={`${ep.label}-${ep.url}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <summary className="cursor-pointer text-xs font-bold text-zinc-300">
                {ep.ok ? "OK" : "ERRO"} · {ep.label} · {ep.status} · {ep.elapsedMs}ms
              </summary>
              <p className="mt-2 break-all text-xs text-zinc-600">{ep.url}</p>
              {ep.error && <p className="mt-2 text-xs text-rose-300">{ep.error}</p>}
              <pre className="mt-3 max-h-80 overflow-auto rounded bg-black/50 p-3 text-xs leading-5 text-zinc-300">
                {JSON.stringify(ep.data, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      </details>
      {d.observations.length > 0 && (
        <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.025] p-4">
          <p className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">Observações técnicas</p>
          <ul className="space-y-1.5 text-sm text-zinc-300">
            {d.observations.map((o) => <li key={o}>— {o}</li>)}
          </ul>
        </div>
      )}
    </AdminCard>
  );
}

function SectionView({ section }: { section: DebugSection }) {
  return (
    <details open className="rounded-lg border border-white/10 bg-white/[0.02] p-4">
      <summary className="cursor-pointer text-base font-black text-white">{section.title}</summary>
      {section.description && <p className="mt-1.5 text-sm text-zinc-400">{section.description}</p>}
      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-3 grid gap-1.5 text-sm text-zinc-300 sm:grid-cols-2">
          {section.bullets.map((b) => <li key={b}>— {b}</li>)}
        </ul>
      )}
      {section.cards && section.cards.length > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {section.cards.map((c, i) => <MediaCard key={`${c.title}-${i}`} card={c} />)}
        </div>
      )}
      {section.tables && section.tables.length > 0 && (
        <div className="mt-3 space-y-4">
          {section.tables.map((t) => <DebugTable key={t.title} table={t} />)}
        </div>
      )}
    </details>
  );
}

function MediaCard({ card }: { card: DebugCard }) {
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
      <div className="flex gap-3 p-3">
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded-md bg-white/[0.06]">
          {card.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={card.image} alt="" className="h-full w-full object-cover" />
            : <div className="grid h-full place-items-center text-xs font-bold text-zinc-600">—</div>}
        </div>
        <div className="min-w-0">
          <h4 className="line-clamp-2 text-sm font-black text-white">{card.title}</h4>
          {card.subtitle && <p className="mt-1 line-clamp-4 text-xs leading-5 text-zinc-400">{card.subtitle}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {card.badges?.slice(0, 4).map((b) => <Pill key={b}>{b}</Pill>)}
          </div>
        </div>
      </div>
      {card.meta && card.meta.length > 0 && (
        <div className="border-t border-white/10 px-3 py-2 text-[11px] text-zinc-500">
          {card.meta.slice(0, 4).join(" · ")}
        </div>
      )}
    </article>
  );
}

function DebugTable({ table }: { table: DebugTable }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <div className="border-b border-white/10 bg-white/[0.03] px-3 py-2 text-sm font-bold text-zinc-300">{table.title}</div>
      <div className="overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-black/20 text-zinc-500">
            <tr>{table.columns.map((c) => <th key={c} className="px-3 py-2 font-bold uppercase tracking-[0.12em]">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-white/[0.05] text-zinc-300">
            {table.rows.length ? table.rows.map((row, i) => (
              <tr key={i}>{row.map((cell, j) => <td key={j} className="max-w-[22rem] px-3 py-2 align-top">{cell}</td>)}</tr>
            )) : (
              <tr><td className="px-3 py-3 text-zinc-500" colSpan={table.columns.length}>Sem dados.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InfoPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
      <p className="text-xs font-black uppercase tracking-widest text-zinc-500 mb-2">{title}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.length ? items.map((i) => <Pill key={i}>{i}</Pill>) : <span className="text-sm text-zinc-600">N/D</span>}
      </div>
    </div>
  );
}

function Pill({ children, tone }: { children: React.ReactNode; tone?: "good" | "bad" }) {
  const cls = tone === "good" ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
    : tone === "bad"  ? "border-rose-300/20 bg-rose-400/10 text-rose-200"
    : "border-white/10 bg-white/[0.055] text-zinc-300";
  return <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold ${cls}`}>{children}</span>;
}
