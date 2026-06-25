"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useCallback, useState } from "react";
import { CheckCircle2, Clock3, Play, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { AdminActionButton, AdminCard, AdminFeedback, StatCard } from "../_components";
type QueueJob = {
    id: string;
    kind: string;
    cacheKey: string;
    mediaType: string | null;
    imdbId: string | null;
    slug: string | null;
    status: string;
    priority: number;
    attempts: number;
    runAfter: string;
    lockedUntil: string | null;
    lastError: string | null;
    updatedAt: string;
};
type QueueData = {
    config: {
        maxConcurrency: number;
        lockMs: number;
        retryDelayMs: number;
        maxAttempts: number;
    };
    totals: Record<string, number>;
    health?: {
        staleRunning: number;
        overdueQueued: number;
        oldestQueuedRunAfter: string | null;
        lastCronAt: string | null;
        lastCronAgeMs: number | null;
        lastCronHealthy: boolean;
        lastCronProcessed: number;
        lastCronCompleted: number;
        lastCronFailed: number;
        lastCronDurationMs: number;
        cronExpectedMs: number;
        staleRunningMs: number;
        overdueAlertMs: number;
    };
    byKind: Array<{
        kind: string;
        status: string;
        count: number;
    }>;
    nextJobs: QueueJob[];
};
type View = {
    kind: "idle";
} | {
    kind: "loading";
} | {
    kind: "error";
    message: string;
} | {
    kind: "ok";
    data: QueueData;
    fetchedAt: Date;
};
export function TabWorkersAdmin({ secret }: {
    secret: string;
}) {
    const [view, setView] = useState<View>({ kind: "idle" });
    const [feedback, setFeedback] = useState<string | null>(null);
    const isReady = secret.trim().length > 0;
    const load = useCallback(async () => {
        if (!secret.trim())
            return;
        setView((prev) => (prev.kind === "ok" ? prev : { kind: "loading" }));
        setFeedback(null);
        try {
            const res = await fetch("/api/admin/workers", {
                cache: "no-store",
                headers: { "x-admin-secret": secret },
            });
            if (!res.ok) {
                setView({ kind: "error", message: uiMessage("ui.e69ff1624558", { v1: res.status }) });
                return;
            }
            const data = await res.json() as QueueData;
            setView({ kind: "ok", data, fetchedAt: new Date() });
        }
        catch (error) {
            setView({ kind: "error", message: error instanceof Error ? error.message : "Erro desconhecido" });
        }
    }, [secret]);
    const postAction = async (action: string, body: Record<string, unknown> = {}) => {
        if (!secret.trim())
            return;
        setFeedback(null);
        const res = await fetch("/api/admin/workers", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-admin-secret": secret,
            },
            body: JSON.stringify({ action, ...body }),
        });
        if (!res.ok) {
            setFeedback(uiMessage("ui.527040e848e3", { v1: res.status }));
            return;
        }
        setFeedback(uiMessage("ui.3e8ce31ad1ef"));
        await load();
    };
    return (<div className="space-y-6">
      <AdminCard title={uiMessage("ui.8c972667fbbc")} desc={uiMessage("ui.70a8e722f48f")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <AdminActionButton label={uiMessage("ui.26d4d20c99ed")} icon={<RefreshCw size={15}/>} disabled={!isReady} onClick={() => void load()} tone="primary"/>
          <AdminActionButton label={uiMessage("ui.650a05ae8938")} desc={uiMessage("ui.86ffbbf551c6")} icon={<Play size={15}/>} disabled={!isReady} onClick={() => void postAction("claim", { limit: 1 })}/>
          <AdminActionButton label={uiMessage("ui.3a68a538e644")} icon={<RotateCcw size={15}/>} disabled={!isReady} onClick={() => void postAction("retry-failed")}/>
          <AdminActionButton label={uiMessage("ui.7f9df4fc72df")} icon={<Trash2 size={15}/>} disabled={!isReady} onClick={() => void postAction("clear-completed")} tone="danger"/>
        </div>
      </AdminCard>

      {feedback && <AdminFeedback kind="success" message={feedback}/>}
      {view.kind === "idle" && <p className="text-sm text-zinc-600">{uiMessage("ui.d1c65a54bdc7")}</p>}
      {view.kind === "loading" && <AdminFeedback kind="loading" message={uiMessage("ui.7950a332d64b")}/>}
      {view.kind === "error" && <AdminFeedback kind="error" message={view.message}/>}
      {view.kind === "ok" && <WorkersBody data={view.data} fetchedAt={view.fetchedAt}/>}
    </div>);
}
function WorkersBody({ data, fetchedAt }: {
    data: QueueData;
    fetchedAt: Date;
}) {
    const queued = data.totals.queued ?? 0;
    const running = data.totals.running ?? 0;
    const failed = data.totals.failed ?? 0;
    const completed = data.totals.completed ?? 0;
    const health = data.health;
    return (<div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={uiMessage("ui.a3ecf1f4868b")} value={String(queued)} icon={<Clock3 size={15} className="text-indigo-300"/>}/>
        <StatCard label="Rodando" value={String(running)} icon={<Play size={15} className="text-emerald-300"/>} tone={running > 0 ? "good" : "neutral"}/>
        <StatCard label="Falhos" value={String(failed)} icon={<RotateCcw size={15} className="text-rose-300"/>} tone={failed > 0 ? "bad" : "neutral"}/>
        <StatCard label={uiMessage("ui.454ea6968d53")} value={String(completed)} sub={`atualizado ${fetchedAt.toLocaleTimeString("pt-BR")}`} icon={<CheckCircle2 size={15} className="text-zinc-400"/>}/>
      </div>

      {health && (<AdminCard title={uiMessage("ui.cf5c6822241c")} desc={uiMessage("ui.a10f364f057f")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label={uiMessage("ui.46bd9a9985ea")} value={health.lastCronAt ? new Date(health.lastCronAt).toLocaleString("pt-BR") : "Nunca"}/>
          <Mini label={uiMessage("ui.4c2b7a2845b0")} value={health.lastCronHealthy ? "Ativo" : uiMessage("ui.c9701a7da6bb")}/>
          <Mini label={uiMessage("ui.97f531783cfd")} value={health.overdueQueued}/>
          <Mini label={uiMessage("ui.d0d9d9fcdd14")} value={health.staleRunning}/>
        </div>
        <p className="mt-3 text-xs text-zinc-500">{uiMessage("ui.3148e021963c")}{health.lastCronProcessed} processados, {health.lastCronCompleted}{uiMessage("ui.3485ebcaf6df")}{health.lastCronFailed}{uiMessage("ui.aeda4552e020")}{health.lastCronDurationMs}ms.
        </p>
      </AdminCard>)}

      <AdminCard title={uiMessage("ui.52e1d332c12a")} desc={uiMessage("ui.839296b6acf8")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Mini label={uiMessage("ui.31f0bc374227")} value={data.config.maxConcurrency}/>
          <Mini label="Lock" value={`${Math.round(data.config.lockMs / 1000)}s`}/>
          <Mini label="Retry" value={`${Math.round(data.config.retryDelayMs / 1000)}s`}/>
          <Mini label="Tentativas" value={data.config.maxAttempts}/>
        </div>
      </AdminCard>

      <AdminCard title={uiMessage("ui.c3986cd9c359")}>
        {data.nextJobs.length === 0 ? (<p className="text-sm text-zinc-600">{uiMessage("ui.03fb3f29a4cc")}</p>) : (<div className="overflow-auto rounded-lg border border-white/10">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-white/[0.04] text-zinc-500">
                <tr>{["ID", "Kind", "Status", "IMDb", "Chave", "Tent.", "Run after", "Erro"].map((col) => (<th key={col} className="px-3 py-2.5 font-bold uppercase tracking-[0.12em]">{col}</th>))}</tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04] text-zinc-300">
                {data.nextJobs.map((job) => (<tr key={job.id} className="hover:bg-white/[0.025]">
                    <td className="px-3 py-2 text-zinc-600">{job.id}</td>
                    <td className="px-3 py-2 font-bold text-white">{job.kind}</td>
                    <td className="px-3 py-2">{job.status}</td>
                    <td className="px-3 py-2">{job.imdbId ?? "-"}</td>
                    <td className="max-w-[18rem] truncate px-3 py-2 text-zinc-500">{job.cacheKey}</td>
                    <td className="px-3 py-2">{job.attempts}</td>
                    <td className="px-3 py-2 text-zinc-500">{new Date(job.runAfter).toLocaleString("pt-BR")}</td>
                    <td className="max-w-[16rem] truncate px-3 py-2 text-rose-300">{job.lastError ?? "-"}</td>
                  </tr>))}
              </tbody>
            </table>
          </div>)}
      </AdminCard>
    </div>);
}
function Mini({ label, value }: {
    label: string;
    value: string | number;
}) {
    return (<div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 text-lg font-black text-white">{value}</p>
    </div>);
}

