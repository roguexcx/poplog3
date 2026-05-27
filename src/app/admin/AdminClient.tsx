"use client";

import { useState } from "react";
import { Activity, AlertTriangle, Database } from "lucide-react";
import { TabRadarCache } from "./tabs/TabRadarCache";
import { TabEngineMonitor } from "./tabs/TabEngineMonitor";

// ─── tabs ─────────────────────────────────────────────────────────────────────

type TabId = "radar" | "engine";

const TABS: { id: TabId; label: string; icon: React.ReactNode; desc: string }[] = [
  {
    id: "radar",
    label: "Radar Cache",
    icon: <Database size={15} />,
    desc: "Status e flush do cache da Agenda/Radar",
  },
  {
    id: "engine",
    label: "Engine Monitor",
    icon: <Activity size={15} />,
    desc: "Hit rate, latências e log de chamadas às APIs externas",
  },
];

// ─── component ────────────────────────────────────────────────────────────────

export default function AdminClient() {
  const [secret, setSecret] = useState("");
  const [activeTab, setActiveTab] = useState<TabId>("radar");

  return (
    <div className="min-h-screen px-5 py-8 sm:px-8 lg:px-12">
      <div className="mx-auto max-w-7xl">

        {/* ── header ── */}
        <header className="border-b border-white/10 pb-7">
          <p className="text-xs font-bold uppercase tracking-[0.28em] text-indigo-300/80">
            Poplog
          </p>
          <h1 className="mt-3 text-3xl font-black text-white sm:text-4xl">
            Admin
          </h1>
          <p className="mt-2 text-sm text-zinc-500">
            Painel centralizado de diagnóstico e operações administrativas.
          </p>

          {/* secret global */}
          <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="text-xs font-semibold uppercase tracking-widest text-zinc-500 sm:w-28 shrink-0">
              Admin Secret
            </label>
            <input
              type="password"
              placeholder="ADMIN_SECRET"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="h-10 w-full max-w-sm rounded-lg border border-white/10 bg-white/[0.06] px-3 text-sm text-white placeholder-zinc-500 outline-none focus:border-indigo-400/40 focus:ring-1 focus:ring-indigo-400/20"
            />
            {!secret && (
              <span className="flex items-center gap-1.5 text-xs text-amber-400/80">
                <AlertTriangle size={12} />
                Necessário para ações protegidas
              </span>
            )}
          </div>
        </header>

        {/* ── tab nav ── */}
        <nav className="mt-6 flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-indigo-500/20 text-indigo-100 border border-indigo-400/20 shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.04]"
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* ── tab description ── */}
        <p className="mt-3 mb-7 text-xs text-zinc-600">
          {TABS.find((t) => t.id === activeTab)?.desc}
        </p>

        {/* ── tab content ── */}
        <div>
          {activeTab === "radar"  && <TabRadarCache  secret={secret} />}
          {activeTab === "engine" && <TabEngineMonitor secret={secret} />}
        </div>

      </div>
    </div>
  );
}
