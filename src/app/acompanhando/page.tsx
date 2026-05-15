import PageShell from "@/components/layout/PageShell";

import LibraryEmptyState from "@/features/library/LibraryEmptyState";
import LibraryGrid from "@/features/library/LibraryGrid";
import { getCurrentUser } from "@/server/auth/get-current-user";
import {
  getUserLibrary,
  type Poplog3UserLibraryItem,
} from "@/server/library/library-service";

async function getAcompanhandoData() {
  const user = await getCurrentUser();

  if (!user) {
    return { watching: [] as Poplog3UserLibraryItem[], abandoned: 0 };
  }

  const all = await getUserLibrary(user.id);

  const watching = all.filter((item) => item.status === "watching");
  const abandoned = all.filter((item) => item.status === "abandoned").length;

  return { watching, abandoned };
}

export default async function AcompanhandoPage() {
  const { watching, abandoned } = await getAcompanhandoData();

  return (
    <PageShell variant="wide">
      <div className="flex flex-col gap-8 sm:gap-10 md:gap-12">
        <AcompanhandoHero
          inProgress={watching.length}
          abandoned={abandoned}
        />

        <section className="flex flex-col gap-4 sm:gap-5 md:gap-6">
          <div className="flex items-baseline justify-between gap-4">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/70 sm:text-[11px]">
                Em andamento
              </p>
              <h2 className="mt-1.5 text-xl font-black tracking-[-0.03em] text-white sm:text-2xl md:text-3xl">
                O que você está assistindo agora
              </h2>
            </div>

            {watching.length > 0 && (
              <span className="text-xs font-semibold text-white/40 sm:text-sm">
                {watching.length}{" "}
                {watching.length === 1 ? "título" : "títulos"}
              </span>
            )}
          </div>

          {watching.length > 0 ? (
            <LibraryGrid items={watching} />
          ) : (
            <LibraryEmptyState activeTab="watching" />
          )}
        </section>

        <NextEpisodesPreview />
      </div>
    </PageShell>
  );
}

type AcompanhandoHeroProps = {
  inProgress: number;
  abandoned: number;
};

function AcompanhandoHero({
  inProgress,
  abandoned,
}: AcompanhandoHeroProps) {
  return (
    <section className="relative w-full">
      <div className="relative overflow-hidden rounded-[1.25rem] border border-white/[0.08] bg-white/[0.035] p-4 shadow-[0_18px_60px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:rounded-[1.75rem] sm:p-6 md:p-8 lg:rounded-[2rem] lg:p-10">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_0%,rgba(34,211,238,0.18),transparent_36%),radial-gradient(circle_at_92%_30%,rgba(99,102,241,0.14),transparent_30%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />

        <div className="relative grid gap-4 sm:gap-5 md:gap-7 xl:grid-cols-[1.15fr_0.85fr] xl:items-end">
          <div className="max-w-3xl">
            <div className="mb-2 flex items-center gap-2 sm:mb-3 md:mb-5">
              <span className="h-px w-6 bg-cyan-300/80 sm:w-8 md:w-10" />
              <span className="text-[8px] font-black uppercase tracking-[0.22em] text-cyan-200/80 sm:text-[9px] md:text-[10px] md:tracking-[0.28em]">
                POPLOG ACOMPANHANDO
              </span>
            </div>

            <h1 className="max-w-4xl text-2xl font-black tracking-[-0.05em] text-white sm:text-4xl md:text-5xl lg:text-6xl xl:text-7xl">
              O que faz sentido assistir agora.
            </h1>

            <p className="mt-2 line-clamp-2 max-w-2xl text-xs leading-5 text-white/54 sm:mt-3 sm:text-sm sm:leading-6 md:mt-5 md:text-[17px] md:leading-7">
              Seu painel pessoal de continuidade. Séries em curso, filmes
              pausados, retomadas inteligentes e o próximo episódio
              esperando você.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:gap-3 md:gap-4">
            <HeroStat
              label="Em andamento"
              value={inProgress}
              caption="Séries e filmes assistindo"
              accent="cyan"
            />
            <HeroStat
              label="Em pausa"
              value={abandoned}
              caption="Pode voltar quando quiser"
              accent="indigo"
            />
          </div>
        </div>
      </div>
    </section>
  );
}

type HeroStatProps = {
  label: string;
  value: number;
  caption: string;
  accent: "cyan" | "indigo";
};

function HeroStat({ label, value, caption, accent }: HeroStatProps) {
  const ring =
    accent === "cyan"
      ? "from-cyan-300/0 via-cyan-300/0 to-cyan-300/0 group-hover:via-cyan-300/40"
      : "from-indigo-300/0 via-indigo-300/0 to-indigo-300/0 group-hover:via-indigo-300/40";

  return (
    <div className="group relative overflow-hidden rounded-xl border border-white/[0.08] bg-black/20 p-2.5 transition duration-300 hover:-translate-y-0.5 hover:border-white/[0.16] hover:bg-white/[0.055] sm:rounded-2xl sm:p-4 md:p-5">
      <div
        className={`pointer-events-none absolute inset-x-0 -top-px h-px bg-gradient-to-r ${ring} transition duration-300`}
      />
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

function NextEpisodesPreview() {
  return (
    <section className="relative overflow-hidden rounded-[1.5rem] border border-white/[0.06] bg-white/[0.02] p-6 sm:p-8 md:p-10">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_85%_50%,rgba(99,102,241,0.10),transparent_52%)]" />
      <div className="pointer-events-none absolute inset-x-8 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />

      <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
        <div className="max-w-2xl">
          <p className="text-[10px] font-black uppercase tracking-[0.22em] text-indigo-200/60">
            Próximo passo do Acompanhando
          </p>
          <h3 className="mt-3 text-lg font-black tracking-[-0.03em] text-white sm:text-xl md:text-2xl">
            Próximo episódio, retomadas e sugestões pra hoje.
          </h3>
          <p className="mt-3 text-sm leading-7 text-white/45">
            A camada de séries em tempo real e progresso por episódio chega
            em uma fase própria. Por enquanto, esta página reúne tudo o que
            está marcado como assistindo no seu rastro pessoal.
          </p>
        </div>

        <div className="hidden flex-col gap-2 md:flex">
          <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white/50">
            Em construção
          </span>
        </div>
      </div>
    </section>
  );
}
