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
    accent: true,
  },
  {
    key: "watched",
    label: "Assistidos",
    caption: "Histórico pessoal",
    accent: false,
  },
  {
    key: "watchlist",
    label: "Watchlist",
    caption: "Para ver depois",
    accent: false,
  },
  {
    key: "watching",
    label: "Assistindo",
    caption: "Em andamento",
    accent: false,
  },
] as const;

export default function LibraryHero({ stats }: LibraryHeroProps) {
  return (
    <section className="relative w-full">
      <div className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.07] bg-white/[0.025] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:rounded-[1.75rem] sm:p-6 md:p-8 lg:rounded-[2rem] lg:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(129,140,248,0.18),transparent_34%),radial-gradient(circle_at_90%_20%,rgba(217,70,239,0.10),transparent_28%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />

        <div className="relative grid gap-6 xl:grid-cols-[1.1fr_0.9fr] xl:items-end">
          <div className="max-w-3xl">
            <div className="mb-3 flex items-center gap-2 md:mb-5">
              <span className="h-px w-5 rounded-full bg-indigo-300/80 sm:w-8" />
              <span className="text-[9.5px] font-bold uppercase tracking-[0.22em] text-indigo-200/80">
                Biblioteca
              </span>
            </div>

            <h1 className="text-2xl font-black tracking-[-0.04em] text-white sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl">
              Sua coleção pessoal de cinema.
            </h1>

            <p className="mt-3 max-w-2xl text-xs leading-5 text-white/45 sm:mt-4 sm:text-sm sm:leading-6 md:text-base md:leading-7">
              Filmes e séries salvos, vistos, abandonados ou deixados para depois.
              Uma biblioteca viva, organizada pelo seu próprio rastro de escolhas.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
            {STAT_CARDS.map((card) => (
              <StatCard
                key={card.key}
                label={card.label}
                caption={card.caption}
                value={stats[card.key]}
                accent={card.accent}
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
  accent?: boolean;
};

function StatCard({ label, caption, value, accent }: StatCardProps) {
  return (
    <div
      className={`rounded-2xl border px-4 py-3.5 ${
        accent
          ? "bg-violet-950/40 border-violet-500/20"
          : "bg-white/[0.025] border-white/[0.06]"
      }`}
    >
      <p
        className={`text-2xl font-black tracking-tight leading-none mb-1 ${
          accent ? "text-violet-200" : "text-white/80"
        }`}
      >
        {value}
      </p>
      <p className={`text-[10px] font-medium ${accent ? "text-violet-300/70" : "text-white/40"}`}>
        {label}
      </p>
      <p className={`text-[10px] mt-0.5 hidden sm:block ${accent ? "text-violet-400/50" : "text-white/25"}`}>
        {caption}
      </p>
    </div>
  );
}
