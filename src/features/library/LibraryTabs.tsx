import { uiMessage } from "@/lib/i18n/ui-message";
export type LibraryTab = "random" | "watchlist" | "favorites" | "watching" | "coming-soon" | "watched" | "all" | "abandoned" | "fridge";
type LibraryTabsProps = {
    activeTab: LibraryTab;
    onChange: (tab: LibraryTab) => void;
    stats: {
        total: number;
        comingSoon: number;
        watched: number;
        watchlist: number;
        watching: number;
        favorites: number;
    };
};
const TABS: {
    id: LibraryTab;
    shortLabel: string;
    description: string;
    getCount: (s: LibraryTabsProps["stats"]) => number | null;
}[] = [
    { id: "watchlist", shortLabel: "Watchlist", description: uiMessage("ui.4c37e5977dcb"), getCount: (s) => s.watchlist },
    { id: "favorites", shortLabel: uiMessage("ui.33b332595fe4"), description: uiMessage("ui.a5e7719ccdc8"), getCount: (s) => s.favorites },
    { id: "watching", shortLabel: "Maratonando", description: uiMessage("ui.5ca3739c28b7"), getCount: (s) => s.watching },
    { id: "coming-soon", shortLabel: "Em Breve", description: uiMessage("ui.c2a8d2ebb28e"), getCount: (s) => s.comingSoon },
    { id: "watched", shortLabel: uiMessage("ui.454ea6968d53"), description: uiMessage("ui.d3b117a5c4a8"), getCount: (s) => s.watched },
    { id: "all", shortLabel: "Tudo", description: uiMessage("ui.2e6069c318cf"), getCount: (s) => s.total },
    { id: "abandoned", shortLabel: "Abandonados", description: uiMessage("ui.0d7561c5b9a6"), getCount: () => null },
    { id: "fridge", shortLabel: "Geladeira", description: uiMessage("ui.941160072235"), getCount: () => null },
];
export default function LibraryTabs({ activeTab, onChange, stats }: LibraryTabsProps) {
    const activeLabel = TABS.find((t) => t.id === activeTab)?.shortLabel ?? "Tudo";
    return (<>
      {/* Mobile: select nativo */}
      <div className="sm:hidden">
        <select value={activeTab} onChange={(e) => onChange(e.target.value as LibraryTab)} style={{ colorScheme: "dark" }} className="h-11 w-full appearance-none rounded-2xl border border-white/[0.08] bg-white/[0.035] px-4 text-sm font-medium uppercase tracking-wide text-white outline-none backdrop-blur-xl [&_option]:bg-[#0d0d14] [&_option]:text-white" aria-label={uiMessage("ui.1c3fec71b133", { v1: activeLabel })}>
          {TABS.map((tab) => {
            const count = tab.getCount(stats);
            return (<option key={tab.id} value={tab.id}>
                {tab.shortLabel}{typeof count === "number" ? ` · ${count}` : ""}
              </option>);
        })}
        </select>
      </div>

      {/* Desktop: tab bar — 64px height */}
      <div className="hidden overflow-x-auto no-scrollbar sm:flex sm:h-16 sm:items-stretch sm:justify-center">
        {TABS.map((tab, index) => {
            const active = activeTab === tab.id;
            const count = tab.getCount(stats);
            return (<button key={tab.id} type="button" onClick={() => onChange(tab.id)} className={[
                    "relative flex flex-col justify-center px-[18px] transition duration-200",
                    "border-b-2",
                    active
                        ? "border-indigo-500 bg-white/[0.08]"
                        : "border-transparent hover:bg-white/[0.05]",
                ].join(" ")}>
              {/* Separador vertical (exceto no último) */}
              {index < TABS.length - 1 && (<div className="absolute right-0 top-3 h-[calc(100%-24px)] w-px bg-white/[0.06]"/>)}

              {/* Label + badge */}
              <div className="flex items-center gap-1.5">
                <span className={[
                    "whitespace-nowrap text-[11px] font-medium uppercase tracking-wide",
                    active ? "text-white" : "text-white/45",
                ].join(" ")}>
                  {tab.shortLabel}
                </span>

                {typeof count === "number" && count > 0 && (<span className={[
                        "rounded-full px-[5px] py-px text-[9px] font-medium leading-none tabular-nums",
                        active
                            ? "bg-indigo-500/25 text-indigo-200"
                            : "bg-white/[0.08] text-white/38",
                    ].join(" ")}>
                    {count}
                  </span>)}
              </div>

              {/* Subtítulo */}
              <span className={[
                    "mt-0.5 whitespace-nowrap text-[10px] leading-none",
                    active ? "text-white/48" : "text-white/28",
                ].join(" ")}>
                {tab.description}
              </span>
            </button>);
        })}
      </div>
    </>);
}

