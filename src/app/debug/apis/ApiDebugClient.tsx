"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, Clock, RefreshCw, XCircle } from "lucide-react";

type DebugEndpointResult = {
  label: string;
  url: string;
  ok: boolean;
  status: number;
  elapsedMs: number;
  data: unknown;
  error?: string;
};

type DebugCard = {
  title: string;
  subtitle?: string;
  meta?: string[];
  badges?: string[];
  image?: string | null;
};

type DebugTable = {
  title: string;
  columns: string[];
  rows: string[][];
};

type DebugSection = {
  title: string;
  description?: string;
  cards?: DebugCard[];
  tables?: DebugTable[];
  bullets?: string[];
};

type ApiDebugResponse = {
  api: string;
  configured: boolean;
  ok: boolean;
  elapsedMs: number;
  callCount: number;
  summary: {
    description: string;
    bestFor: string[];
    dataTypes: string[];
    impression: string;
  };
  capabilities: string[];
  sections: DebugSection[];
  observations: string[];
  endpoints: DebugEndpointResult[];
};

type ApiState = {
  id: string;
  label: string;
  path: string;
  data?: ApiDebugResponse;
  loading: boolean;
  error?: string;
};

const APIS: Omit<ApiState, "loading">[] = [
  { id: "tmdb", label: "TMDB", path: "/api/debug/tmdb" },
  { id: "watchmode", label: "Watchmode", path: "/api/debug/watchmode" },
  { id: "movieofthenight", label: "MovieOfTheNight", path: "/api/debug/movieofthenight" },
  { id: "omdb", label: "OMDb", path: "/api/debug/omdb" },
];

export default function ApiDebugClient() {
  const [secret, setSecret] = useState("");
  const [apis, setApis] = useState<ApiState[]>(
    APIS.map((api) => ({ ...api, loading: false })),
  );
  const [lastRun, setLastRun] = useState<Date | null>(null);

  async function loadAll(reset = true) {
    if (!secret.trim()) return;

    if (reset) {
      setApis(APIS.map((api) => ({ ...api, loading: true })));
    }

    const results = await Promise.all(APIS.map(async (api) => {
      try {
        const response = await fetch(api.path, {
          cache: "no-store",
          headers: { "x-admin-secret": secret },
        });
        const data = await response.json() as ApiDebugResponse;
        return { ...api, data, loading: false };
      } catch (error) {
        return {
          ...api,
          loading: false,
          error: error instanceof Error ? error.message : "Erro desconhecido",
        };
      }
    }));

    setApis(results);
    setLastRun(new Date());
  }

  const metrics = useMemo(() => {
    const completed = apis.filter((api) => !api.loading);
    const working = completed.filter((api) => api.data?.ok).length;
    const errors = completed.filter((api) => api.error || api.data?.ok === false).length;
    const calls = apis.reduce((sum, api) => sum + (api.data?.callCount ?? 0), 0);
    const elapsed = Math.max(...apis.map((api) => api.data?.elapsedMs ?? 0), 0);
    return { working, errors, calls, elapsed };
  }, [apis]);

  return (
    <div className="min-h-screen px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">
        <header className="border-b border-white/10 pb-7">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.28em] text-indigo-300/80">
                POPLOG API LAB
              </p>
              <h1 className="mt-3 text-3xl font-black text-white sm:text-5xl">
                Laboratorio de APIs cinematograficas
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-6 text-zinc-400 sm:text-base">
                Sandbox tecnico para comparar potencial, resposta, cobertura e complementaridade entre APIs antes de definir arquitetura final.
              </p>
            </div>

            <button
              type="button"
              onClick={() => void loadAll()}
              disabled={!secret.trim()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-indigo-400/30 bg-indigo-500/10 px-4 text-sm font-bold text-indigo-100 transition hover:bg-indigo-500/20"
            >
              <RefreshCw size={17} />
              Recarregar amostra
            </button>
          </div>

          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="shrink-0 text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:w-28">
              Admin Secret
            </label>
            <input
              type="password"
              placeholder="ADMIN_SECRET"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              onKeyDown={(event) => event.key === "Enter" && void loadAll()}
              className="h-10 w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-400/40 focus:ring-1 focus:ring-indigo-400/20"
            />
          </div>

          <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Metric label="Configuradas" value={`${APIS.length}`} detail="APIs nesta etapa" />
            <Metric label="Funcionando" value={`${metrics.working}`} detail="com alguma resposta OK" tone="good" />
            <Metric label="Com erro" value={`${metrics.errors}`} detail="falha ou chave ausente" tone={metrics.errors ? "bad" : "good"} />
            <Metric label="Chamadas" value={`${metrics.calls}`} detail="aprox. por rodada" />
            <Metric label="Tempo" value={`${metrics.elapsed}ms`} detail={lastRun ? lastRun.toLocaleTimeString() : "rodando"} />
          </div>
        </header>

        <section className="mt-7 grid gap-4 lg:grid-cols-4">
          {apis.map((api) => (
            <ApiStatusCard key={api.id} api={api} />
          ))}
        </section>

        <main className="mt-8 space-y-8">
          {apis.map((api) => (
            <ApiBlock key={api.id} api={api} />
          ))}
        </main>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  detail,
  tone = "neutral",
}: {
  label: string;
  value: string;
  detail: string;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass = tone === "good"
    ? "text-emerald-300"
    : tone === "bad"
      ? "text-rose-300"
      : "text-white";
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-zinc-500">{label}</p>
      <p className={`mt-2 text-2xl font-black ${toneClass}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-500">{detail}</p>
    </div>
  );
}

function ApiStatusCard({ api }: { api: ApiState }) {
  const ok = api.data?.ok;
  const Icon = api.loading ? Clock : ok ? CheckCircle2 : XCircle;
  const tone = api.loading
    ? "border-amber-300/20 text-amber-200"
    : ok
      ? "border-emerald-300/20 text-emerald-200"
      : "border-rose-300/20 text-rose-200";
  return (
    <div className={`rounded-lg border bg-white/[0.03] p-4 ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-black text-white">{api.label}</h2>
        <Icon size={18} />
      </div>
      <p className="mt-3 text-xs leading-5 text-zinc-400">
        {api.loading
          ? "Explorando endpoints..."
          : api.data?.summary.impression ?? api.error ?? "Sem resposta."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2 text-[11px] font-semibold">
        <Badge>{api.data?.callCount ?? 0} calls</Badge>
        <Badge>{api.data?.elapsedMs ?? 0}ms</Badge>
        <Badge>{api.data?.configured === false ? "sem chave" : "server-side"}</Badge>
      </div>
    </div>
  );
}

function ApiBlock({ api }: { api: ApiState }) {
  if (api.loading) {
    return (
      <section className="rounded-lg border border-white/10 bg-white/[0.03] p-6">
        <h2 className="text-xl font-black text-white">{api.label}</h2>
        <p className="mt-2 text-sm text-zinc-400">Carregando amostra tecnica...</p>
      </section>
    );
  }

  if (!api.data) {
    return (
      <section className="rounded-lg border border-rose-300/20 bg-rose-500/[0.04] p-6">
        <h2 className="text-xl font-black text-white">{api.label}</h2>
        <p className="mt-2 text-sm text-rose-200">{api.error ?? "Falha ao carregar."}</p>
      </section>
    );
  }

  const data = api.data;

  return (
    <section className="rounded-lg border border-white/10 bg-[#09090f]/70 p-5 shadow-2xl shadow-black/20 sm:p-6">
      <div className="flex flex-col gap-4 border-b border-white/10 pb-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-black text-white">{data.api}</h2>
            <Badge tone={data.ok ? "good" : "bad"}>{data.ok ? "respondendo" : "erro"}</Badge>
            <Badge>{data.callCount} chamadas</Badge>
            <Badge>{data.elapsedMs}ms</Badge>
          </div>
          <p className="mt-3 max-w-4xl text-sm leading-6 text-zinc-400">{data.summary.description}</p>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-300">{data.summary.impression}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-3">
        <InfoPanel title="Faz melhor" items={data.summary.bestFor} />
        <InfoPanel title="Dados encontrados" items={data.summary.dataTypes} />
        <InfoPanel title="Capacidades exploradas" items={data.capabilities} />
      </div>

      <div className="mt-6 space-y-6">
        {data.sections.map((section) => (
          <DebugSectionView key={section.title} section={section} />
        ))}
      </div>

      <details className="mt-6 rounded-lg border border-white/10 bg-black/20 p-4">
        <summary className="cursor-pointer text-sm font-bold text-zinc-200">
          Raw JSON e endpoints
        </summary>
        <div className="mt-4 space-y-4">
          {data.endpoints.map((endpoint) => (
            <details key={`${endpoint.label}-${endpoint.url}`} className="rounded-lg border border-white/10 bg-black/20 p-3">
              <summary className="cursor-pointer text-xs font-bold text-zinc-300">
                {endpoint.ok ? "OK" : "ERRO"} | {endpoint.label} | {endpoint.status} | {endpoint.elapsedMs}ms
              </summary>
              <p className="mt-2 break-all text-xs text-zinc-500">{endpoint.url}</p>
              {endpoint.error && <p className="mt-2 text-xs text-rose-300">{endpoint.error}</p>}
              <pre className="mt-3 max-h-96 overflow-auto rounded-md bg-black/50 p-3 text-xs leading-5 text-zinc-300">
                {JSON.stringify(endpoint.data, null, 2)}
              </pre>
            </details>
          ))}
        </div>
      </details>

      <div className="mt-6 rounded-lg border border-white/10 bg-white/[0.025] p-4">
        <h3 className="text-sm font-black uppercase tracking-[0.18em] text-zinc-400">Observacoes tecnicas</h3>
        <ul className="mt-3 space-y-2 text-sm leading-6 text-zinc-300">
          {data.observations.map((observation) => (
            <li key={observation}>- {observation}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function InfoPanel({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
      <h3 className="text-xs font-black uppercase tracking-[0.18em] text-zinc-500">{title}</h3>
      <div className="mt-3 flex flex-wrap gap-2">
        {items.length ? items.map((item) => <Badge key={item}>{item}</Badge>) : <span className="text-sm text-zinc-500">N/D</span>}
      </div>
    </div>
  );
}

function DebugSectionView({ section }: { section: DebugSection }) {
  return (
    <details open className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
      <summary className="cursor-pointer text-lg font-black text-white">{section.title}</summary>
      {section.description && <p className="mt-2 text-sm leading-6 text-zinc-400">{section.description}</p>}

      {section.bullets && section.bullets.length > 0 && (
        <ul className="mt-4 grid gap-2 text-sm text-zinc-300 sm:grid-cols-2">
          {section.bullets.map((bullet) => <li key={bullet}>- {bullet}</li>)}
        </ul>
      )}

      {section.cards && section.cards.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {section.cards.map((card, index) => <MovieDebugCard key={`${card.title}-${index}`} card={card} />)}
        </div>
      )}

      {section.tables && section.tables.length > 0 && (
        <div className="mt-4 grid gap-4">
          {section.tables.map((table) => <DebugTableView key={table.title} table={table} />)}
        </div>
      )}
    </details>
  );
}

function MovieDebugCard({ card }: { card: DebugCard }) {
  return (
    <article className="overflow-hidden rounded-lg border border-white/10 bg-black/20">
      <div className="flex gap-3 p-3">
        <div className="h-28 w-20 shrink-0 overflow-hidden rounded-md bg-white/[0.06]">
          {card.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={card.image} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="grid h-full place-items-center text-xs font-bold text-zinc-600">sem imagem</div>
          )}
        </div>
        <div className="min-w-0">
          <h4 className="line-clamp-2 text-sm font-black text-white">{card.title}</h4>
          {card.subtitle && <p className="mt-1 line-clamp-4 text-xs leading-5 text-zinc-400">{card.subtitle}</p>}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {card.badges?.slice(0, 4).map((badge) => <Badge key={badge}>{badge}</Badge>)}
          </div>
        </div>
      </div>
      {card.meta && card.meta.length > 0 && (
        <div className="border-t border-white/10 px-3 py-2 text-[11px] leading-5 text-zinc-500">
          {card.meta.slice(0, 4).join(" | ")}
        </div>
      )}
    </article>
  );
}

function DebugTableView({ table }: { table: DebugTable }) {
  return (
    <div className="overflow-hidden rounded-lg border border-white/10">
      <div className="border-b border-white/10 bg-white/[0.035] px-3 py-2 text-sm font-bold text-zinc-200">
        {table.title}
      </div>
      <div className="overflow-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="bg-black/20 text-zinc-500">
            <tr>
              {table.columns.map((column) => (
                <th key={column} className="px-3 py-2 font-bold uppercase tracking-[0.14em]">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5 text-zinc-300">
            {table.rows.length ? table.rows.map((row, index) => (
              <tr key={`${table.title}-${index}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`${table.title}-${index}-${cellIndex}`} className="max-w-[22rem] px-3 py-2 align-top">
                    {cell}
                  </td>
                ))}
              </tr>
            )) : (
              <tr>
                <td className="px-3 py-3 text-zinc-500" colSpan={table.columns.length}>Sem dados nesta amostra.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "good" | "bad";
}) {
  const toneClass = tone === "good"
    ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-200"
    : tone === "bad"
      ? "border-rose-300/20 bg-rose-400/10 text-rose-200"
      : "border-white/10 bg-white/[0.055] text-zinc-300";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-1 text-[11px] font-bold leading-none ${toneClass}`}>
      {children}
    </span>
  );
}
