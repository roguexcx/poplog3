"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useState } from "react";
import { Lock, RefreshCw, Shield, Unlock, Users } from "lucide-react";
import { AdminCard, AdminFeedback, StatCard } from "../_components";
type UsersPayload = {
    ok: boolean;
    error?: string;
    admin: {
        actorUserId: string;
        master: boolean;
        role: string | null;
        permissions: string[];
    };
    capabilities: {
        listUsers: boolean;
        blockUsers: boolean;
        roles: string[];
        permissions: string[];
    };
    users: Array<{
        id: string;
        email: string | null;
        name: string | null;
        username: string | null;
        image: string | null;
        role: "user" | "admin" | "master";
        accessStatus: "active" | "blocked";
        blockedAt: string | null;
        blockedReason: string | null;
        adminPermissions: string[];
        lastAdminActionAt: string | null;
        createdAt: string;
        updatedAt: string;
        _count: {
            accounts: number;
            sessions: number;
            userTitles: number;
            userEvents: number;
            userStreamingPreferences: number;
        };
    }>;
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
    data: UsersPayload;
    fetchedAt: Date;
};
export function TabUsersAdmin({ secret }: {
    secret: string;
}) {
    const [view, setView] = useState<View>({ kind: "idle" });
    const [actionMessage, setActionMessage] = useState<string | null>(null);
    const [busyUserId, setBusyUserId] = useState<string | null>(null);
    const isReady = secret.trim().length > 0;
    async function load() {
        if (!isReady)
            return;
        setView({ kind: "loading" });
        const res = await fetch("/api/admin/users?limit=80", {
            headers: { "x-admin-secret": secret },
            cache: "no-store",
        });
        const data = await res.json().catch(() => null) as UsersPayload | null;
        if (!res.ok || !data?.ok) {
            setView({ kind: "error", message: data?.error ?? `HTTP ${res.status}` });
            return;
        }
        setView({ kind: "ok", data, fetchedAt: new Date() });
    }
    async function patchUser(input: {
        userId: string;
        action: "block" | "reactivate" | "setRole" | "setPermissions";
        role?: "user" | "admin" | "master";
        permissions?: string[];
        reason?: string;
    }) {
        setBusyUserId(input.userId);
        setActionMessage(null);
        const res = await fetch("/api/admin/users", {
            method: "PATCH",
            headers: { "x-admin-secret": secret, "Content-Type": "application/json" },
            body: JSON.stringify(input),
        });
        const data = await res.json().catch(() => null) as {
            ok?: boolean;
            error?: string;
        } | null;
        setBusyUserId(null);
        if (!res.ok || !data?.ok) {
            setActionMessage(data?.error ?? `HTTP ${res.status}`);
            return;
        }
        setActionMessage(uiMessage("ui.a8a4fd7ec4be"));
        void load();
    }
    return (<div className="space-y-6">
      <AdminCard title={uiMessage("ui.5891b7e007e7")} desc={uiMessage("ui.1625d4ac3a1b")}>
        <button type="button" disabled={!isReady || view.kind === "loading"} onClick={() => void load()} className="inline-flex h-9 items-center gap-2 rounded-lg border border-indigo-400/20 bg-indigo-500/20 px-4 text-sm font-semibold text-indigo-100 disabled:opacity-40">
          {view.kind === "loading" ? <RefreshCw size={14} className="animate-spin"/> : <Users size={14}/>}{uiMessage("ui.a0b7d5ae55e3")}</button>
      </AdminCard>

      {view.kind === "idle" && <p className="text-sm text-zinc-600">{uiMessage("ui.2e6de5ce8bf8")}</p>}
      {view.kind === "error" && <AdminFeedback kind="error" message={view.message}/>}
      {actionMessage && (<AdminFeedback kind={actionMessage.startsWith("HTTP") || actionMessage.includes(uiMessage("ui.c01b9403c8f7")) ? "error" : "success"} message={actionMessage}/>)}

      {view.kind === "ok" && (<>
          <div className="grid gap-3 md:grid-cols-3">
            <StatCard label={uiMessage("ui.5891b7e007e7")} value={String(view.data.users.length)} icon={<Users size={15} className="text-indigo-300"/>}/>
            <StatCard label="Admin" value={view.data.admin.master ? "Master" : "Inativo"} sub={view.data.admin.actorUserId} icon={<Shield size={15} className="text-emerald-300"/>} tone={view.data.admin.master ? "good" : "bad"}/>
            <StatCard label={uiMessage("ui.bed37b43245f")} value={String(view.data.admin.permissions.length)} sub={view.data.admin.permissions.join(", ")} icon={<Shield size={15} className="text-zinc-400"/>}/>
          </div>

          <AdminCard title="Listagem">
            <div className="overflow-auto rounded-lg border border-white/10">
              <table className="min-w-full text-left text-xs">
                <thead className="bg-white/[0.04] text-zinc-500">
                  <tr>
                    {[uiMessage("ui.f32c134523d4"), "Status", "Role", "Email", uiMessage("ui.497ac5c11bf3"), uiMessage("ui.06ce174485a6"), "Eventos", "Criado", uiMessage("ui.66c341b3e963")].map((header) => (<th key={header} className="px-3 py-2 font-bold uppercase tracking-[0.14em]">{header}</th>))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.05] text-zinc-300">
                  {view.data.users.map((user) => (<tr key={user.id}>
                      <td className="px-3 py-2">
                        <p className="font-bold text-white">{user.username ?? user.name ?? user.id}</p>
                        <p className="text-[11px] text-zinc-600">{user.id}</p>
                      </td>
                      <td className="px-3 py-2">
                        <span className={[
                    "rounded-full border px-2 py-1 text-[10px] font-black uppercase tracking-[0.12em]",
                    user.accessStatus === "blocked"
                        ? "border-rose-300/25 bg-rose-500/10 text-rose-100"
                        : "border-emerald-300/25 bg-emerald-500/10 text-emerald-100",
                ].join(" ")}>
                          {user.accessStatus === "blocked" ? "Bloqueado" : "Ativo"}
                        </span>
                        {user.blockedReason && <p className="mt-1 max-w-[220px] text-[11px] text-zinc-500">{user.blockedReason}</p>}
                      </td>
                      <td className="px-3 py-2">
                        <select value={user.role} disabled={busyUserId === user.id} onChange={(event) => void patchUser({
                    userId: user.id,
                    action: "setRole",
                    role: event.target.value as "user" | "admin" | "master",
                    reason: uiMessage("ui.811ec711ecdd"),
                })} className="h-8 rounded-md border border-white/10 bg-zinc-950 px-2 text-xs text-white">
                          {view.data.capabilities.roles.map((role) => <option key={role}>{role}</option>)}
                        </select>
                        {user.adminPermissions.length > 0 && (<p className="mt-1 max-w-[240px] truncate text-[11px] text-zinc-500">{user.adminPermissions.join(", ")}</p>)}
                      </td>
                      <td className="px-3 py-2">{user.email ?? "-"}</td>
                      <td className="px-3 py-2">{user._count.userTitles}</td>
                      <td className="px-3 py-2">{user._count.sessions}</td>
                      <td className="px-3 py-2">{user._count.userEvents}</td>
                      <td className="px-3 py-2">{new Date(user.createdAt).toLocaleDateString("pt-BR")}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {user.accessStatus === "blocked" ? (<button type="button" disabled={busyUserId === user.id} onClick={() => void patchUser({ userId: user.id, action: "reactivate", reason: uiMessage("ui.7acf2976fb40") })} className="inline-flex h-8 items-center gap-1 rounded-md border border-emerald-300/20 bg-emerald-500/10 px-2 text-[11px] font-bold text-emerald-100 disabled:opacity-40">
                              <Unlock size={12}/> Reativar
                            </button>) : (<button type="button" disabled={busyUserId === user.id} onClick={() => void patchUser({ userId: user.id, action: "block", reason: "Bloqueio via painel" })} className="inline-flex h-8 items-center gap-1 rounded-md border border-rose-300/20 bg-rose-500/10 px-2 text-[11px] font-bold text-rose-100 disabled:opacity-40">
                              <Lock size={12}/> Bloquear
                            </button>)}
                          <button type="button" disabled={busyUserId === user.id} onClick={() => void patchUser({
                    userId: user.id,
                    action: "setPermissions",
                    permissions: view.data.capabilities.permissions,
                    reason: uiMessage("ui.b015ccc78db6"),
                })} className="inline-flex h-8 items-center gap-1 rounded-md border border-indigo-300/20 bg-indigo-500/10 px-2 text-[11px] font-bold text-indigo-100 disabled:opacity-40">
                            <Shield size={12}/>{uiMessage("ui.bed37b43245f")}</button>
                        </div>
                      </td>
                    </tr>))}
                </tbody>
              </table>
            </div>
          </AdminCard>
        </>)}
    </div>);
}

