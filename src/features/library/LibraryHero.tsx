type LibraryHeroProps = {
  stats: {
    total: number;
    watched: number;
    watchlist: number;
    watching: number;
  };
};

const STAT_CARDS = [
  {
    key: "total",
    label: "Na biblioteca",
    caption: "Títulos salvos",
  },
  {
    key: "watched",
    label: "Assistidos",
    caption: "Histórico pessoal",
  },
  {
    key: "watchlist",
    label: "Watchlist",
    caption: "Para ver depois",
  },
  {
    key: "watching",
    label: "Assistindo",
    caption: "Em andamento",
  },
] as const;

export default function LibraryHero({ stats }: LibraryHeroProps) {
  return (
    <section className="relative w-full">
      <div className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:rounded-[1.75rem] sm:p-6 md:p-8 lg:rounded-[2rem] lg:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_90%_20%,rgba(217,70,239,0.10),transparent_28%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        <div className="relative grid gap-4 sm:gap-5 md:gap-7 xl:grid-cols-[1.1fr_0.9fr] xl:items-end">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 sm:mb-3 md:mb-5">
              <span className="h-px w-6 bg-indigo-300/80 sm:w-8 md:w-10" />
              <span className="text-[8px] font-black uppercase tracking-[0.22em] text-indigo-200/80 sm:text-[9px] md:text-[10px] md:tracking-[0.28em]">
                POPLOG LIBRARY
              </span>
            </div>

            <h1 className="max-w-4xl text-2xl font-black tracking-[-0.05em] text-white sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl">
              Sua coleção pessoal de cinema.
            </h1>

            <p className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5 text-white/54 sm:mt-3 sm:text-sm sm:leading-6 md:mt-5 md:text-[17px] md:leading-7">
              Filmes e séries salvos, vistos, abandonados ou deixados
              para depois. Uma biblioteca viva, organizada pelo seu
              próprio rastro de escolhas.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 sm:grid-cols-2 sm:gap-3 md:gap-4">
            {STAT_CARDS.map((card) => (
              <StatCard
                key={card.key}
                label={card.label}
                caption={card.caption}
                value={stats[card.key]}
              />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

type StatCardProps = {
  label: string;
  caption: string;
  value: number;
};

function StatCard({ label, caption, value }: StatCardProps) {
  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/20 p-2.5 transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-white/[0.055] sm:rounded-2xl sm:p-4 md:p-5">
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.055] via-transparent to-transparent opacity-0 transition duration-300 group-hover:opacity-100" />

      <div className="relative">
        <p className="truncate text-[7px] font-bold uppercase tracking-[0.12em] text-white/38 sm:text-[10px] sm:tracking-[0.18em]">
          {label}
        </p>

        <div className="mt-1 flex items-end gap-2 sm:mt-2 md:mt-3">
          <span className="text-lg font-black tracking-[-0.04em] text-white sm:text-3xl md:text-4xl">
            {value}
          </span>
        </div>

        <p className="mt-1 hidden text-xs leading-relaxed text-white/38 sm:block">
          {caption}
        </p>
      </div>
    </div>
  );
}