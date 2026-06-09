"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Clock, RefreshCw, Trash2, TrendingUp, Zap } from "lucide-react";
import { AdminCard, AdminRow, AdminFeedback, AdminActionButton } from "../_components";

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

type View =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string }
  | { kind: "status"; data: CacheStatus; fetchedAt: Date }
  | { kind: "flushed"; result: FlushResult; fetchedAt: Date };

// ── TMDB Feed toggle types ────────────────────────────────────────────────────

type TmdbFeedStatus = {
  enabled: boolean;
  envEnabled: boolean;
  source: "env" | "runtime_override";
  token: "configurado" | "ausente";
};

type TmdbFeedView =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "unauthorized" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: TmdbFeedStatus }
  | { kind: "toggled"; data: TmdbFeedStatus; message: string };

// ─── helpers ──────────────────────────────────────────────────────────────────

function ageLabel(hours: number | null): string {
  if (hours === null) return "-";
  if (hours < 1) return `${Math.round(hours * 60)} min atras`;
  if (hours < 24) return `${hours.toFixed(1)}h atras`;
  return `${(hours / 24).toFixed(1)} dias atras`;
}

function ageTone(hours: number | null): "fresh" | "aging" | "stale" {
  if (hours === null) return "stale";
  if (hours < 6) return "fresh";
  if (hours < 24) return "aging";
  return "stale";
}

const TONE_BADGE: Record<"fresh" | "aging" | "stale", { cls: string; label: string }> = {
  fresh:  { cls: "bg-emerald-500/15 text-emerald-300 border-emerald-400/20", label: "Fresco"       },
  aging:  { cls: "bg-amber-500/15  text-amber-300  border-amber-400/20",    label: "Envelhecendo" },
  stale:  { cls: "bg-red-500/15    text-red-300    border-red-400/20",      label: "Expirado"     },
};

// ─── component ────────────────────────────────────────────────────────────────

export function TabRadarCache({ secret }: { secret: string }) {
  const [view, setView] = useState<View>({ kind: "idle" });
  const [tmdbView, setTmdbView] = useState<TmdbFeedView>({ kind: "idle" });
  const isReady = secret.trim().length > 0;

  const authHeaders = useCallback(
    () => ({ "x-admin-secret": secret }),
    [secret],
  );

  const checkStatus = useCallback(async () => {
    if (!secret.trim()) return;
    setView({ kind: "loading" });
    try {
      const res = await fetch("/api/admin/radar-cache-flush", {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (res.status === 401) { setView({ kind: "unauthorized" }); return; }
      if (!res.ok)             { setView({ kind: "error", message: `HTTP ${res.status}` }); return; }
      const data = (await res.json()) as CacheStatus;
      setView({ kind: "status", data, fetchedAt: new Date() });
    } catch (err) {
      setView({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }, [secret, authHeaders]);

  const flush = useCallback(async (rebuild: boolean) => {
    if (!secret.trim()) return;
    if (!confirm(rebuild ? "Invalidar cache e disparar rebuild?" : "Invalidar cache (sem rebuild)?")) return;
    setView({ kind: "loading" });
    try {
      const res = await fetch(`/api/admin/radar-cache-flush?rebuild=${rebuild}`, {
        method: "POST",
        headers: authHeaders(),
      });
      if (res.status === 401) { setView({ kind: "unauthorized" }); return; }
      if (!res.ok)             { setView({ kind: "error", message: `HTTP ${res.status}` }); return; }
      const result = (await res.json()) as FlushResult;
      setView({ kind: "flushed", result, fetchedAt: new Date() });
    } catch (err) {
      setView({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }, [secret, authHeaders]);

  // ── TMDB Feed callbacks ──────────────────────────────────────────────────────

  const checkTmdbStatus = useCallback(async () => {
    if (!secret.trim()) return;
    setTmdbView({ kind: "loading" });
    try {
      const res = await fetch("/api/admin/tmdb-feed-toggle", {
        headers: authHeaders(),
        cache: "no-store",
      });
      if (res.status === 401) { setTmdbView({ kind: "unauthorized" }); return; }
      if (!res.ok)             { setTmdbView({ kind: "error", message: `HTTP ${res.status}` }); return; }
      const data = (await res.json()) as TmdbFeedStatus;
      setTmdbView({ kind: "ready", data });
    } catch (err) {
      setTmdbView({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }, [secret, authHeaders]);

  const toggleTmdbFeed = useCallback(async (enabled: boolean) => {
    if (!secret.trim()) return;
    setTmdbView({ kind: "loading" });
    try {
      const res = await fetch("/api/admin/tmdb-feed-toggle", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.status === 401) { setTmdbView({ kind: "unauthorized" }); return; }
      if (!res.ok)             { setTmdbView({ kind: "error", message: `HTTP ${res.status}` }); return; }
      const result = (await res.json()) as TmdbFeedStatus & { message: string };
      setTmdbView({ kind: "toggled", data: result, message: result.message });
    } catch (err) {
      setTmdbView({ kind: "error", message: err instanceof Error ? err.message : "Erro desconhecido" });
    }
  }, [secret, authHeaders]);

  // Carrega status do TMDB feed assim que o secret estiver preenchido
  useEffect(() => {
    if (isReady) void checkTmdbStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  // Estado unificado do TMDB
  const tmdbData: TmdbFeedStatus | null =
    tmdbView.kind === "ready"   ? tmdbView.data :
    tmdbView.kind === "toggled" ? tmdbView.data : null;

  return (
    <div className="space-y-6">

      {/* status check */}
      <AdminCard title="Status do cache">
        <div className="flex flex-wrap gap-3 mb-4">
          <button
            type="button"
            disabled={!isReady || view.kind === "loading"}
            onClick={() => void checkStatus()}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-indigo-500/20 px-4 text-sm font-semibold text-indigo-100 border border-indigo-400/20 transition hover:bg-indigo-500/30 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {view.kind === "loading"
              ? <RefreshCw size={13} className="animate-spin" />
              : <Clock size={13} />}
            Verificar status
          </button>
        </div>

        {view.kind === "loading"      && <AdminFeedback kind="loading" message="Consultando cache..." />}
        {view.kind === "unauthorized" && <AdminFeedback kind="error"   message="Secret incorreto." />}
        {view.kind === "error"        && <AdminFeedback kind="error"   message={view.message} />}

        {view.kind === "status" && (
          <div className="rounded-lg border border-white/10 divide-y divide-white/[0.06]">
            {view.data.status === "empty" ? (
              <div className="px-4 py-3 text-sm text-zinc-400 flex items-center gap-2">
                <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                Nenhum cache encontrado.
              </div>
            ) : (
              <>
                <AdminRow label="Status">
                  {(() => {
                    const tone = ageTone(view.data.ageHours);
                    const { cls, label } = TONE_BADGE[tone];
                    return (
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${cls}`}>
                        {label}
                      </span>
                    );
                  })()}
                </AdminRow>
                <AdminRow label="Idade">{ageLabel(view.data.ageHours)}</AdminRow>
                <AdminRow label="Salvo em">
                  {view.data.cachedAt ? new Date(view.data.cachedAt).toLocaleString("pt-BR") : "-"}
                </AdminRow>
                <AdminRow label="Schema version">v{view.data.cacheVersion ?? "?"}</AdminRow>
              </>
            )}
            <div className="px-4 py-2 text-[11px] text-zinc-600">
              Consultado as {view.fetchedAt.toLocaleTimeString("pt-BR")}
            </div>
          </div>
        )}

        {view.kind === "flushed" && (
          <AdminFeedback
            kind={view.result.ok ? "success" : "error"}
            message={view.result.message ?? view.result.error ?? ""}
            detail={view.result.rebuildTriggered
              ? "Rebuild disparado em background - pode levar 30-60s."
              : undefined}
          />
        )}
      </AdminCard>

      {/* actions */}
      <AdminCard title="Acoes">
        <div className="space-y-3">
          <AdminActionButton
            disabled={!isReady || view.kind === "loading"}
            onClick={() => void flush(true)}
            icon={<Zap size={15} className="text-indigo-300 shrink-0" />}
            label="Invalidar cache + rebuild imediato"
            desc="Apaga o cache e dispara /api/ics/agenda em background"
            tone="primary"
          />
          <AdminActionButton
            disabled={!isReady || view.kind === "loading"}
            onClick={() => void flush(false)}
            icon={<Trash2 size={15} className="text-zinc-400 shrink-0" />}
            label="So invalidar (sem rebuild)"
            desc="Rebuild acontece na proxima visita ao Radar"
            tone="neutral"
          />
        </div>
      </AdminCard>

      {/* TMDB Trending Feed toggle */}
      <AdminCard
        title="Feed TMDB Trending"
        desc="Liga/desliga o enriquecimento do Radar com trending/day, trending/week e airing_today da API TMDB."
      >
        {/* token + env status */}
        {tmdbData && (
          <div className="rounded-lg border border-white/10 divide-y divide-white/[0.06] mb-4">
            <AdminRow label="TMDB_ACCESS_TOKEN">
              <span className={tmdbData.token === "configurado" ? "text-emerald-300" : "text-rose-300"}>
                {tmdbData.token}
              </span>
            </AdminRow>
            <AdminRow label="Valor no .env">
              <span className={tmdbData.envEnabled ? "text-emerald-300" : "text-zinc-500"}>
                {tmdbData.envEnabled ? "true (ativo por padrao)" : "false (desligado por padrao)"}
              </span>
            </AdminRow>
            <AdminRow label="Estado atual">
              <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                tmdbData.enabled
                  ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/20"
                  : "bg-zinc-500/15 text-zinc-400 border-zinc-400/20"
              }`}>
                {tmdbData.enabled ? "Ligado" : "Desligado"}
                {tmdbData.source === "runtime_override" && " (runtime)"}
              </span>
            </AdminRow>
          </div>
        )}

        {/* feedback */}
        {tmdbView.kind === "loading"      && <AdminFeedback kind="loading" message="Consultando estado do feed..." />}
        {tmdbView.kind === "unauthorized" && <AdminFeedback kind="error"   message="Secret incorreto." />}
        {tmdbView.kind === "error"        && <AdminFeedback kind="error"   message={tmdbView.message} />}
        {tmdbView.kind === "toggled"      && (
          <AdminFeedback
            kind="success"
            message={tmdbView.message}
            detail="Invalide o cache e dispare rebuild para que a mudanca apareca no Radar."
          />
        )}

        {/* toggle actions */}
        <div className="mt-4 space-y-3">
          <AdminActionButton
            disabled={!isReady || tmdbView.kind === "loading" || tmdbData?.enabled === true}
            onClick={() => void toggleTmdbFeed(true)}
            icon={<TrendingUp size={15} className="text-emerald-300 shrink-0" />}
            label="Ligar feed TMDB"
            desc="Ativa o enriquecimento com trending/day + week + airing_today"
            tone="primary"
          />
          <AdminActionButton
            disabled={!isReady || tmdbView.kind === "loading" || tmdbData?.enabled === false}
            onClick={() => void toggleTmdbFeed(false)}
            icon={<Trash2 size={15} className="text-zinc-400 shrink-0" />}
            label="Desligar feed TMDB"
            desc="Desativa o enriquecimento - Radar usa apenas o Banco de Series"
            tone="neutral"
          />
          <AdminActionButton
            disabled={!isReady || tmdbView.kind === "loading"}
            onClick={() => void checkTmdbStatus()}
            icon={<RefreshCw size={13} className={`${tmdbView.kind === "loading" ? "animate-spin" : ""} shrink-0`} />}
            label="Recarregar status"
            desc="Consulta o estado atual sem alterar nada"
            tone="neutral"
          />
        </div>

        <p className="mt-4 text-[11px] text-zinc-600 leading-relaxed">
          Override runtime: dura enquanto o processo Node estiver ativo. Para persistencia, defina{" "}
          <code className="font-mono">ENABLE_TMDB_TRENDING_FEED=true</code> no{" "}
          <code className="font-mono">.env.local</code>.
        </p>
      </AdminCard>

    </div>
  );
}
