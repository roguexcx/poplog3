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
        <label className="mb-1.5 block text-[9px] font-black uppercase tracking-[0.18em] text-white/32">
          Seção
        </label>

        <select
          value={activeTab}
          onChange={(event) => onChange(event.target.value as LibraryTab)}
          style={{ colorScheme: "dark" }}
          className="h-11 w-full appearance-none rounded-2xl border border-white/[0.1] bg-[#020617] px-4 text-sm font-black uppercase tracking-[0.12em] text-white outline-none [&_option]:bg-[#020617] [&_option]:text-white"
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
        <div className="flex min-w-max items-center justify-center gap-3">
          {TABS.map((tab) => {
            const active = activeTab === tab.id;
            const count = tab.getCount(stats);

            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onChange(tab.id)}
                className={[
                  "group relative shrink-0 overflow-hidden rounded-2xl border px-4 py-3 text-left transition duration-300",
                  "min-w-[136px] sm:min-w-[156px]",
                  active
                    ? "border-indigo-300/35 bg-indigo-400/[0.13] text-white shadow-[0_16px_50px_rgba(79,70,229,0.18)]"
                    : "border-white/[0.08] bg-white/[0.035] text-white/52 hover:border-white/[0.15] hover:bg-white/[0.06] hover:text-white/82",
                ].join(" ")}
              >
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.08] via-transparent to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />

                <div className="relative">
                  <div className="flex items-center justify-between gap-3">
                    <span className="hidden text-xs font-black uppercase tracking-[0.16em] sm:inline">
                      {tab.label}
                    </span>

                    <span className="text-xs font-black uppercase tracking-[0.16em] sm:hidden">
                      {tab.shortLabel}
                    </span>

                    {typeof count === "number" && (
                      <span
                        className={[
                          "rounded-full border px-2 py-0.5 text-[10px] font-black",
                          active
                            ? "border-indigo-200/30 bg-white/10 text-indigo-50"
                            : "border-white/[0.08] bg-black/20 text-white/38",
                        ].join(" ")}
                      >
                        {count}
                      </span>
                    )}
                  </div>

                  <p
                    className={[
                      "mt-1.5 hidden text-[11px] leading-relaxed sm:block",
                      active ? "text-indigo-100/62" : "text-white/34",
                    ].join(" ")}
                  >
                    {tab.description}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}