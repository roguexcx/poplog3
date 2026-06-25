"use client";

import { uiMessage } from "@/lib/i18n/ui-message";
import type React from "react";
import { useCallback, useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Database,
  FileSearch,
  ImageIcon,
  Languages,
  Play,
  RefreshCw,
  Search,
  ServerCog,
  Trash2,
} from "lucide-react";
import { AdminCard, AdminFeedback, StatCard } from "../_components";

type MediaType = "movie" | "tv";

type ProviderProblem = {
  id: string;
  imdbId: string | null;
  mediaType: MediaType;
  title: string | null;
  providerName: string;
  providerType: string;
  source: string;
  sourceConfidence: string;
  expiresAt: string | null;
};

type ReviewRow = {
  imdbId: string | null;
  mediaType: MediaType;
  title: string | null;
  slug?: string | null;
  issues: string[];
  updatedAt?: string | null;
};

type QueueJob = {
  id: string;
  kind: string;
  cacheKey: string;
  imdbId: string | null;
  status: string;
  lastError: string | null;
  updatedAt: string;
};

type EngineError = {
  id: string;
  ts: string | null;
  api: string;
  op: string;
  origin: string;
  error: string | null;
};

type LogRow = {
  id: string;
  actorUserId: string;
  entityType: string;
  entityId: string;
  action: string;
  field: string | null;
  cacheInvalidated: boolean;
  createdAt: string | null;
};

type CacheInspection = {
  title: {
    title: string | null;
    mediaType: MediaType;
    slug: string | null;
    cacheStatus: string;
    updatedAt: string | null;
  } | null;
  keys: Record<string, string>;
  providers: Array<{
    id: string;
    providerName: string;
    providerType: string;
    source: string;
    sourceConfidence: string;
    expiresAt: string | null;
    staleUntil: string | null;
  }>;
  continuity: Array<{
    id: string;
    sectionKey: string;
    userId: string | null;
    region: string | null;
    language: string | null;
    updatedAt: string | null;
    expiresAt: string | null;
  }>;
  assets: Array<{
    id: string;
    type: string;
    language: string | null;
    region: string | null;
    assetKey: string | null;
    publicUrl: string | null;
    width: number | null;
    height: number | null;
    isPrimary: boolean;
    isOverride: boolean;
    updatedAt: string | null;
  }>;
  translations: Array<{
    language: string;
    region: string;
    title: string;
    hasOverview: boolean;
    slug: string | null;
    updatedAt: string | null;
  }>;
  redis: Array<{ key: string; ttlSeconds: number | null }>;
} | null;

type OperationsData = {
  ok: boolean;
  generatedAt: string;
  locale: { language: string; region: string };
  alerts: Record<string, number | boolean>;
  workers: {
    totals: Record<string, number>;
    health: {
      overdueQueued: number;
      staleRunning: number;
      lastCronAt: string | null;
      lastCronHealthy: boolean;
      lastCronProcessed: number;
      lastCronCompleted: number;
      lastCronFailed: number;
      lastCronDurationMs: number;
    };
    nextJobs: QueueJob[];
  };
  providers: { problemRows: ProviderProblem[] };
  seo: { rows: ReviewRow[] };
  translations: { rows: ReviewRow[] };
  assets: { rows: ReviewRow[] };
  cache: CacheInspection;
  hydrationErrors: {
    failedJobs: QueueJob[];
    engineErrors: EngineError[];
  };
  radar: {
    caches: Array<{
      sectionKey: string;
      region: string | null;
      language: string | null;
      updatedAt: string | null;
      expiresAt: string | null;
    }>;
  };
  logs: LogRow[];
};

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ok"; data: OperationsData };

function formatDate(value: string | null | undefined): string {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
}

function issuePills(issues: string[]) {
  if (!issues.length) return "-";
  return (
    <div className="flex flex-wrap gap-1">
      {issues.map((issue) => (
        <span key={issue} className="rounded border border-amber-300/20 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-200">
          {issue}
        </span>
      ))}
    </div>
  );
}

function statusTone(value: number | boolean): "neutral" | "good" | "bad" {
  if (typeof value === "boolean") return value ? "good" : "bad";
  return value > 0 ? "bad" : "good";
}

export function TabOperationsAdmin({ secret }: { secret: string }) {
  const [imdbId, setImdbId] = useState("tt0993846");
  const [mediaType, setMediaType] = useState<MediaType>("movie");
  const [language, setLanguage] = useState("pt-BR");
  const [region, setRegion] = useState("BR");
  const [logSearch, setLogSearch] = useState("");
  const [view, setView] = useState<View>({ kind: "idle" });
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ kind: "success" | "error"; message: string; detail?: string } | null>(null);

  const isReady = secret.trim().length > 0;
  const hasValidTitle = /^tt\d+$/i.test(imdbId.trim());
  const data = view.kind === "ok" ? view.data : null;

  const authHeaders = useMemo(() => ({ "x-admin-secret": secret }), [secret]);

  const load = useCallback(async () => {
    if (!secret.trim()) return;
    setFeedback(null);
    setView((prev) => (prev.kind === "ok" ? prev : { kind: "loading" }));
    const params = new URLSearchParams({ language, region });
    if (hasValidTitle) params.set("imdbId", imdbId.trim());
    if (logSearch.trim()) params.set("logSearch", logSearch.trim());
    const res = await fetch(`/api/admin/operations?${params}`, {
      headers: authHeaders,
      cache: "no-store",
    });
    const payload = await res.json().catch(() => null) as OperationsData | { error?: string } | null;
    if (!res.ok || !payload || !("ok" in payload) || !payload.ok) {
      setView({ kind: "error", message: payload && "error" in payload ? payload.error ?? `HTTP ${res.status}` : `HTTP ${res.status}` });
      return;
    }
    setView({ kind: "ok", data: payload });
  }, [authHeaders, hasValidTitle, imdbId, language, logSearch, region, secret]);

  const runAction = useCallback(async (action: string, extra: Record<string, unknown> = {}) => {
    if (!secret.trim()) return;
    setBusyAction(action);
    setFeedback(null);
    try {
      const res = await fetch("/api/admin/operations", {
        method: "POST",
        headers: {
          ...authHeaders,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          imdbId: imdbId.trim(),
          mediaType,
          language,
          region,
          ...extra,
        }),
      });
      const payload = await res.json().catch(() => null) as { ok?: boolean; error?: string; summary?: { providerCount?: number; source?: string } } | null;
      if (!res.ok || !payload?.ok) {
        setFeedback({ kind: "error", message: uiMessage("admin.operations.feedback.error"), detail: payload?.error ?? `HTTP ${res.status}` });
        return;
      }
      const detail = payload.summary
        ? `${payload.summary.source ?? "-"} / ${payload.summary.providerCount ?? 0}`
        : undefined;
      setFeedback({ kind: "success", message: uiMessage("admin.operations.feedback.success"), detail });
      await load();
    } finally {
      setBusyAction(null);
    }
  }, [authHeaders, imdbId, language, load, mediaType, region, secret]);

  const runRowProvider = useCallback(async (row: ProviderProblem) => {
    if (!row.imdbId) return;
    setImdbId(row.imdbId);
    setMediaType(row.mediaType);
    await runAction("rehydrate-provider", { imdbId: row.imdbId, mediaType: row.mediaType });
  }, [runAction]);

  return (
    <div className="space-y-6">
      <AdminCard title={uiMessage("admin.operations.label")} desc={uiMessage("admin.operations.subtitle")}>
        <div className="grid gap-3 lg:grid-cols-[1fr_130px_110px_90px_auto]">
          <input
            value={imdbId}
            onChange={(event) => setImdbId(event.target.value)}
            placeholder="tt0993846"
            className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-indigo-400/40"
          />
          <select
            value={mediaType}
            onChange={(event) => setMediaType(event.target.value as MediaType)}
            className="h-10 rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none"
          >
            <option value="movie">movie</option>
            <option value="tv">tv</option>
          </select>
          <input
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            placeholder="pt-BR"
            className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-indigo-400/40"
          />
          <input
            value={region}
            onChange={(event) => setRegion(event.target.value)}
            placeholder="BR"
            className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-indigo-400/40"
          />
          <button
            type="button"
            disabled={!isReady || view.kind === "loading"}
            onClick={() => void load()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-indigo-400/20 bg-indigo-500/20 px-4 text-sm font-semibold text-indigo-100 disabled:opacity-40"
          >
            {view.kind === "loading" ? <RefreshCw size={14} className="animate-spin" /> : <Search size={14} />}
            {uiMessage("admin.operations.action.refresh")}
          </button>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
          <ActionButton busy={busyAction === "rehydrate-title"} disabled={!isReady || !hasValidTitle} icon={<FileSearch size={14} />} label={uiMessage("admin.operations.action.title")} onClick={() => void runAction("rehydrate-title")} />
          <ActionButton busy={busyAction === "rehydrate-provider"} disabled={!isReady || !hasValidTitle} icon={<Database size={14} />} label={uiMessage("admin.operations.action.provider")} onClick={() => void runAction("rehydrate-provider")} />
          <ActionButton busy={busyAction === "rehydrate-episodes"} disabled={!isReady || !hasValidTitle || mediaType !== "tv"} icon={<Play size={14} />} label={uiMessage("admin.operations.action.episodes")} onClick={() => void runAction("rehydrate-episodes")} />
          <ActionButton busy={busyAction === "rehydrate-assets"} disabled={!isReady || !hasValidTitle} icon={<ImageIcon size={14} />} label={uiMessage("admin.operations.action.assets")} onClick={() => void runAction("rehydrate-assets")} />
          <ActionButton busy={busyAction === "clear-title-cache"} disabled={!isReady || !hasValidTitle} icon={<Trash2 size={14} />} label={uiMessage("admin.operations.action.cache")} onClick={() => void runAction("clear-title-cache")} />
          <ActionButton busy={busyAction === "reprocess-radar"} disabled={!isReady} icon={<Activity size={14} />} label={uiMessage("admin.operations.action.radar")} onClick={() => void runAction("reprocess-radar")} />
        </div>
      </AdminCard>

      {feedback && <AdminFeedback kind={feedback.kind} message={feedback.message} detail={feedback.detail} />}
      {view.kind === "loading" && <AdminFeedback kind="loading" message={uiMessage("admin.operations.running")} />}
      {view.kind === "error" && <AdminFeedback kind="error" message={view.message} />}
      {view.kind === "idle" && <p className="text-sm text-zinc-600">{uiMessage("admin.operations.desc")}</p>}

      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={uiMessage("admin.operations.stat.cron")} value={data.alerts.cronHealthy ? "OK" : "ALERT"} icon={<ServerCog size={15} className="text-indigo-300" />} tone={statusTone(data.alerts.cronHealthy)} />
            <StatCard label={uiMessage("admin.operations.stat.jobs_overdue")} value={String(data.alerts.overdueJobs ?? 0)} icon={<AlertTriangle size={15} className="text-amber-300" />} tone={statusTone(data.alerts.overdueJobs)} />
            <StatCard label={uiMessage("admin.operations.stat.provider_fallback")} value={String(data.alerts.providerFallback ?? 0)} icon={<Database size={15} className="text-indigo-300" />} tone={statusTone(data.alerts.providerFallback)} />
            <StatCard label={uiMessage("admin.operations.stat.review")} value={String(Number(data.alerts.seoReview ?? 0) + Number(data.alerts.translationReview ?? 0) + Number(data.alerts.assetReview ?? 0))} sub={uiMessage("admin.operations.generated", { v1: new Date(data.generatedAt).toLocaleTimeString("pt-BR") })} icon={<FileSearch size={15} className="text-zinc-400" />} />
          </div>

          <AdminCard title={uiMessage("admin.operations.workers")}>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Mini label={uiMessage("admin.operations.stat.last_cron")} value={data.workers.health.lastCronAt ? formatDate(data.workers.health.lastCronAt) : "-"} />
              <Mini label={uiMessage("admin.operations.stat.processed")} value={data.workers.health.lastCronProcessed} />
              <Mini label={uiMessage("admin.operations.stat.failed")} value={data.workers.health.lastCronFailed} />
              <Mini label={uiMessage("admin.operations.stat.duration")} value={`${data.workers.health.lastCronDurationMs}ms`} />
            </div>
          </AdminCard>

          <AdminCard title={uiMessage("admin.operations.providers")}>
            <DataTable
              headers={[
                "IMDb",
                uiMessage("admin.operations.table.title"),
                uiMessage("admin.operations.table.type"),
                uiMessage("admin.operations.table.source"),
                uiMessage("admin.operations.table.confidence"),
                uiMessage("admin.operations.table.expires"),
                uiMessage("admin.operations.actions"),
              ]}
              rows={data.providers.problemRows.map((row) => [
                row.imdbId ?? "-",
                row.title ?? row.providerName,
                row.providerType,
                row.source,
                row.sourceConfidence,
                formatDate(row.expiresAt),
                row.imdbId ? (
                  <button type="button" onClick={() => void runRowProvider(row)} className="rounded border border-indigo-400/20 bg-indigo-500/15 px-2 py-1 text-[11px] font-bold text-indigo-100">
                    {uiMessage("admin.operations.reprocess")}
                  </button>
                ) : "-",
              ])}
            />
          </AdminCard>

          <div className="grid gap-6 xl:grid-cols-2">
            <AdminCard title={uiMessage("admin.operations.review.seo")}>
              <ReviewTable rows={data.seo.rows} />
            </AdminCard>
            <AdminCard title={uiMessage("admin.operations.review.translations")}>
              <ReviewTable rows={data.translations.rows} />
            </AdminCard>
          </div>

          <AdminCard title={uiMessage("admin.operations.cache")}>
            {!data.cache ? (
              <p className="text-sm text-zinc-600">{uiMessage("admin.operations.cache.empty")}</p>
            ) : (
              <div className="space-y-4">
                <div className="grid gap-3 md:grid-cols-3">
                  <Mini label={uiMessage("admin.operations.cache.title")} value={data.cache.title?.cacheStatus ?? "-"} />
                  <Mini label={uiMessage("admin.operations.cache.sections")} value={data.cache.continuity.length} />
                  <Mini label={uiMessage("admin.operations.cache.redis")} value={data.cache.redis.length} />
                </div>
                <DataTable
                  headers={[uiMessage("admin.operations.table.key"), uiMessage("admin.operations.table.scope"), uiMessage("admin.operations.table.expires")]}
                  rows={data.cache.continuity.map((row) => [row.sectionKey, `${row.language ?? "-"} / ${row.region ?? "-"} / ${row.userId ?? "-"}`, formatDate(row.expiresAt)])}
                />
                <DataTable
                  headers={["Redis", uiMessage("admin.operations.table.ttl")]}
                  rows={data.cache.redis.map((row) => [row.key, row.ttlSeconds ?? "-"])}
                />
              </div>
            )}
          </AdminCard>

          <AdminCard title={uiMessage("admin.operations.assets")}>
            <ReviewTable rows={data.assets.rows} />
            {data.cache?.assets.length ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                {data.cache.assets.slice(0, 10).map((asset) => (
                  <div key={asset.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
                    <div className="aspect-[2/3] overflow-hidden rounded bg-black/30">
                      {asset.publicUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={asset.publicUrl} alt="" className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <p className="mt-2 truncate text-[11px] text-zinc-400">{asset.type} / {asset.language ?? "-"}</p>
                    <p className="text-[10px] text-zinc-600">{asset.width ?? "?"}x{asset.height ?? "?"}</p>
                  </div>
                ))}
              </div>
            ) : null}
          </AdminCard>

          <div className="grid gap-6 xl:grid-cols-2">
            <AdminCard title={uiMessage("admin.operations.hydration")}>
              <DataTable
                headers={[
                  uiMessage("admin.operations.table.job"),
                  uiMessage("admin.operations.table.kind"),
                  "IMDb",
                  uiMessage("admin.operations.table.status"),
                  uiMessage("admin.operations.table.error"),
                ]}
                rows={data.hydrationErrors.failedJobs.map((job) => [job.id, job.kind, job.imdbId ?? "-", job.status, job.lastError ?? "-"])}
              />
              <div className="mt-4">
                <DataTable
                  headers={[
                    uiMessage("admin.operations.table.api"),
                    uiMessage("admin.operations.table.op"),
                    uiMessage("admin.operations.table.origin"),
                    uiMessage("admin.operations.table.error"),
                    uiMessage("admin.operations.table.when"),
                  ]}
                  rows={data.hydrationErrors.engineErrors.map((error) => [error.api, error.op, error.origin, error.error ?? "-", formatDate(error.ts)])}
                />
              </div>
            </AdminCard>

            <AdminCard title={uiMessage("admin.operations.radar")}>
              <DataTable
                headers={[uiMessage("admin.operations.table.key"), uiMessage("admin.operations.table.locale"), uiMessage("admin.operations.table.updated"), uiMessage("admin.operations.table.expires")]}
                rows={data.radar.caches.map((cache) => [cache.sectionKey, `${cache.language ?? "-"} / ${cache.region ?? "-"}`, formatDate(cache.updatedAt), formatDate(cache.expiresAt)])}
              />
            </AdminCard>
          </div>

          <AdminCard title={uiMessage("admin.operations.logs")}>
            <div className="mb-3 flex gap-2">
              <input
                value={logSearch}
                onChange={(event) => setLogSearch(event.target.value)}
                placeholder={uiMessage("admin.operations.logs.search")}
                className="h-9 flex-1 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-indigo-400/40"
              />
              <button type="button" disabled={!isReady} onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] px-3 text-sm font-semibold text-zinc-200 disabled:opacity-40">
                <RefreshCw size={13} />
                {uiMessage("admin.operations.action.refresh")}
              </button>
            </div>
            <DataTable
              headers={[
                uiMessage("admin.operations.table.updated"),
                uiMessage("admin.operations.table.actor"),
                uiMessage("admin.operations.table.entity"),
                uiMessage("admin.operations.actions"),
                uiMessage("admin.operations.table.cache"),
              ]}
              rows={data.logs.map((log) => [formatDate(log.createdAt), log.actorUserId, `${log.entityType}:${log.entityId}`, log.action, log.cacheInvalidated ? "yes" : "no"])}
            />
          </AdminCard>
        </>
      )}
    </div>
  );
}

function ActionButton({
  label,
  icon,
  disabled,
  busy,
  onClick,
}: {
  label: string;
  icon: React.ReactNode;
  disabled?: boolean;
  busy?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={onClick}
      className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.045] px-3 py-2 text-xs font-bold text-zinc-200 transition hover:bg-white/[0.075] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {busy ? <RefreshCw size={14} className="animate-spin" /> : icon}
      <span className="truncate">{label}</span>
    </button>
  );
}

function DataTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: Array<Array<React.ReactNode>>;
}) {
  if (!rows.length) return <p className="text-sm text-zinc-600">{uiMessage("admin.operations.empty")}</p>;
  return (
    <div className="overflow-auto rounded-lg border border-white/10">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-white/[0.04] text-zinc-500">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-3 py-2 font-bold uppercase tracking-[0.12em]">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05] text-zinc-300">
          {rows.map((row, index) => (
            <tr key={index} className="hover:bg-white/[0.025]">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="max-w-[22rem] px-3 py-2 align-top">
                  <div className="truncate">{cell}</div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ReviewTable({ rows }: { rows: ReviewRow[] }) {
  return (
    <DataTable
      headers={["IMDb", uiMessage("admin.operations.table.title"), uiMessage("admin.operations.table.type"), uiMessage("admin.operations.table.issue"), uiMessage("admin.operations.table.updated")]}
      rows={rows.map((row) => [
        row.imdbId ?? "-",
        row.title ?? row.slug ?? "-",
        row.mediaType,
        issuePills(row.issues),
        formatDate(row.updatedAt),
      ])}
    />
  );
}

function Mini({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-4 py-3">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-500">{label}</p>
      <p className="mt-1 truncate text-lg font-black text-white">{value}</p>
    </div>
  );
}
