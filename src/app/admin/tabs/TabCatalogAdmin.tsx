"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useMemo, useState } from "react";
import { ImageIcon, RefreshCw, RotateCcw, Save, Search } from "lucide-react";
import { AdminCard, AdminFeedback } from "../_components";
type AdminCatalogPayload = {
    ok: boolean;
    error?: string;
    locale: {
        language: string;
        region: string;
    };
    title: {
        id: string;
        imdbId: string | null;
        tmdbId: number;
        traktId: string | null;
        slug: string | null;
        mediaType: "movie" | "tv";
        title: string | null;
        originalTitle: string | null;
        year: number | null;
        posterUrl: string | null;
        backdropUrl: string | null;
        source: string;
        cacheStatus: string;
    } | null;
    translations: Array<Record<string, unknown>>;
    assets: Array<{
        id: string;
        type: string;
        language: string | null;
        region: string | null;
        assetKey: string | null;
        sourceUrl: string | null;
        publicUrl: string | null;
        width: number | null;
        height: number | null;
        source: string | null;
        isPrimary: boolean;
        isOverride: boolean;
    }>;
    providers: Array<{
        id: string;
        providerName: string;
        providerType: string;
        providerRegion: string;
        source: string;
        sourceConfidence: string;
        expiresAt: string;
    }>;
    overrides: Array<{
        id: string;
        field: string;
        language: string | null;
        region: string | null;
        valueJson: unknown;
        previousJson: unknown;
        active: boolean;
        reason: string | null;
        createdAt: string;
    }>;
    logs: Array<{
        id: string;
        action: string;
        field: string | null;
        actorUserId: string;
        cacheInvalidated: boolean;
        createdAt: string;
    }>;
    library: {
        usersWithTitle: number;
    };
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
    data: AdminCatalogPayload;
};
const FIELD_OPTIONS = ["poster", "title", "overview", "provider", "trailer", "tags", "aliases"];
export function TabCatalogAdmin({ secret }: {
    secret: string;
}) {
    const [imdbId, setImdbId] = useState("tt0993846");
    const [language, setLanguage] = useState("pt-BR");
    const [region, setRegion] = useState("BR");
    const [field, setField] = useState("poster");
    const [valueText, setValueText] = useState('{"assetKey":""}');
    const [reason, setReason] = useState("");
    const [view, setView] = useState<View>({ kind: "idle" });
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const isReady = secret.trim().length > 0 && /^tt\d+$/i.test(imdbId.trim());
    const posters = useMemo(() => view.kind === "ok" ? view.data.assets.filter((asset) => asset.type === "poster") : [], [view]);
    async function load() {
        if (!isReady)
            return;
        setActionMessage(null);
        setView({ kind: "loading" });
        const params = new URLSearchParams({ imdbId: imdbId.trim(), language, region });
        const res = await fetch(`/api/admin/catalog?${params}`, {
            headers: { "x-admin-secret": secret },
            cache: "no-store",
        });
        const data = await res.json().catch(() => null) as AdminCatalogPayload | null;
        if (!res.ok || !data?.ok) {
            setView({ kind: "error", message: data?.error ?? `HTTP ${res.status}` });
            return;
        }
        setView({ kind: "ok", data });
    }
    async function saveOverride() {
        let value: unknown;
        try {
            value = JSON.parse(valueText);
        }
        catch {
            setActionMessage(uiMessage("ui.92532bb59911"));
            return;
        }
        const res = await fetch("/api/admin/overrides", {
            method: "POST",
            headers: { "x-admin-secret": secret, "Content-Type": "application/json" },
            body: JSON.stringify({
                imdbId: imdbId.trim(),
                field,
                language,
                region,
                value,
                reason: reason.trim() || null,
            }),
        });
        const data = await res.json().catch(() => null) as {
            ok?: boolean;
            error?: string;
            cache?: {
                invalidated: number;
            };
        } | null;
        setActionMessage(data?.ok ? `Override salvo. Cache invalidado: ${data.cache?.invalidated ?? 0}.` : data?.error ?? `HTTP ${res.status}`);
        if (data?.ok)
            void load();
    }
    async function rollback(id: string) {
        const res = await fetch(`/api/admin/overrides/${id}/rollback`, {
            method: "POST",
            headers: { "x-admin-secret": secret, "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "Rollback via painel" }),
        });
        const data = await res.json().catch(() => null) as {
            ok?: boolean;
            error?: string;
            invalidated?: number;
        } | null;
        setActionMessage(data?.ok ? `Rollback aplicado. Cache invalidado: ${data.invalidated ?? 0}.` : data?.error ?? `HTTP ${res.status}`);
        if (data?.ok)
            void load();
    }
    async function selectPoster(assetId: string) {
        const res = await fetch(`/api/admin/assets/${imdbId.trim()}`, {
            method: "POST",
            headers: { "x-admin-secret": secret, "Content-Type": "application/json" },
            body: JSON.stringify({ assetId, language, region, reason: uiMessage("ui.08547620b5ee") }),
        });
        const data = await res.json().catch(() => null) as {
            ok?: boolean;
            error?: string;
            cache?: {
                invalidated: number;
            };
        } | null;
        setActionMessage(data?.ok ? uiMessage("ui.0083d01d3a46", { v1: data.cache?.invalidated ?? 0 }) : data?.error ?? `HTTP ${res.status}`);
        if (data?.ok)
            void load();
    }
    return (<div className="space-y-6">
      <AdminCard title={uiMessage("ui.d92b8115c4c9")} desc={uiMessage("ui.4b3256098982")}>
        <div className="grid gap-3 md:grid-cols-[1.2fr_0.7fr_0.5fr_auto]">
          <input value={imdbId} onChange={(event) => setImdbId(event.target.value)} placeholder="tt0993846" className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-indigo-400/40"/>
          <input value={language} onChange={(event) => setLanguage(event.target.value)} placeholder="pt-BR" className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-indigo-400/40"/>
          <input value={region} onChange={(event) => setRegion(event.target.value)} placeholder="BR" className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none focus:border-indigo-400/40"/>
          <button type="button" disabled={!isReady || view.kind === "loading"} onClick={() => void load()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-indigo-400/20 bg-indigo-500/20 px-4 text-sm font-semibold text-indigo-100 disabled:opacity-40">
            {view.kind === "loading" ? <RefreshCw size={14} className="animate-spin"/> : <Search size={14}/>}{uiMessage("ui.66f3415f4168")}</button>
        </div>
      </AdminCard>

      {actionMessage && <AdminFeedback kind={actionMessage.includes(uiMessage("ui.4a5f3e98aa4e")) || actionMessage.startsWith("HTTP") ? "error" : "success"} message={actionMessage}/>}
      {view.kind === "error" && <AdminFeedback kind="error" message={view.message}/>}
      {view.kind === "idle" && <p className="text-sm text-zinc-600">{uiMessage("ui.465935e1595d")}</p>}

      {view.kind === "ok" && (<>
          <AdminCard title={view.data.title?.title ?? uiMessage("ui.48efd80c60ce")} desc={uiMessage("ui.48cbb02e73b5", { v1: view.data.title?.mediaType ?? "-", v2: view.data.title?.year ?? "-", v3: view.data.library.usersWithTitle })}>
            <div className="grid gap-4 md:grid-cols-[120px_1fr]">
              <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
                {view.data.title?.posterUrl ? (
             
            <img src={view.data.title.posterUrl} alt="" className="h-full w-full object-cover"/>) : (<div className="flex h-full items-center justify-center text-xs text-zinc-600">{uiMessage("ui.d4c2c40cef75")}</div>)}
              </div>
              <div className="overflow-auto rounded-lg border border-white/10">
                <table className="min-w-full text-left text-xs">
                  <tbody className="divide-y divide-white/[0.05] text-zinc-300">
                    {[
                ["IMDb", view.data.title?.imdbId ?? imdbId],
                ["TMDB", view.data.title?.tmdbId ?? "-"],
                ["Trakt", view.data.title?.traktId ?? "-"],
                ["Slug", view.data.title?.slug ?? "-"],
                ["Fonte", view.data.title?.source ?? "-"],
                ["Cache", view.data.title?.cacheStatus ?? "-"],
            ].map(([label, value]) => (<tr key={label}>
                        <th className="w-32 bg-white/[0.03] px-3 py-2 font-bold uppercase tracking-[0.14em] text-zinc-500">{label}</th>
                        <td className="px-3 py-2 text-zinc-200">{String(value)}</td>
                      </tr>))}
                  </tbody>
                </table>
              </div>
            </div>
          </AdminCard>

          <AdminCard title={uiMessage("ui.a676ad477a61")} desc="Salva apenas o campo escolhido; rollback restaura o valor anterior quando existir.">
            <div className="grid gap-3 lg:grid-cols-[180px_1fr]">
              <select value={field} onChange={(event) => setField(event.target.value)} className="h-10 rounded-lg border border-white/10 bg-zinc-950 px-3 text-sm text-white outline-none">
                {FIELD_OPTIONS.map((option) => <option key={option}>{option}</option>)}
              </select>
              <input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Motivo" className="h-10 rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white outline-none"/>
            </div>
            <textarea value={valueText} onChange={(event) => setValueText(event.target.value)} rows={5} className="mt-3 w-full rounded-lg border border-white/10 bg-black/30 p-3 font-mono text-xs text-zinc-200 outline-none"/>
            <button type="button" disabled={!isReady} onClick={() => void saveOverride()} className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/15 px-4 text-sm font-semibold text-emerald-100 disabled:opacity-40">
              <Save size={14}/>{uiMessage("ui.6a9b6fcb6d11")}</button>
          </AdminCard>

          <AdminCard title={uiMessage("ui.e25f843e3e8b", { v1: posters.length })} desc={uiMessage("ui.8a40b64dac52")}>
            {posters.length === 0 ? (<p className="text-sm text-zinc-600">{uiMessage("ui.6f9327cf090e")}</p>) : (<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {posters.map((asset) => (<div key={asset.id} className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
                    <div className="relative aspect-[2/3] overflow-hidden rounded border border-white/10 bg-black/40">
                      {asset.publicUrl ? (
                     
                    <img src={asset.publicUrl} alt="" className="h-full w-full object-cover"/>) : (<div className="flex h-full items-center justify-center text-xs text-zinc-600">{uiMessage("ui.3cbb32f03f65")}</div>)}
                    </div>
                    <div className="mt-2 space-y-1 text-xs text-zinc-500">
                      <p className="truncate text-zinc-300">{asset.assetKey ?? asset.sourceUrl ?? asset.id}</p>
                      <p>{asset.language ?? "-"} · {asset.region ?? "-"} · {asset.width ?? "?"}x{asset.height ?? "?"}</p>
                      <p>{asset.source ?? "manual"} {asset.isPrimary ? uiMessage("ui.c32cf8713d8f") : ""} {asset.isOverride ? "· override" : ""}</p>
                    </div>
                    <button type="button" onClick={() => void selectPoster(asset.id)} className="mt-3 inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.05] text-xs font-semibold text-zinc-200 hover:bg-white/[0.08]">
                      <ImageIcon size={13}/>{uiMessage("ui.26f92e18010d")}</button>
                  </div>))}
              </div>)}
          </AdminCard>

          <AdminCard title={uiMessage("ui.aecba4a21d24", { v1: view.data.locale.region })} desc="Leitura do modelo normalizado local.">
            <CompactTable headers={["Provider", "Tipo", "Fonte", uiMessage("ui.687a318c19a2"), "Expira"]} rows={view.data.providers.map((provider) => [
                provider.providerName,
                provider.providerType,
                provider.source,
                provider.sourceConfidence,
                new Date(provider.expiresAt).toLocaleString("pt-BR"),
            ])}/>
          </AdminCard>

          <AdminCard title={uiMessage("ui.101889a7f2b8")}>
            <div className="space-y-2">
              {view.data.overrides.length === 0 ? (<p className="text-sm text-zinc-600">{uiMessage("ui.2dab74cbd0f6")}</p>) : view.data.overrides.map((override) => (<div key={override.id} className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-white">{override.field} {override.active ? <span className="text-emerald-300">ativo</span> : <span className="text-zinc-600">inativo</span>}</p>
                    <p className="text-xs text-zinc-500">{override.language ?? "-"} · {override.region ?? "-"} · {new Date(override.createdAt).toLocaleString("pt-BR")}</p>
                    <pre className="mt-2 max-h-24 overflow-auto rounded bg-black/30 p-2 text-[11px] text-zinc-400">{JSON.stringify(override.valueJson, null, 2)}</pre>
                  </div>
                  <button type="button" disabled={!override.active} onClick={() => void rollback(override.id)} className="inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-400/20 bg-rose-500/10 px-3 text-xs font-semibold text-rose-200 disabled:opacity-40">
                    <RotateCcw size={13}/>{uiMessage("ui.13931a582f3f")}</button>
                </div>))}
            </div>
          </AdminCard>

          <AdminCard title={uiMessage("ui.490f79b27c84")}>
            <CompactTable headers={[uiMessage("ui.d621dc82376b"), "Campo", "Ator", "Cache", "Quando"]} rows={view.data.logs.map((log) => [
                log.action,
                log.field ?? "-",
                log.actorUserId,
                log.cacheInvalidated ? "sim" : uiMessage("ui.23f93a61e395"),
                new Date(log.createdAt).toLocaleString("pt-BR"),
            ])}/>
          </AdminCard>
        </>)}
    </div>);
}
function CompactTable({ headers, rows }: {
    headers: string[];
    rows: Array<Array<string | number>>;
}) {
    if (!rows.length)
        return <p className="text-sm text-zinc-600">{uiMessage("ui.6b4e36a3c2ab")}</p>;
    return (<div className="overflow-auto rounded-lg border border-white/10">
      <table className="min-w-full text-left text-xs">
        <thead className="bg-white/[0.04] text-zinc-500">
          <tr>
            {headers.map((header) => (<th key={header} className="px-3 py-2 font-bold uppercase tracking-[0.14em]">{header}</th>))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.05] text-zinc-300">
          {rows.map((row, index) => (<tr key={index}>
              {row.map((cell, cellIndex) => (<td key={cellIndex} className="max-w-[18rem] truncate px-3 py-2">{cell}</td>))}
            </tr>))}
        </tbody>
      </table>
    </div>);
}

