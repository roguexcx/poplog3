export type LibraryTab =
  | "all"
  | "coming-soon"
  | "watchlist"
  | "watching"
  | "between-seasons"
  | "watched"
  | "abandoned"
  | "fridge";

type LibraryTabsProps = {
  activeTab: LibraryTab;
  onChange: (tab: LibraryTab) => void;
  stats: {
    total: number;
    comingSoon: number;
    watched: number;
    watchlist: number;
    watching: number;
    betweenSeasons: number;
  };
};

const TABS: {
  id: LibraryTab;
  label: string;
  shortLabel: string;
  description: string;
  getCount: (stats: LibraryTabsProps["stats"]) => number | null;
}[] = [
  {
    id: "all",
    label: "Tudo",
    shortLabel: "Tudo",
    description: "Toda sua coleção",
    getCount: (stats) => stats.total,
  },
  {
    id: "coming-soon",
    label: "Em breve",
    shortLabel: "Breve",
    description: "Títulos ainda não lançados",
    getCount: (stats) => stats.comingSoon,
  },
  {
    id: "watchlist",
    label: "Watchlist",
    shortLabel: "Lista",
    description: "Separados para depois",
    getCount: (stats) => stats.watchlist,
  },
  {
    id: "watching",
    label: "Assistindo",
    shortLabel: "Vendo",
    description: "Em andamento",
    getCount: (stats) => stats.watching,
  },
  {
    id: "between-seasons",
    label: "Entre temporadas",
    shortLabel: "Pausa",
    description: "Sem episódio novo agora",
    getCount: (stats) => stats.betweenSeasons,
  },
  {
    id: "watched",
    label: "Assistidos",
    shortLabel: "Vistos",
    description: "Histórico finalizado",
    getCount: (stats) => stats.watched,
  },
  {
    id: "abandoned",
    label: "Abandonados",
    shortLabel: "Dropados",
    description: "Ficaram pelo caminho",
    getCount: () => null,
  },
  {
    id: "fridge",
    label: "Geladeira",
    shortLabel: "Geladeira",
    description: "Guardados para outro clima",
    getCount: () => null,
  },
];

export default function LibraryTabs({
  activeTab,
  onChange,
  stats,
}: LibraryTabsProps) {
  const activeLabel =
    TABS.find((tab) => tab.id === activeTab)?.label ?? "Tudo";

  return (
    <>
      <div className="sm:hidden">
        <select
          value={activeTab}
          onChange={(event) => onChange(event.target.value as LibraryTab)}
          style={{ colorScheme: "dark" }}
          className="h-12 w-full appearance-none rounded-2xl border border-white/[0.09] bg-white/[0.045] px-4 text-sm font-black uppercase tracking-[0.12em] text-white outline-none backdrop-blur-xl [&_option]:bg-[#020617] [&_option]:text-white"
          aria-label={`Seção atual: ${activeLabel}`}
        >
          {TABS.map((tab) => {
            const count = tab.getCount(stats);
            return (
              <option key={tab.id} value={tab.id}>
                {tab.label}
                {typeof count === "number" ? ` · ${count}` : ""}
              </option>
            );
          })}
        </select>
      </div>

      <div className="hidden overflow-x-auto pb-1 no-scrollbar sm:block">
        <div className="flex min-w-max items-stretch gap-2">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const count = tab.getCount(stats);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChange(tab.id)}
                className={[
                  "group flex min-w-[150px] shrink-0 flex-col rounded-[1.25rem] border px-4 py-3 text-left transition duration-300",
                  active
                    ? "border-indigo-200/30 bg-indigo-300/[0.12] text-white shadow-[0_0_34px_rgba(99,102,241,0.14)]"
                    : "border-white/[0.075] bg-white/[0.028] text-white/52 hover:border-white/[0.15] hover:bg-white/[0.055] hover:text-white/82",
                ].join(" ")}
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="text-[10px] font-black uppercase tracking-[0.18em]">
                    {tab.shortLabel}
                  </span>

                  {typeof count === "number" && count > 0 && (
                    <span
                      className={[
                        "rounded-full border px-2 py-0.5 text-[10px] font-black",
                        active
                          ? "border-indigo-100/25 bg-white/10 text-indigo-50"
                          : "border-white/[0.08] bg-black/20 text-white/38",
                      ].join(" ")}
                    >
                      {count}
                    </span>
                  )}
                </span>

                <span
                  className={[
                    "mt-1 text-[11px] leading-4",
                    active ? "text-indigo-100/64" : "text-white/30 group-hover:text-white/44",
                  ].join(" ")}
                >
                  {tab.description}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
