"use client";
import { uiMessage } from "@/lib/i18n/ui-message";
import { useState } from "react";
import { Activity, AlertTriangle, BookOpen, Database, History, ListChecks, ServerCog, Users } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { TabRadarCache } from "./tabs/TabRadarCache";
import { TabEngineMonitor } from "./tabs/TabEngineMonitor";
import { TabApiHistory } from "./tabs/TabApiHistory";
import { TabCatalogAdmin } from "./tabs/TabCatalogAdmin";
import { TabUsersAdmin } from "./tabs/TabUsersAdmin";
import { TabWorkersAdmin } from "./tabs/TabWorkersAdmin";
import { TabOperationsAdmin } from "./tabs/TabOperationsAdmin";
// ─── tabs ─────────────────────────────────────────────────────────────────────
type TabId = "operations" | "catalog" | "users" | "radar" | "workers" | "engine" | "api";
const TABS: {
    id: TabId;
    label: string;
    icon: React.ReactNode;
    desc: string;
}[] = [
    {
        id: "operations",
        label: uiMessage("admin.operations.label"),
        icon: <ServerCog size={15}/>,
        desc: uiMessage("admin.operations.desc"),
    },
    {
        id: "catalog",
        label: uiMessage("ui.d92b8115c4c9"),
        icon: <BookOpen size={15}/>,
        desc: "IMDb-first, assets, providers, overrides e rollback",
    },
    {
        id: "users",
        label: uiMessage("ui.5891b7e007e7"),
        icon: <Users size={15}/>,
        desc: uiMessage("ui.5aa1dd0def0b"),
    },
    {
        id: "radar",
        label: uiMessage("ui.1fee98d4e7eb"),
        icon: <Database size={15}/>,
        desc: uiMessage("ui.bd7a76234f22"),
    },
    {
        id: "workers",
        label: "Workers",
        icon: <ListChecks size={15}/>,
        desc: uiMessage("ui.20f32b306e08"),
    },
    {
        id: "engine",
        label: uiMessage("ui.d30d0f766455"),
        icon: <Activity size={15}/>,
        desc: uiMessage("ui.662e731d7b06"),
    },
    {
        id: "api",
        label: "API",
        icon: <History size={15}/>,
        desc: uiMessage("admin.api.desc"),
    },
];
// ─── component ────────────────────────────────────────────────────────────────
export default function AdminClient() {
    const [secret, setSecret] = useState("");
    const [activeTab, setActiveTab] = useState<TabId>("operations");
    const { user, loading } = useAuth();
    const hasAdminSession = user?.role === "admin" || user?.role === "master";
    return (<div className="min-h-screen px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">

        {/* ── header ── */}
        <header className="border-b border-white/10 pb-7">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-indigo-300/80">
            Poplog
          </p>
          <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">
            Admin
          </h1>
          <p className="mt-2 text-sm text-zinc-500">{uiMessage("ui.35f2ab991300")}</p>

          {/* secret global */}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:w-28 shrink-0">{uiMessage("ui.3cefe204cebd")}</label>
            <input type="password" placeholder="ADMIN_SECRET" value={secret} onChange={(e) => setSecret(e.target.value)} className="h-10 w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-400/40 focus:ring-1 focus:ring-indigo-400/20"/>
            {hasAdminSession && (<span className="flex items-center gap-1.5 text-xs text-emerald-300/80">
                {uiMessage("admin.access.session", { v1: user?.email ?? "" })}</span>)}
            {!hasAdminSession && !loading && !secret && (<span className="flex items-center gap-1.5 text-xs text-amber-400/80">
                <AlertTriangle size={12}/>{uiMessage("ui.7253e18d098f")}</span>)}
          </div>
        </header>

        {/* ── tab nav ── */}
        <nav className="mt-6 flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {TABS.map((tab) => (<button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${activeTab === tab.id
                ? "bg-indigo-500/20 text-indigo-100 border border-indigo-400/20 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"}`}>
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>))}
        </nav>

        {/* ── tab description ── */}
        <p className="mt-3 mb-7 text-xs text-zinc-600">
          {TABS.find((t) => t.id === activeTab)?.desc}
        </p>

        {/* ── tab content ── */}
        <div>
          {activeTab === "operations" && <TabOperationsAdmin secret={secret}/>}
          {activeTab === "catalog" && <TabCatalogAdmin secret={secret}/>}
          {activeTab === "users" && <TabUsersAdmin secret={secret}/>}
          {activeTab === "radar" && <TabRadarCache secret={secret}/>}
          {activeTab === "workers" && <TabWorkersAdmin secret={secret}/>}
          {activeTab === "engine" && <TabEngineMonitor secret={secret}/>}
          {activeTab === "api" && <TabApiHistory secret={secret}/>}
        </div>

      </div>
    </div>);
}
