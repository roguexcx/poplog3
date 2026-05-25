import { TmdbImageLegacy as TmdbImage } from "@/components/images/TmdbImage";
import type { Poplog3UserLibraryItem } from "@/server/library/library-service";

type LibraryHeroProps = {
  stats: {
    total: number;
    watched: number;
    watchlist: number;
    watching: number;
    movies?: number;
    series?: number;
  };
  spotlightItems?: Poplog3UserLibraryItem[];
};

const STAT_CARDS = [
  {
    key: "total",
    label: "Na biblioteca",
    caption: "Acervo total",
  },
  {
    key: "watching",
    label: "Em andamento",
    caption: "Continuidade ativa",
  },
  {
    key: "watchlist",
    label: "Watchlist",
    caption: "Para decidir depois",
  },
  {
    key: "watched",
    label: "Assistidos",
    caption: "Memória pessoal",
  },
] as const;

export default function LibraryHero({
  stats,
  spotlightItems = [],
}: LibraryHeroProps) {
  const heroItem =
    spotlightItems.find((item) => item.title?.backdrop_path) ??
    spotlightItems.find((item) => item.title?.poster_path) ??
    null;

  const heroTitle = heroItem?.title?.title ?? "Sua biblioteca POPLOG";
  const posters = spotlightItems
    .filter((item) => item.title?.poster_path)
    .slice(0, 5);

  return (
    <section className="relative w-full">
      <div className="relative min-h-[560px] overflow-hidden rounded-[2rem] border border-white/[0.08] bg-white/[0.025] shadow-[0_32px_120px_rgba(0,0,0,0.58)] backdrop-blur-xl md:min-h-[620px] lg:rounded-[2.5rem]">
        <div className="absolute inset-0">
          {heroItem?.title && (
            <TmdbImage
              path={heroItem.title.backdrop_path ?? heroItem.title.poster_path}
              fallbackPath={heroItem.title.poster_path ?? null}
              size="w1280"
              alt={heroTitle}
              fallbackLabel={heroTitle}
              className="h-full w-full object-cover opacity-48 blur-[1px] scale-105 saturate-[1.08]"
            />
          )}

          <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(3,4,10,0.96)_0%,rgba(3,4,10,0.78)_38%,rgba(3,4,10,0.34)_68%,rgba(3,4,10,0.88)_100%)]" />
          <div className="absolute inset-0 bg-[linear-gradient(to_top,rgba(3,4,10,0.96)_0%,rgba(3,4,10,0.44)_48%,rgba(3,4,10,0.62)_100%)]" />
          <div className="absolute left-[-8%] top-[-16%] h-[34rem] w-[34rem] rounded-full bg-indigo-500/24 blur-[120px]" />
          <div className="absolute right-[-10%] bottom-[-12%] h-[32rem] w-[32rem] rounded-full bg-fuchsia-500/16 blur-[120px]" />
        </div>

        <div className="relative grid min-h-[560px] gap-8 p-5 sm:p-7 md:min-h-[620px] md:p-9 lg:grid-cols-[1.05fr_0.95fr] lg:items-end lg:p-12">
          <div className="flex h-full max-w-4xl flex-col justify-end">
            <div className="mb-5 flex items-center gap-3">
              <span className="h-px w-10 rounded-full bg-cyan-200/80" />
              <span className="text-[10px] font-black uppercase tracking-[0.28em] text-cyan-100/78">
                Biblioteca
              </span>
            </div>

            <h1 className="max-w-4xl text-4xl font-black leading-[0.92] tracking-[-0.065em] text-white sm:text-6xl md:text-7xl lg:text-8xl">
              Sua coleção como um universo vivo.
            </h1>

            <p className="mt-5 max-w-2xl text-sm leading-7 text-white/58 md:text-base">
              A Biblioteca deixa de ser só uma grade de pôsteres e passa a funcionar como o centro visual do seu acervo: watchlist, assistidos, séries em andamento, pausas e memória pessoal conectadas ao mesmo ecossistema de Título e Acompanhando.
            </p>

            <div className="mt-7 grid max-w-3xl grid-cols-2 gap-3 sm:grid-cols-4">
              {STAT_CARDS.map((card) => (
                <StatCard
                  key={card.key}
                  label={card.label}
                  caption={card.caption}
                  value={stats[card.key] ?? 0}
                />
              ))}
            </div>
          </div>

          <div className="relative hidden min-h-[520px] lg:block">
            <div className="absolute bottom-6 right-2 h-[470px] w-[360px] rounded-[2rem] border border-white/[0.08] bg-white/[0.035] shadow-[0_28px_100px_rgba(0,0,0,0.55)] backdrop-blur-xl" />

            {posters.map((item, index) => {
              const offsets = [
                "right-28 bottom-20 rotate-[-9deg] z-20",
                "right-4 bottom-28 rotate-[7deg] z-30",
                "right-48 bottom-8 rotate-[-16deg] z-10",
                "right-16 bottom-2 rotate-[13deg] z-0",
                "right-60 bottom-36 rotate-[-4deg] z-0 opacity-75",
              ];

              const title =
                item.title?.title ??
                item.title?.original_title ??
                `${item.media_type}/${item.tmdb_id}`;

              return (
                <div
                  key={item.id}
                  className={`absolute w-[190px] overflow-hidden rounded-[1.45rem] border border-white/[0.1] bg-white/[0.04] shadow-[0_30px_90px_rgba(0,0,0,0.62)] ${offsets[index]}`}
                >
                  <div className="relative aspect-[2/3]">
                    <TmdbImage
                      path={item.title?.poster_path ?? null}
                      fallbackPath={item.title?.backdrop_path ?? null}
                      size="w500"
                      alt={title}
                      fallbackLabel={title}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
                  </div>
                </div>
              );
            })}

            <div className="absolute bottom-12 right-10 z-40 w-[320px] rounded-[1.75rem] border border-white/[0.1] bg-black/45 p-4 shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl">
              <p className="text-[10px] font-black uppercase tracking-[0.24em] text-white/42">
                Acervo inteligente
              </p>
              <h2 className="mt-2 line-clamp-2 text-2xl font-black tracking-[-0.04em] text-white">
                {heroTitle}
              </h2>
              <p className="mt-3 text-xs leading-5 text-white/48">
                O destaque visual nasce dos títulos reais da sua coleção, sem criar uma lógica paralela.
              </p>
            </div>
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
    <div className="rounded-[1.35rem] border border-white/[0.08] bg-white/[0.045] px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
      <p className="text-3xl font-black leading-none tracking-[-0.04em] text-white">
        {value}
      </p>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.18em] text-white/64">
        {label}
      </p>
      <p className="mt-1 hidden text-[11px] text-white/34 sm:block">
        {caption}
      </p>
    </div>
  );
}
